import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { isCalendarDate, isoWeekFor, parseIsoWeek, weekDates } from "@server/lib/iso-week";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getConfig } from "./config";
import { detachHistoryFromDay } from "./history";

/**
 * The week calendar.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 */

export type Plan = typeof schema.plans.$inferSelect;
export type PlanDay = typeof schema.planDays.$inferSelect;
export type PlanDayRecipe = typeof schema.planDayRecipes.$inferSelect;

export type MealSlot = (typeof schema.mealSlot.enumValues)[number];
export type PlanRecipeRole = (typeof schema.planRecipeRole.enumValues)[number];

export interface PlanDayInput {
  servings: number;
  status?: string;
  notes?: string | null;
  main?: string | null;
  side?: string | null;
  extras?: string[];
}

export interface PlanDayWithRecipes extends PlanDay {
  main: string | null;
  side: string | null;
  extras: string[];
}

export class PlanNotFoundError extends Error {
  constructor(readonly planId: string) {
    super(`No plan named ${planId}`);
  }
}

export class PlanExistsError extends Error {
  constructor(readonly planId: string) {
    super(`A plan named ${planId} already exists`);
  }
}

export class InvalidPlanIdError extends Error {
  constructor(readonly planId: string) {
    super(`${planId} is not an ISO week id, e.g. 2026-W36`);
  }
}

export class DateOutsidePlanError extends Error {
  constructor(
    readonly date: string,
    readonly planId: string,
  ) {
    super(`${date} is in ${isoWeekFor(date)}, not ${planId}`);
  }
}

export class InvalidDateError extends Error {
  constructor(readonly date: string) {
    super(`${date} is not a calendar date`);
  }
}

export class DuplicateRecipeError extends Error {
  constructor(readonly recipeId: string) {
    super(`${recipeId} appears more than once on this day; a recipe can hold one role`);
  }
}

export class PlanDayNotFoundError extends Error {
  constructor(
    readonly date: string,
    readonly mealSlot: MealSlot,
  ) {
    super(`No ${mealSlot} planned for ${date}`);
  }
}

/**
 * Reject a date that is not in the plan's own week.
 *
 * `plans/2026-W36/days/2026-09-07` is a caller mistake — that date is the Monday of W37. Accepting
 * it would store a day the week grid never renders, so the plan would look wrong with no error
 * anywhere to explain why.
 */
function assertDateInPlan(planId: string, date: string) {
  // Checked before the week lookup: an impossible date has no week, and reporting one would name
  // a week the caller never mentioned.
  if (!isCalendarDate(date)) {
    throw new InvalidDateError(date);
  }

  if (!weekDates(requireIsoWeek(planId)).includes(date)) {
    throw new DateOutsidePlanError(date, planId);
  }
}

function requireIsoWeek(planId: string) {
  const parsed = parseIsoWeek(planId);

  if (!parsed) {
    throw new InvalidPlanIdError(planId);
  }

  return parsed;
}

function recipeRows(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  input: PlanDayInput,
) {
  const rows: (typeof schema.planDayRecipes.$inferInsert)[] = [];
  const base = { householdId, planId, date, mealSlot };

  if (input.main) {
    rows.push({ ...base, recipeId: input.main, role: "main", position: 0 });
  }

  if (input.side) {
    rows.push({ ...base, recipeId: input.side, role: "side", position: 0 });
  }

  input.extras?.forEach((recipeId, position) => {
    rows.push({ ...base, recipeId, role: "extra", position });
  });

  // A recipe holds one role on a day. Two rows with the same recipe share a primary key, so
  // without this the insert fails with a raw duplicate-key error and the caller gets a 500 that
  // says nothing about what was wrong with the request.
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.recipeId)) {
      throw new DuplicateRecipeError(row.recipeId);
    }

    seen.add(row.recipeId);
  }

  return rows;
}

/** Takes only the fields it reads, so both the inserted rows and the selected ones fit. */
function groupRecipes(
  rows: { recipeId: string; role: PlanRecipeRole; position?: number | null }[],
) {
  const extras = rows
    .filter((row) => row.role === "extra")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => row.recipeId);

  return {
    main: rows.find((row) => row.role === "main")?.recipeId ?? null,
    side: rows.find((row) => row.role === "side")?.recipeId ?? null,
    extras,
  };
}

export async function getPlan(householdId: string, planId: string, db: Database = defaultDb) {
  requireIsoWeek(planId);

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)));

  if (!plan) {
    throw new PlanNotFoundError(planId);
  }

  // Days and their recipes in two queries rather than seven round trips: the week grid needs all
  // of them at once, and a per-day fetch is the shape that makes a screen feel slow.
  const [days, recipes] = await Promise.all([
    db
      .select()
      .from(schema.planDays)
      .where(and(eq(schema.planDays.householdId, householdId), eq(schema.planDays.planId, planId)))
      .orderBy(asc(schema.planDays.date)),
    db
      .select()
      .from(schema.planDayRecipes)
      .where(
        and(
          eq(schema.planDayRecipes.householdId, householdId),
          eq(schema.planDayRecipes.planId, planId),
        ),
      ),
  ]);

  return {
    plan,
    days: days.map((day) => ({
      ...day,
      ...groupRecipes(
        recipes.filter((row) => row.date === day.date && row.mealSlot === day.mealSlot),
      ),
    })) satisfies PlanDayWithRecipes[],
  };
}

/**
 * The plan the shopper is shopping for: this week's if it exists, otherwise the most recent.
 *
 * A screen that resolved the current ISO week and stopped would be blank every Monday before the
 * week is planned, and blank all of the following week too — which is exactly when someone opens
 * it in a shop. Falling back to the latest plan means the screen always has something, and the
 * caller shows which week it is so the fallback is never silent.
 */
export async function currentOrLatestPlan(householdId: string, db: Database = defaultDb) {
  const thisWeek = isoWeekFor(new Date().toISOString().slice(0, 10));

  const [current] = await db
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, thisWeek)));

  if (current) {
    return current;
  }

  // Ids are ISO weeks, which sort chronologically as text.
  const [latest] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.householdId, householdId))
    .orderBy(desc(schema.plans.id))
    .limit(1);

  return latest;
}

export async function createPlan(
  householdId: string,
  planId: string,
  budgetTarget?: number | null,
  db: Database = defaultDb,
) {
  requireIsoWeek(planId);

  // Falls back to the household's configured default so a plan always has something to show a
  // running total against, and stores it so editing the default later does not move the target of
  // a week already planned.
  const fallback = budgetTarget ?? Number((await getConfig(householdId, db)).default_budget);
  const resolved = Number.isFinite(fallback) ? fallback : null;

  const [plan] = await db
    .insert(schema.plans)
    .values({
      householdId,
      id: planId,
      budgetTarget: resolved === null ? null : String(resolved),
    })
    .onConflictDoNothing({ target: [schema.plans.householdId, schema.plans.id] })
    .returning();

  if (!plan) {
    throw new PlanExistsError(planId);
  }

  return plan;
}

export async function updatePlan(
  householdId: string,
  planId: string,
  budgetTarget: number | null,
  db: Database = defaultDb,
) {
  const [plan] = await db
    .update(schema.plans)
    .set({
      budgetTarget: budgetTarget === null ? null : String(budgetTarget),
      updateTime: sql`now()`,
    })
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)))
    .returning();

  if (!plan) {
    throw new PlanNotFoundError(planId);
  }

  return plan;
}

export async function deletePlan(householdId: string, planId: string, db: Database = defaultDb) {
  const deleted = await db
    .delete(schema.plans)
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)))
    .returning({ id: schema.plans.id });

  if (deleted.length === 0) {
    throw new PlanNotFoundError(planId);
  }
}

/**
 * Write one day and everything on it, replacing whatever was there.
 *
 * A day is edited as a whole — its main, side and extras change together — so this replaces the
 * recipe rows rather than reconciling them. All of it is one transaction: a day left with its old
 * main and its new side is worse than a failed request.
 */
export async function setPlanDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  input: PlanDayInput,
  db: Database = defaultDb,
) {
  assertDateInPlan(planId, date);

  // Built before the transaction opens: this validates the input, and a rejected request should
  // not have taken a write lock first.
  const rows = recipeRows(householdId, planId, date, mealSlot, input);

  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)));

    if (!plan) {
      throw new PlanNotFoundError(planId);
    }

    const [day] = await tx
      .insert(schema.planDays)
      .values({
        householdId,
        planId,
        date,
        mealSlot,
        servings: input.servings,
        status: input.status ?? "planned",
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.planDays.householdId,
          schema.planDays.planId,
          schema.planDays.date,
          schema.planDays.mealSlot,
        ],
        set: {
          servings: input.servings,
          status: input.status ?? "planned",
          notes: input.notes ?? null,
          // The database's clock, matching the column defaults — see the same note in
          // `recipes.ts`. Mixing in the Node process's clock lets skew produce an updateTime
          // earlier than the row's own createTime.
          updateTime: sql`now()`,
        },
      })
      .returning();

    const dayMatch = and(
      eq(schema.planDayRecipes.householdId, householdId),
      eq(schema.planDayRecipes.planId, planId),
      eq(schema.planDayRecipes.date, date),
      eq(schema.planDayRecipes.mealSlot, mealSlot),
    );

    await tx.delete(schema.planDayRecipes).where(dayMatch);

    if (rows.length > 0) {
      await tx.insert(schema.planDayRecipes).values(rows);
    }

    return { ...day, ...groupRecipes(rows) };
  });
}

export async function getPlanDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  db: Database = defaultDb,
): Promise<PlanDayWithRecipes> {
  const match = and(
    eq(schema.planDays.householdId, householdId),
    eq(schema.planDays.planId, planId),
    eq(schema.planDays.date, date),
    eq(schema.planDays.mealSlot, mealSlot),
  );

  const [day] = await db.select().from(schema.planDays).where(match);

  if (!day) {
    throw new PlanDayNotFoundError(date, mealSlot);
  }

  const recipes = await db
    .select()
    .from(schema.planDayRecipes)
    .where(
      and(
        eq(schema.planDayRecipes.householdId, householdId),
        eq(schema.planDayRecipes.planId, planId),
        eq(schema.planDayRecipes.date, date),
        eq(schema.planDayRecipes.mealSlot, mealSlot),
      ),
    );

  return { ...day, ...groupRecipes(recipes) };
}

/**
 * Clear one day — what v1's `plan-clear` did.
 *
 * The row goes away rather than being blanked. An unplanned day is the absence of a row, so
 * readers never have to skip a phantom entry with empty columns.
 *
 * The day's history entry goes with it by default, because History records what was *planned* and
 * a meal that was never cooked should not block itself from being planned again. `keepHistory` is
 * for the case where the day happened anyway.
 */
export async function deletePlanDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  options: { keepHistory?: boolean } = {},
  db: Database = defaultDb,
) {
  return db.transaction(async (tx) => {
    if (options.keepHistory) {
      // Detaching first is the whole mechanism: the history row cascades off this day, so breaking
      // the link is what makes it survive. In the same transaction as the delete, because a
      // failure between them would leave an entry detached from a day that still exists.
      await detachHistoryFromDay(householdId, planId, date, mealSlot, tx);
    }

    const deleted = await tx
      .delete(schema.planDays)
      .where(
        and(
          eq(schema.planDays.householdId, householdId),
          eq(schema.planDays.planId, planId),
          eq(schema.planDays.date, date),
          eq(schema.planDays.mealSlot, mealSlot),
        ),
      )
      .returning({ date: schema.planDays.date });

    if (deleted.length === 0) {
      throw new PlanDayNotFoundError(date, mealSlot);
    }
  });
}

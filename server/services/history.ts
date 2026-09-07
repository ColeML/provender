import "server-only";

import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getConfig } from "./config";
import type { MealSlot } from "./plans";

/**
 * What was planned, and how it turned out.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 */

export type MealHistoryEntry = typeof schema.mealHistory.$inferSelect;

export interface MealHistoryInput {
  date: string;
  recipeId: string;
  title: string;
  mealSlot?: MealSlot;
  rating?: number | null;
  notes?: string | null;
  /** Links the entry to the day that scheduled it, so clearing that day clears this too. */
  planId?: string | null;
}

export class MealHistoryNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No history entry named ${id}`);
  }
}

/** The default when Config has no `no_repeat_days`, matching v1. */
const DEFAULT_NO_REPEAT_DAYS = 30;

/** `<date>-<recipeId>`, so re-planning the same dish on the same day updates rather than duplicates. */
export function historyId(date: string, recipeId: string) {
  return `${date}-${recipeId}`;
}

export async function recordMeal(
  householdId: string,
  input: MealHistoryInput,
  db: Database = defaultDb,
) {
  const id = historyId(input.date, input.recipeId);

  const [entry] = await db
    .insert(schema.mealHistory)
    .values({
      householdId,
      id,
      date: input.date,
      recipeId: input.recipeId,
      title: input.title,
      mealSlot: input.mealSlot ?? "dinner",
      rating: input.rating ?? null,
      notes: input.notes ?? null,
      planId: input.planId ?? null,
      planDate: input.planId ? input.date : null,
      planMealSlot: input.planId ? (input.mealSlot ?? "dinner") : null,
    })
    .onConflictDoUpdate({
      target: [schema.mealHistory.householdId, schema.mealHistory.id],
      // Re-planning the same dish on the same day refreshes the entry rather than appending a
      // second one, which is what v1 did and what left the library full of near-duplicates.
      set: {
        title: input.title,
        mealSlot: input.mealSlot ?? "dinner",
        planId: input.planId ?? null,
        planDate: input.planId ? input.date : null,
        planMealSlot: input.planId ? (input.mealSlot ?? "dinner") : null,
        updateTime: sql`now()`,
      },
    })
    .returning();

  return entry;
}

export interface ListHistoryOptions {
  /** Only entries planned within this many days. Defaults to Config's `no_repeat_days`. */
  withinDays?: number;
}

export async function listHistory(
  householdId: string,
  options: ListHistoryOptions = {},
  db: Database = defaultDb,
) {
  const days = options.withinDays ?? (await resolveNoRepeatDays(householdId, db));
  const since = new Date();

  since.setUTCDate(since.getUTCDate() - days);

  return db
    .select()
    .from(schema.mealHistory)
    .where(
      and(
        eq(schema.mealHistory.householdId, householdId),
        gte(schema.mealHistory.date, since.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(desc(schema.mealHistory.date));
}

async function resolveNoRepeatDays(householdId: string, db: Database) {
  const configured = Number((await getConfig(householdId, db)).no_repeat_days);

  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_NO_REPEAT_DAYS;
}

export async function getHistoryEntry(householdId: string, id: string, db: Database = defaultDb) {
  const [entry] = await db
    .select()
    .from(schema.mealHistory)
    .where(and(eq(schema.mealHistory.householdId, householdId), eq(schema.mealHistory.id, id)));

  if (!entry) {
    throw new MealHistoryNotFoundError(id);
  }

  return entry;
}

/** Rate a meal, or annotate it. Replaces v1's `rate` command. */
export async function rateMeal(
  householdId: string,
  id: string,
  fields: { rating?: number | null; notes?: string | null },
  updateMask: string[],
  db: Database = defaultDb,
) {
  const named = new Set(updateMask);
  const patch: Record<string, unknown> = { updateTime: sql`now()` };

  if (named.has("rating")) {
    patch.rating = fields.rating ?? null;
  }

  if (named.has("notes")) {
    patch.notes = fields.notes ?? null;
  }

  const [entry] = await db
    .update(schema.mealHistory)
    .set(patch)
    .where(and(eq(schema.mealHistory.householdId, householdId), eq(schema.mealHistory.id, id)))
    .returning();

  if (!entry) {
    throw new MealHistoryNotFoundError(id);
  }

  return entry;
}

/**
 * Forget a meal.
 *
 * v1 had no equivalent, which is why a dinner that was planned and then skipped blocked itself for
 * the whole no-repeat window with no way to take it back.
 */
export async function deleteHistoryEntry(
  householdId: string,
  id: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.mealHistory)
    .where(and(eq(schema.mealHistory.householdId, householdId), eq(schema.mealHistory.id, id)))
    .returning({ id: schema.mealHistory.id });

  if (deleted.length === 0) {
    throw new MealHistoryNotFoundError(id);
  }
}

/**
 * Detach every history entry a day scheduled, so clearing the day leaves them behind.
 *
 * This is `plan-clear --keep-history`: the link is what cascades, so removing it first is what
 * turns "clear the day and forget it happened" into "clear the day, we ate it anyway".
 */
export async function detachHistoryFromDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  db: Queryable = defaultDb,
) {
  await db
    .update(schema.mealHistory)
    .set({ planId: null, planDate: null, planMealSlot: null })
    .where(
      and(
        eq(schema.mealHistory.householdId, householdId),
        eq(schema.mealHistory.planId, planId),
        eq(schema.mealHistory.planDate, date),
        eq(schema.mealHistory.planMealSlot, mealSlot),
      ),
    );
}

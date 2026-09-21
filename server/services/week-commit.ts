import "server-only";

import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";
import { and, eq, inArray, ne } from "drizzle-orm";

import { historyId, recordMeal } from "./history";
import {
  prepareDay,
  upsertPlan,
  writePlanDay,
  type MealSlot,
  type Plan,
  type PlanDayInput,
  type PlanDayWithRecipes,
  type PreparedDay,
} from "./plans";
import { insertRecipe, recipesByIds, type IngredientInput, type RecipeInput } from "./recipes";

/**
 * Write an approved week in one transaction.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 *
 * The four calls this replaces had a write order forced on them by the schema — a day needs its
 * plan and its recipes, and a history entry needs its day — and no transaction around it, so a
 * failure part-way left a real plan with days missing. That order lives here now instead of in the
 * planning workflow's prose.
 */

export interface CommitRecipeInput extends RecipeInput {
  recipeId: string;
  ingredients?: IngredientInput[];
}

export interface CommitDayInput extends PlanDayInput {
  date: string;
  mealSlot?: MealSlot;
}

export interface WeekCommitInput {
  budgetTarget?: number | null;
  recipes?: CommitRecipeInput[];
  days: CommitDayInput[];
  /** Permits overwriting days already in the plan. Absent means refuse. */
  replaceExistingDays?: boolean;
}

export interface WeekCommitResult {
  plan: Plan;
  createdRecipeIds: string[];
  days: PlanDayWithRecipes[];
  historyEntryIds: string[];
}

export class DuplicateCommitDayError extends Error {
  constructor(
    readonly date: string,
    readonly mealSlot: MealSlot,
  ) {
    super(`${date} appears more than once as a ${mealSlot}; a date holds one meal per slot`);
  }
}

export class DuplicateCommitRecipeError extends Error {
  constructor(readonly recipeId: string) {
    super(`${recipeId} appears more than once in recipes`);
  }
}

export class UnknownRecipeError extends Error {
  constructor(readonly recipeIds: string[]) {
    super(
      `No saved or committed recipe named ${recipeIds.join(", ")}; ` +
        "a day can only name a recipe that exists or that this commit creates",
    );
  }
}

export class DaysAlreadyPlannedError extends Error {
  constructor(readonly dates: string[]) {
    super(
      `Already planned: ${dates.join(", ")}. ` +
        "Pass replaceExistingDays to overwrite, which discards whatever is on those days.",
    );
  }
}

export class UnreferencedRecipeError extends Error {
  constructor(readonly recipeIds: string[]) {
    super(
      `${recipeIds.join(", ")} named in recipes but no day's main, side or extras references ` +
        "it; a commit only creates a recipe some day in the payload actually uses",
    );
  }
}

function assertNoDuplicateRecipes(recipes: CommitRecipeInput[]) {
  const seen = new Set<string>();

  for (const recipe of recipes) {
    if (seen.has(recipe.recipeId)) {
      throw new DuplicateCommitRecipeError(recipe.recipeId);
    }

    seen.add(recipe.recipeId);
  }
}

function assertNoDuplicateDays(days: PreparedDay[]) {
  const seen = new Set<string>();

  for (const day of days) {
    const key = `${day.date}-${day.mealSlot}`;

    if (seen.has(key)) {
      throw new DuplicateCommitDayError(day.date, day.mealSlot);
    }

    seen.add(key);
  }
}

function assertRecipesReferenced(recipes: CommitRecipeInput[], days: PreparedDay[]) {
  const referenced = new Set(referencedRecipeIds(days));
  const orphaned = recipes
    .map((recipe) => recipe.recipeId)
    .filter((recipeId) => !referenced.has(recipeId));

  if (orphaned.length > 0) {
    throw new UnreferencedRecipeError(orphaned);
  }
}

function referencedRecipeIds(days: PreparedDay[]) {
  return [
    ...new Set(
      days.flatMap((day) => [day.input.main, day.input.side, ...(day.input.extras ?? [])]),
    ),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function assertRecipesResolve(
  householdId: string,
  committed: CommitRecipeInput[],
  days: PreparedDay[],
  db: Queryable,
) {
  const creating = new Set(committed.map((recipe) => recipe.recipeId));
  const wanted = referencedRecipeIds(days).filter((id) => !creating.has(id));

  if (wanted.length === 0) {
    return;
  }

  const found = await db
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), inArray(schema.recipes.id, wanted)));

  const have = new Set(found.map((row) => row.id));
  const missing = wanted.filter((id) => !have.has(id));

  if (missing.length > 0) {
    throw new UnknownRecipeError(missing);
  }
}

/**
 * Delete the history this day's write is superseding, keyed on the plan-day link rather than the
 * date alone — an entry `keepHistory` detached has a null `planId` and must survive, and a link
 * keyed this way cannot reach another week that happens to reuse the date.
 *
 * Excludes the id the incoming main would itself use, so re-committing the same main does not
 * delete and immediately reinsert the row whose rating this is trying to preserve.
 */
async function clearSupersededHistory(
  householdId: string,
  planId: string,
  day: PreparedDay,
  db: Queryable,
) {
  const keep = day.input.main ? historyId(day.date, day.input.main) : null;

  await db
    .delete(schema.mealHistory)
    .where(
      and(
        eq(schema.mealHistory.householdId, householdId),
        eq(schema.mealHistory.planId, planId),
        eq(schema.mealHistory.planDate, day.date),
        eq(schema.mealHistory.planMealSlot, day.mealSlot),
        ...(keep ? [ne(schema.mealHistory.id, keep)] : []),
      ),
    );
}

async function assertDaysUnplanned(
  householdId: string,
  planId: string,
  days: PreparedDay[],
  db: Queryable,
) {
  const existing = await db
    .select({ date: schema.planDays.date, mealSlot: schema.planDays.mealSlot })
    .from(schema.planDays)
    .where(and(eq(schema.planDays.householdId, householdId), eq(schema.planDays.planId, planId)));

  const taken = new Set(existing.map((row) => `${row.date}-${row.mealSlot}`));
  const clashes = days
    .filter((day) => taken.has(`${day.date}-${day.mealSlot}`))
    .map((day) => day.date);

  if (clashes.length > 0) {
    throw new DaysAlreadyPlannedError(clashes);
  }
}

export async function commitWeek(
  householdId: string,
  planId: string,
  input: WeekCommitInput,
  db: Database = defaultDb,
): Promise<WeekCommitResult> {
  const recipes = input.recipes ?? [];

  // Shape checks first. They need no database, and a rejected request should not have taken a
  // write lock — the same reason `setPlanDay` prepares its rows before opening its transaction.
  assertNoDuplicateRecipes(recipes);

  const prepared = input.days.map((day) =>
    prepareDay(householdId, planId, day.date, day.mealSlot ?? "dinner", day),
  );

  assertNoDuplicateDays(prepared);
  assertRecipesReferenced(recipes, prepared);

  return db.transaction(async (tx) => {
    // The two checks that read stored state are the transaction's first reads rather than queries
    // ahead of it: both decide whether to write based on what is already there.
    await assertRecipesResolve(householdId, recipes, prepared, tx);

    if (!input.replaceExistingDays) {
      await assertDaysUnplanned(householdId, planId, prepared, tx);
    }

    const plan = await upsertPlan(householdId, planId, input.budgetTarget, tx);

    for (const recipe of recipes) {
      const { recipeId, ingredients, ...fields } = recipe;

      await insertRecipe(householdId, recipeId, fields, ingredients ?? [], tx);
    }

    const days: PlanDayWithRecipes[] = [];

    for (const day of prepared) {
      days.push(await writePlanDay(householdId, planId, day, tx));
    }

    // After the days, so the foreign key from a history entry to its day is already satisfied —
    // which is why `recordMeal` needs no special case here.
    const mains = [...new Set(prepared.map((day) => day.input.main))].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    const titles = await recipesByIds(householdId, mains, tx);
    const historyEntryIds: string[] = [];

    for (const day of prepared) {
      await clearSupersededHistory(householdId, planId, day, tx);

      const main = day.input.main;

      if (!main) continue;

      const entry = await recordMeal(
        householdId,
        {
          date: day.date,
          recipeId: main,
          title: titles.get(main)?.title ?? main,
          mealSlot: day.mealSlot,
          planId,
        },
        tx,
      );

      historyEntryIds.push(entry.id);
    }

    return {
      plan,
      createdRecipeIds: recipes.map((recipe) => recipe.recipeId),
      days,
      historyEntryIds,
    };
  });
}

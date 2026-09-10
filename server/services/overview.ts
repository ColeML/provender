import { type Database, db as defaultDb } from "@server/db";
import * as schema from "@server/db/schema";
import { isoWeekFor } from "@server/lib/iso-week";
import { currentOrLatestPlan, type MealSlot } from "@server/services/plans";
import { recipesByIds } from "@server/services/recipes";
import { and, asc, eq } from "drizzle-orm";

export interface OverviewDay {
  date: string;
  mealSlot: MealSlot;
  status: string;
  mainRecipeId: string | null;
  mainTitle: string | null;
}

export interface WeekOverview {
  planId: string | null;
  /** False when the plan shown is an earlier week, so the screen can say which week it is. */
  isCurrentWeek: boolean;
  days: OverviewDay[];
  /** Items still to buy: not ticked, and not flagged as already owned. */
  outstandingItems: number;
}

/**
 * What the home screen shows: the week's days and how much shopping is left.
 *
 * One function rather than three calls from the page, because "this week" is a single question
 * whose answer spans plans, recipes and the shopping list.
 */
export async function weekOverview(
  householdId: string,
  db: Database = defaultDb,
): Promise<WeekOverview> {
  const plan = await currentOrLatestPlan(householdId, db);

  if (!plan) {
    return { planId: null, isCurrentWeek: false, days: [], outstandingItems: 0 };
  }

  // Days come from `plan_days`, not from the recipe rows: a main is optional, so a potluck day
  // has a day row and no main, and sourcing from the recipes would drop it from a planned week.
  const [days, mains, items] = await Promise.all([
    db
      .select({
        date: schema.planDays.date,
        mealSlot: schema.planDays.mealSlot,
        status: schema.planDays.status,
      })
      .from(schema.planDays)
      .where(and(eq(schema.planDays.householdId, householdId), eq(schema.planDays.planId, plan.id)))
      .orderBy(asc(schema.planDays.date), asc(schema.planDays.mealSlot)),
    db
      .select({
        date: schema.planDayRecipes.date,
        mealSlot: schema.planDayRecipes.mealSlot,
        recipeId: schema.planDayRecipes.recipeId,
      })
      .from(schema.planDayRecipes)
      .where(
        and(
          eq(schema.planDayRecipes.householdId, householdId),
          eq(schema.planDayRecipes.planId, plan.id),
          eq(schema.planDayRecipes.role, "main"),
        ),
      ),
    db
      .select({
        purchased: schema.shoppingListItems.purchased,
        haveAlready: schema.shoppingListItems.haveAlready,
      })
      .from(schema.shoppingListItems)
      .where(
        and(
          eq(schema.shoppingListItems.householdId, householdId),
          eq(schema.shoppingListItems.planId, plan.id),
        ),
      ),
  ]);

  // Keyed on both, because the slot is half the day key: a date can carry a dinner and a lunch.
  const dayKey = (date: string, mealSlot: string) => `${date}\u0000${mealSlot}`;
  const mainFor = new Map(mains.map((row) => [dayKey(row.date, row.mealSlot), row.recipeId]));

  const recipes = await recipesByIds(
    householdId,
    mains.map((row) => row.recipeId),
    db,
  );

  return {
    planId: plan.id,
    isCurrentWeek: plan.id === isoWeekFor(new Date().toISOString().slice(0, 10)),
    days: days.map((day) => {
      const mainRecipeId = mainFor.get(dayKey(day.date, day.mealSlot)) ?? null;

      return {
        date: day.date,
        mealSlot: day.mealSlot,
        status: day.status,
        mainRecipeId,
        mainTitle: mainRecipeId === null ? null : (recipes.get(mainRecipeId)?.title ?? null),
      };
    }),
    outstandingItems: items.filter((item) => !item.purchased && !item.haveAlready).length,
  };
}

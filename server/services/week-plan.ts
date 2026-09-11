import "server-only";

import { type Database, db as defaultDb } from "@server/db";
import { isoWeekFor, parseIsoWeek, weekDates } from "@server/lib/iso-week";
import { MEAL_ORDER } from "@server/db/schema/plans";
import { getPlan, InvalidPlanIdError, type MealSlot } from "@server/services/plans";
import { recipesByIds, type RecipeSummary } from "@server/services/recipes";

export interface WeekPlanDay {
  date: string;
  mealSlot: MealSlot;
  /** False for a day with no row at all, which is how an unplanned day is stored. */
  planned: boolean;
  servings: number | null;
  status: string;
  notes: string | null;
  main: RecipeSummary | null;
  side: RecipeSummary | null;
  extras: RecipeSummary[];
}

export interface WeekPlan {
  planId: string;
  budgetTarget: number | null;
  /** Every date in the ISO week, planned or not, so the grid always has seven columns. */
  days: WeekPlanDay[];
  /** Summed from the recipes on the week, so it moves as days are swapped. */
  estimatedCost: number;
}

/** A date with no row for that slot. An unplanned day is the absence of a row, not an empty one. */
function unplanned(date: string, mealSlot: MealSlot): WeekPlanDay {
  return {
    date,
    mealSlot,
    planned: false,
    servings: null,
    status: "unplanned",
    notes: null,
    main: null,
    side: null,
    extras: [],
  };
}

type PlanDayRow = Awaited<ReturnType<typeof getPlan>>["days"][number];

function decorate(day: PlanDayRow, recipes: Map<string, RecipeSummary>): WeekPlanDay {
  return {
    date: day.date,
    mealSlot: day.mealSlot,
    planned: true,
    servings: day.servings,
    status: day.status,
    notes: day.notes,
    main: day.main === null ? null : (recipes.get(day.main) ?? null),
    side: day.side === null ? null : (recipes.get(day.side) ?? null),
    extras: day.extras.map((id) => recipes.get(id)).filter((recipe) => recipe !== undefined),
  };
}

/**
 * Every meal planned on one date, in the order they are eaten.
 *
 * Separate from `weekPlan`, which is dinners only because its grid has one column per date. A day
 * screen has room for all of them, and dropping a planned lunch there would lose it silently.
 */
export async function daySlots(householdId: string, date: string, db: Database = defaultDb) {
  const planId = isoWeekFor(date);
  const { days } = await getPlan(householdId, planId, db);
  const onThisDate = days.filter((day) => day.date === date);

  const recipes = await recipesByIds(
    householdId,
    onThisDate.flatMap((day) => [day.main, day.side, ...day.extras]).filter((id) => id !== null),
    db,
  );

  return onThisDate
    .map((day) => decorate(day, recipes))
    .sort((a, b) => MEAL_ORDER.indexOf(a.mealSlot) - MEAL_ORDER.indexOf(b.mealSlot));
}

/**
 * The week as the planning grid needs it: seven dates, each with its recipes named and priced.
 *
 * Built on `getPlan` rather than querying alongside it, so there is one definition of what a plan
 * day contains.
 */
export async function weekPlan(
  householdId: string,
  planId: string,
  db: Database = defaultDb,
): Promise<WeekPlan> {
  const isoWeek = parseIsoWeek(planId);

  if (!isoWeek) {
    throw new InvalidPlanIdError(planId);
  }

  const { plan, days } = await getPlan(householdId, planId, db);

  // Dinners only. The grid has one column per date, and lunches are leftovers here — a lunch row
  // would silently claim a column that belongs to that day's dinner.
  const dinners = new Map(days.filter((day) => day.mealSlot === "dinner").map((d) => [d.date, d]));

  const recipes = await recipesByIds(
    householdId,
    [...dinners.values()]
      .flatMap((day) => [day.main, day.side, ...day.extras])
      .filter((id) => id !== null),
    db,
  );

  const planDays = weekDates(isoWeek).map((date): WeekPlanDay => {
    const day = dinners.get(date);

    return day ? decorate(day, recipes) : unplanned(date, "dinner");
  });

  return {
    planId,
    budgetTarget: plan.budgetTarget === null ? null : Number(plan.budgetTarget),
    days: planDays,
    estimatedCost: planDays
      .flatMap((day) => [day.main, day.side, ...day.extras])
      .reduce((total, recipe) => total + (recipe?.costEstimate ?? 0), 0),
  };
}

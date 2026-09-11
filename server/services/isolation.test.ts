import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { getConfig, setConfigValue } from "@server/services/config";
import { createPlan, getPlan, PlanNotFoundError, setPlanDay } from "@server/services/plans";
import {
  createRecipe,
  deleteRecipe,
  getIngredient,
  getRecipe,
  listIngredients,
  listRecipes,
  RecipeNotFoundError,
  updateRecipe,
} from "@server/services/recipes";
import { clearTokenCache, NoStoreConfiguredError, searchPrices } from "@server/services/kroger";
import { listItems, replaceItems } from "@server/services/shopping";
import {
  deleteHistoryEntry,
  detachHistoryFromDay,
  getHistoryEntry,
  listHistory,
  MealHistoryNotFoundError,
  rateMeal,
  recordMeal,
} from "@server/services/history";
import {
  deletePrice,
  getPrice,
  listPrices,
  PriceNotFoundError,
  setPrice,
} from "@server/services/prices";
import { weekOverview } from "@server/services/overview";
import { daySlots, weekPlan } from "@server/services/week-plan";
import { isoWeekFor } from "@server/lib/iso-week";
import { schema } from "@server/db";

/**
 * The claim the whole household scope exists to make: one household cannot observe or affect
 * another's rows through any service function.
 *
 * Written from the outside rather than by inspecting queries, because the failure mode is a
 * *forgotten* filter — a query missing `where household_id = ?` looks entirely normal, and only a
 * test that asks the other household what it can see will catch it.
 *
 * Three services are absent deliberately. `scrape` reads a web page and touches no table.
 * `weather` reads only the household's `location` through `getConfig`, which the config cases
 * below already cover. `login-throttle` runs before a household is resolved, so its rows are keyed
 * on a client address and there is no household scope to leak. Every other service has a case
 * here.
 */
let db: Database;
let close: () => Promise<void>;

const A = "loewer";
const B = "other";

const recipe = { title: "Fajitas", baseServings: 8, costEstimate: 12.5 };
const ingredients = [{ name: "salt", quantity: 1, unit: "tsp", category: "pantry" as const }];

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await db.insert(schema.households).values({ id: B, name: "Other" });

  await setConfigValue(A, "people", "4", db);
  await setConfigValue(B, "people", "9", db);
  await createRecipe(A, "fajitas", recipe, ingredients, db);
});

afterEach(async () => {
  await close();
});

describe("config", () => {
  it("returns only the calling household's settings", async () => {
    await expect(getConfig(A, db)).resolves.toEqual({ people: "4" });
    await expect(getConfig(B, db)).resolves.toEqual({ people: "9" });
  });

  it("lets both households hold the same key with different values", async () => {
    await setConfigValue(B, "people", "10", db);

    await expect(getConfig(A, db)).resolves.toEqual({ people: "4" });
    await expect(getConfig(B, db)).resolves.toEqual({ people: "10" });
  });
});

describe("recipes", () => {
  it("hides another household's recipe from get", async () => {
    await expect(getRecipe(B, "fajitas", db)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });

  it("hides another household's recipe from list", async () => {
    await expect(listRecipes(B, {}, db)).resolves.toMatchObject({ recipes: [] });
  });

  it("lets both households use the same recipe id independently", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    await expect(getRecipe(A, "fajitas", db)).resolves.toMatchObject({ title: "Fajitas" });
    await expect(getRecipe(B, "fajitas", db)).resolves.toMatchObject({ title: "Their Fajitas" });
  });

  it("will not let one household update another's recipe", async () => {
    await expect(
      updateRecipe(B, "fajitas", ["title"], { title: "Hijacked" }, undefined, db),
    ).rejects.toBeInstanceOf(RecipeNotFoundError);

    await expect(getRecipe(A, "fajitas", db)).resolves.toMatchObject({ title: "Fajitas" });
  });

  it("will not let one household delete another's recipe", async () => {
    await expect(deleteRecipe(B, "fajitas", db)).rejects.toBeInstanceOf(RecipeNotFoundError);

    await expect(getRecipe(A, "fajitas", db)).resolves.toBeDefined();
  });
});

describe("ingredients", () => {
  it("hides another household's ingredients from list", async () => {
    await expect(listIngredients(A, "fajitas", db)).resolves.toHaveLength(1);
    await expect(listIngredients(B, "fajitas", db)).resolves.toEqual([]);
  });

  it("hides another household's ingredient from get", async () => {
    await expect(getIngredient(A, "fajitas", "fajitas_salt", db)).resolves.toBeDefined();
    await expect(getIngredient(B, "fajitas", "fajitas_salt", db)).resolves.toBeUndefined();
  });
});

describe("plans", () => {
  beforeEach(async () => {
    await createPlan(A, "2026-W36", 120, db);
    await setPlanDay(A, "2026-W36", "2026-08-31", "dinner", { servings: 8, main: "fajitas" }, db);
  });

  it("hides another household's week", async () => {
    await expect(getPlan(B, "2026-W36", db)).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("lets both households plan the same week independently", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await expect(getPlan(A, "2026-W36", db)).resolves.toMatchObject({
      plan: { budgetTarget: "120.00" },
    });
    await expect(getPlan(B, "2026-W36", db)).resolves.toMatchObject({
      plan: { budgetTarget: "200.00" },
      days: [],
    });
  });
});

describe("shopping lists", () => {
  beforeEach(async () => {
    await createPlan(A, "2026-W36", 120, db);
    await createPlan(B, "2026-W36", 200, db);
    await replaceItems(
      A,
      "2026-W36",
      [{ name: "chicken breast", quantity: 3, unit: "lb", category: "meat" }],
      db,
    );
  });

  it("hides another household's list", async () => {
    await expect(listItems(A, "2026-W36", db)).resolves.toHaveLength(1);
    await expect(listItems(B, "2026-W36", db)).resolves.toEqual([]);
  });
});

describe("kroger price lookups", () => {
  beforeEach(async () => {
    clearTokenCache();
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok", expires_in: 1800, data: [] }),
      }),
    );
    await setConfigValue(A, "kroger_location_id", "01400943", db);
  });

  afterEach(() => {
    clearTokenCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not fall back to another household's store", async () => {
    await expect(searchPrices(A, { term: "ground beef" }, db)).resolves.toMatchObject({
      locationId: "01400943",
    });
    await expect(searchPrices(B, { term: "ground beef" }, db)).rejects.toBeInstanceOf(
      NoStoreConfiguredError,
    );
  });
});

describe("history", () => {
  const MONDAY = "2026-08-31";

  beforeEach(async () => {
    await createPlan(A, "2026-W36", 120, db);
    await createPlan(B, "2026-W36", 200, db);
    await setPlanDay(A, "2026-W36", MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await recordMeal(
      A,
      { date: MONDAY, recipeId: "fajitas", title: "Fajitas", planId: "2026-W36" },
      db,
    );
  });

  it("hides another household's entries from list", async () => {
    await expect(listHistory(A, { withinDays: 10_000 }, db)).resolves.toHaveLength(1);
    await expect(listHistory(B, { withinDays: 10_000 }, db)).resolves.toEqual([]);
  });

  it("hides another household's entry from get", async () => {
    await expect(getHistoryEntry(B, `${MONDAY}-fajitas`, db)).rejects.toBeInstanceOf(
      MealHistoryNotFoundError,
    );
  });

  it("will not let one household rate another's meal", async () => {
    await expect(
      rateMeal(B, `${MONDAY}-fajitas`, { rating: 1 }, ["rating"], db),
    ).rejects.toBeInstanceOf(MealHistoryNotFoundError);

    await expect(getHistoryEntry(A, `${MONDAY}-fajitas`, db)).resolves.toMatchObject({
      rating: null,
    });
  });

  it("will not let one household delete another's entry", async () => {
    await expect(deleteHistoryEntry(B, `${MONDAY}-fajitas`, db)).rejects.toBeInstanceOf(
      MealHistoryNotFoundError,
    );

    await expect(getHistoryEntry(A, `${MONDAY}-fajitas`, db)).resolves.toBeDefined();
  });

  // Both households name their weeks `2026-W36`, so the plan id alone does not identify the day.
  it("will not let one household detach what another's day scheduled", async () => {
    await detachHistoryFromDay(B, "2026-W36", MONDAY, "dinner", db);

    await expect(getHistoryEntry(A, `${MONDAY}-fajitas`, db)).resolves.toMatchObject({
      planId: "2026-W36",
    });
  });
});

describe("prices", () => {
  const paid = { ingredient: "chicken breast", unit: "lb", store: "kroger", price: 3.49 };

  beforeEach(async () => {
    await setPrice(A, paid, db);
  });

  it("hides another household's prices from list", async () => {
    await expect(listPrices(A, db)).resolves.toHaveLength(1);
    await expect(listPrices(B, db)).resolves.toEqual([]);
  });

  it("hides another household's price from get", async () => {
    await expect(getPrice(B, paid.ingredient, paid.unit, paid.store, db)).rejects.toBeInstanceOf(
      PriceNotFoundError,
    );
  });

  it("lets both households record their own price for the same item and store", async () => {
    await setPrice(B, { ...paid, price: 5.99 }, db);

    await expect(getPrice(A, paid.ingredient, paid.unit, paid.store, db)).resolves.toMatchObject({
      price: "3.49",
    });
    await expect(getPrice(B, paid.ingredient, paid.unit, paid.store, db)).resolves.toMatchObject({
      price: "5.99",
    });
  });

  it("will not let one household delete another's price", async () => {
    await expect(deletePrice(B, paid.ingredient, paid.unit, paid.store, db)).rejects.toBeInstanceOf(
      PriceNotFoundError,
    );

    await expect(listPrices(A, db)).resolves.toHaveLength(1);
  });
});

describe("week overview", () => {
  // Both the week id and the Monday come from one reading of the clock. Sampling the date twice
  // lets a UTC midnight land between them and put the Monday in a later week than `THIS_WEEK`.
  const today = new Date();
  const THIS_WEEK = isoWeekFor(today.toISOString().slice(0, 10));
  const MONDAY = mondayOf(today);

  function mondayOf(date: Date) {
    const monday = new Date(date);

    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));

    return monday.toISOString().slice(0, 10);
  }

  beforeEach(async () => {
    await createPlan(A, THIS_WEEK, 120, db);
    await setPlanDay(A, THIS_WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await replaceItems(
      A,
      THIS_WEEK,
      [{ name: "chicken breast", quantity: 3, unit: "lb", category: "meat" }],
      db,
    );
  });

  it("does not fall back to another household's plan", async () => {
    await expect(weekOverview(B, db)).resolves.toEqual({
      planId: null,
      isCurrentWeek: false,
      days: [],
      outstandingItems: 0,
    });
  });

  // B plans the same date and slot with no main of its own, which is what a potluck day looks
  // like. A's main for that day must not surface as B's.
  it("shows nothing from another household's week of the same name", async () => {
    await createPlan(B, THIS_WEEK, 200, db);
    await setPlanDay(B, THIS_WEEK, MONDAY, "dinner", { servings: 4 }, db);

    await expect(weekOverview(B, db)).resolves.toEqual({
      planId: THIS_WEEK,
      isCurrentWeek: true,
      days: [
        {
          date: MONDAY,
          mealSlot: "dinner",
          status: "planned",
          mainRecipeId: null,
          mainTitle: null,
        },
      ],
      outstandingItems: 0,
    });
  });
});

describe("week plan", () => {
  const MONDAY = "2026-08-31";

  beforeEach(async () => {
    await createPlan(A, "2026-W36", 120, db);
    await setPlanDay(A, "2026-W36", MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await createPlan(B, "2026-W36", 200, db);
  });

  it("leaves the grid empty when only the other household planned that week", async () => {
    const week = await weekPlan(B, "2026-W36", db);

    expect(week.days.every((day) => !day.planned)).toBe(true);
    expect(week.estimatedCost).toBe(0);
  });

  // Recipe rows are matched to days by date and slot, so B holding its own `fajitas` is what turns
  // a lost filter into a main B never planned rather than a silently dropped row.
  it("does not attach another household's main to a day of the same date", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);
    await setPlanDay(B, "2026-W36", MONDAY, "dinner", { servings: 4 }, db);

    const week = await weekPlan(B, "2026-W36", db);

    expect(week.days.find((day) => day.date === MONDAY)).toMatchObject({
      planned: true,
      main: null,
    });
    await expect(daySlots(B, MONDAY, db)).resolves.toMatchObject([{ main: null }]);
  });
});

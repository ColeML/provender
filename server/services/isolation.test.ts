import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { getConfig, setConfigValue } from "@server/services/config";
import {
  createPlan,
  deletePlan,
  deletePlanDay,
  getPlan,
  getPlanDay,
  PlanDayNotFoundError,
  PlanNotFoundError,
  setPlanDay,
  updatePlan,
} from "@server/services/plans";
import {
  addIngredient,
  createRecipe,
  deleteIngredient,
  deleteRecipe,
  getIngredient,
  getRecipe,
  listIngredients,
  listRecipes,
  RecipeNotFoundError,
  recipesByIds,
  updateRecipe,
} from "@server/services/recipes";
import { clearTokenCache, NoStoreConfiguredError, searchPrices } from "@server/services/kroger";
import {
  addItem,
  deleteItem,
  getItem,
  listItems,
  replaceItems,
  ShoppingItemNotFoundError,
  updateItem,
} from "@server/services/shopping";
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
import { planningRotation } from "@server/services/planning";
import { weekOverview } from "@server/services/overview";
import { daySlots, weekPlan } from "@server/services/week-plan";
import { createShare, deleteShare, getShare, getSharedRecipe } from "@server/services/shares";
import { commitWeek, UnknownRecipeError } from "@server/services/week-commit";
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
 * on a client address and there is no household scope to leak. Every other service has at least one
 * case here; the roster is per service, not one case per exported function.
 *
 * `getSharedRecipe` is the one function that takes no `householdId`, because `/r/{token}` answers
 * without a session. It is not outside the claim — it is the sharpest case of it, since no later
 * check can catch a wrong answer. The `shares` cases below pin the household to the token's own
 * row.
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

  // Both households hold a "fajitas", so id and recipeId collide once B legitimately owns a row
  // under that id too. The household filter on the UPDATE statement itself — not the existence
  // check ahead of it — is what keeps B's edit from also touching A's row.
  it("will not let one household's update change another's recipe of the same id", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    await updateRecipe(B, "fajitas", ["title"], { title: "Hijacked" }, undefined, db);

    await expect(getRecipe(A, "fajitas", db)).resolves.toMatchObject({ title: "Fajitas" });
  });

  // The lookup behind both plan views. Asking for an id only the other household holds is the
  // deterministic form of the failure: a collision would return one of two rows in whichever order
  // the database happened to produce them, and the map would keep the last.
  it("resolves none of another household's ids to a title", async () => {
    await expect(recipesByIds(A, ["fajitas"], db)).resolves.toMatchObject(
      new Map([["fajitas", { title: "Fajitas" }]]),
    );
    await expect(recipesByIds(B, ["fajitas"], db)).resolves.toEqual(new Map());
  });

  // The cursor is a second predicate on the same query, and only a paged call reaches it. B's page
  // one ends on an id that sorts before A's `fajitas`, so a `gt` without the household filter hands
  // B a recipe it does not own.
  it("does not follow a page token into another household's recipes", async () => {
    await createRecipe(B, "burgers", { ...recipe, title: "Burgers" }, [], db);
    await createRecipe(B, "tacos", { ...recipe, title: "Tacos" }, [], db);

    const first = await listRecipes(B, { pageSize: 1 }, db);

    expect(first.recipes).toMatchObject([{ id: "burgers" }]);

    await expect(
      listRecipes(B, { pageSize: 1, pageToken: first.nextPageToken }, db),
    ).resolves.toMatchObject({ recipes: [{ id: "tacos" }] });
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

  it("will not let one household delete another's ingredient by matching recipe id", async () => {
    await expect(deleteIngredient(B, "fajitas", "fajitas_salt", db)).resolves.toBe(false);

    await expect(listIngredients(A, "fajitas", db)).resolves.toHaveLength(1);
  });

  // Both households hold a "fajitas", so A's ingredient rows are reachable by recipeId alone. If
  // they leaked into the rows this reads before inserting, B's new "salt" would collide with A's
  // and get bumped to a numbered suffix and a later position instead of `fajitas_salt` at 0.
  it("does not let another household's ingredients affect this household's new ingredient", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    const created = await addIngredient(
      B,
      "fajitas",
      { name: "salt", quantity: 1, unit: "tsp", category: "pantry" },
      db,
    );

    expect(created).toMatchObject({ id: "fajitas_salt", position: 0 });
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

  it("will not let one household's plan update change another's budget", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await updatePlan(B, "2026-W36", 50, db);

    await expect(getPlan(A, "2026-W36", db)).resolves.toMatchObject({
      plan: { budgetTarget: "120.00" },
    });
  });

  it("will not let one household's plan delete remove another's plan", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await deletePlan(B, "2026-W36", db);

    await expect(getPlan(A, "2026-W36", db)).resolves.toBeDefined();
  });

  // Both weeks are named `2026-W36`, so the date and slot alone do not identify the day — the
  // household filter on the delete inside `writePlanDay` is what stops B's own write from also
  // clearing A's recipes for that day.
  it("will not let one household's day edit strip another's recipes for the same date and slot", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await setPlanDay(B, "2026-W36", "2026-08-31", "dinner", { servings: 4 }, db);

    await expect(getPlan(A, "2026-W36", db)).resolves.toMatchObject({
      days: [{ date: "2026-08-31", main: "fajitas" }],
    });
  });

  it("will not let one household's day-clear delete another's day of the same date", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await expect(
      deletePlanDay(B, "2026-W36", "2026-08-31", "dinner", {}, db),
    ).rejects.toBeInstanceOf(PlanDayNotFoundError);

    await expect(getPlan(A, "2026-W36", db)).resolves.toMatchObject({
      days: [{ date: "2026-08-31" }],
    });
  });

  it("does not resolve another household's day from getPlanDay", async () => {
    await createPlan(B, "2026-W36", 200, db);

    await expect(getPlanDay(B, "2026-W36", "2026-08-31", "dinner", db)).rejects.toBeInstanceOf(
      PlanDayNotFoundError,
    );
  });

  // B legitimately owns a day at the same date and slot, so the day-match query resolves B's own
  // row — the household filter on the recipes query underneath it is what keeps A's main out.
  it("does not attach another household's recipes to getPlanDay", async () => {
    await createPlan(B, "2026-W36", 200, db);
    await setPlanDay(B, "2026-W36", "2026-08-31", "dinner", { servings: 4 }, db);

    await expect(getPlanDay(B, "2026-W36", "2026-08-31", "dinner", db)).resolves.toMatchObject({
      main: null,
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

  // Item ids come from the name and unit alone, so nothing about A's row distinguishes it from a
  // row B's rebuild would drop — the household filter on the delete is the whole of what saves it.
  it("does not clear another household's list when rebuilding a week of the same name", async () => {
    await replaceItems(
      B,
      "2026-W36",
      [{ name: "bell peppers", quantity: 2, unit: "ea", category: "produce" }],
      db,
    );

    await expect(listItems(A, "2026-W36", db)).resolves.toMatchObject([{ name: "chicken breast" }]);
  });

  it("will not let one household tick another's item", async () => {
    await expect(
      updateItem(B, "2026-W36", "chicken-breast_lb", { purchased: true }, ["purchased"], db),
    ).rejects.toBeInstanceOf(ShoppingItemNotFoundError);

    await expect(listItems(A, "2026-W36", db)).resolves.toMatchObject([{ purchased: false }]);
  });

  it("will not let getItem resolve another household's item", async () => {
    await expect(getItem(B, "2026-W36", "chicken-breast_lb", db)).rejects.toBeInstanceOf(
      ShoppingItemNotFoundError,
    );
  });

  // Item ids come from name and unit alone, so B's own "brown sugar" collides with A's — the
  // household filter on the DELETE itself, not `getItem`'s prior guard, is what keeps B's delete
  // from also removing A's row.
  it("will not let one household's delete remove another's item of the same name", async () => {
    await addItem(A, "2026-W36", { name: "brown sugar", unit: "bag", category: "pantry" }, db);
    await addItem(B, "2026-W36", { name: "brown sugar", unit: "bag", category: "pantry" }, db);

    await deleteItem(B, "2026-W36", "brown-sugar_bag", db);

    await expect(listItems(A, "2026-W36", db)).resolves.toContainEqual(
      expect.objectContaining({ id: "brown-sugar_bag" }),
    );
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

  // B owns a plan named `2026-W36` but no day under it, so the plan id alone does not identify
  // the day. The composite foreign key stops the write either way; what the filter decides is
  // whether the caller is told which day is missing or the driver raises a constraint error
  // nothing can map to a 404.
  it("will not let one household's day satisfy another's plan link", async () => {
    await expect(
      recordMeal(
        B,
        { date: MONDAY, recipeId: "fajitas", title: "Fajitas", planId: "2026-W36" },
        db,
      ),
    ).rejects.toBeInstanceOf(PlanDayNotFoundError);

    await expect(listHistory(B, { withinDays: 10_000 }, db)).resolves.toEqual([]);
  });

  // Both households name their weeks `2026-W36`, so the plan id alone does not identify the day.
  it("will not let one household detach what another's day scheduled", async () => {
    await detachHistoryFromDay(B, "2026-W36", MONDAY, "dinner", db);

    await expect(getHistoryEntry(A, `${MONDAY}-fajitas`, db)).resolves.toMatchObject({
      planId: "2026-W36",
    });
  });
});

describe("planning rotation", () => {
  it("will not return another household's recipes", async () => {
    await createRecipe(B, "burgers", { ...recipe, title: "Burgers" }, [], db);

    await expect(planningRotation(A, db)).resolves.not.toContainEqual(
      expect.objectContaining({ recipeId: "burgers" }),
    );
  });

  it("will not let another household's mealHistory change this household's tiers", async () => {
    await recordMeal(B, { date: "2026-09-20", recipeId: "fajitas", title: "Fajitas" }, db);

    await expect(planningRotation(A, db)).resolves.toContainEqual(
      expect.objectContaining({ recipeId: "fajitas", tier: "unplanned" }),
    );
  });
});

describe("commitWeek", () => {
  it("does not see another household's recipes or days", async () => {
    await setConfigValue(B, "default_budget", "80", db);
    await createRecipe(B, "theirs", { title: "Theirs", baseServings: 8 }, [], db);

    // Their recipe must not satisfy our day's reference.
    await expect(
      commitWeek(
        A,
        "2026-W36",
        { days: [{ date: "2026-08-31", servings: 8, main: "theirs" }] },
        db,
      ),
    ).rejects.toThrow(UnknownRecipeError);

    // Their planned day must not block ours.
    await commitWeek(
      B,
      "2026-W36",
      {
        recipes: [{ recipeId: "ours", title: "Ours", baseServings: 8 }],
        days: [{ date: "2026-08-31", servings: 8, main: "ours" }],
      },
      db,
    );
    await createRecipe(A, "mine", { title: "Mine", baseServings: 8 }, [], db);

    const result = await commitWeek(
      A,
      "2026-W36",
      { days: [{ date: "2026-08-31", servings: 8, main: "mine" }] },
      db,
    );

    expect(result.days[0].main).toBe("mine");
    expect(await listHistory(B, {}, db)).toHaveLength(1);
    expect(await listHistory(A, {}, db)).toHaveLength(1);
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
  // A fixed past week, so nothing here depends on the clock. `weekOverview` falls back to the
  // latest plan when none is current, which is all these cases need; whether a week reads as the
  // current one is `overview.test.ts`'s question, and it covers both answers.
  const WEEK = "2026-W36";
  const MONDAY = "2026-08-31";

  beforeEach(async () => {
    await createPlan(A, WEEK, 120, db);
    await setPlanDay(A, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await replaceItems(
      A,
      WEEK,
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
    await createPlan(B, WEEK, 200, db);
    await setPlanDay(B, WEEK, MONDAY, "dinner", { servings: 4 }, db);

    await expect(weekOverview(B, db)).resolves.toEqual({
      planId: WEEK,
      isCurrentWeek: false,
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

    // The planned dates rather than a boolean over them: `every` reports "expected false to be
    // true" and names no day, so a leak through the filter would say nothing about which one.
    expect(week.days.filter((day) => day.planned).map((day) => day.date)).toEqual([]);
    expect(week.days).toHaveLength(7);
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

describe("shares", () => {
  it("hides another household's share token", async () => {
    await createShare(A, "fajitas", db);

    await expect(getShare(B, "fajitas", db)).resolves.toBeNull();
  });

  it("will not let one household revoke another's share", async () => {
    const { token } = await createShare(A, "fajitas", db);

    await expect(deleteShare(B, "fajitas", token, db)).resolves.toBe(false);
    await expect(getSharedRecipe(token, db)).resolves.not.toBeNull();
  });

  it("will not let one household share a recipe it cannot see", async () => {
    await expect(createShare(B, "fajitas", db)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });

  // The case the unscoped lookup exists for. Both households hold a `fajitas`, so a token that
  // resolved by recipe id rather than by the household on its own row would return the wrong
  // recipe — and `/r/{token}` has no session for a later check to catch it.
  it("resolves each token to its own household's recipe", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    const mine = await createShare(A, "fajitas", db);
    const theirs = await createShare(B, "fajitas", db);

    await expect(getSharedRecipe(mine.token, db)).resolves.toMatchObject({
      recipe: { householdId: A, title: "Fajitas" },
    });
    await expect(getSharedRecipe(theirs.token, db)).resolves.toMatchObject({
      recipe: { householdId: B, title: "Their Fajitas" },
    });
  });
});

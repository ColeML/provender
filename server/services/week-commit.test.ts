import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { getPlanDay, PlanDayNotFoundError } from "@server/services/plans";
import {
  createRecipe,
  getRecipe,
  RecipeExistsError,
  RecipeNotFoundError,
} from "@server/services/recipes";
import { listHistory, rateMeal } from "@server/services/history";

import {
  commitWeek,
  DaysAlreadyPlannedError,
  DuplicateCommitDayError,
  DuplicateCommitRecipeError,
  UnknownRecipeError,
  UnreferencedRecipeError,
} from "./week-commit";

const H = "loewer";
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";
const TUESDAY = "2026-09-01";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "default_budget", "120", db);
  await setConfigValue(H, "no_repeat_days", "30", db);
});

afterEach(async () => {
  await close();
});

/** A payload with one new recipe on Monday, which most cases start from. */
function oneDay(overrides: Partial<Parameters<typeof commitWeek>[2]> = {}) {
  return {
    budgetTarget: 95,
    recipes: [
      {
        recipeId: "gnocchi",
        title: "Sheet-Pan Gnocchi",
        baseServings: 8,
        totalMin: 30,
        ingredients: [{ name: "gnocchi", quantity: 32, unit: "oz", category: "pantry" as const }],
      },
    ],
    days: [{ date: MONDAY, servings: 8, main: "gnocchi", notes: "58F and wet" }],
    ...overrides,
  };
}

describe("commitWeek", () => {
  it("writes the plan, the recipes, the days and the derived history in one call", async () => {
    const result = await commitWeek(H, WEEK, oneDay(), db);

    expect(result.plan).toMatchObject({ id: WEEK, budgetTarget: "95.00" });
    expect(result.createdRecipeIds).toEqual(["gnocchi"]);
    expect(result.days).toHaveLength(1);

    const day = await getPlanDay(H, WEEK, MONDAY, "dinner", db);
    expect(day).toMatchObject({ servings: 8, main: "gnocchi", notes: "58F and wet" });

    const history = await listHistory(H, {}, db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: MONDAY,
      recipeId: "gnocchi",
      title: "Sheet-Pan Gnocchi",
      mealSlot: "dinner",
      planId: WEEK,
    });
  });

  it("records history only for the main, not the side or the extras", async () => {
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);
    await createRecipe(H, "brownies", { title: "Brownies", baseServings: 12 }, [], db);

    await commitWeek(
      H,
      WEEK,
      oneDay({
        days: [{ date: MONDAY, servings: 8, main: "gnocchi", side: "salad", extras: ["brownies"] }],
      }),
      db,
    );

    expect((await listHistory(H, {}, db)).map((entry) => entry.recipeId)).toEqual(["gnocchi"]);
  });

  it("writes no history for a day with no main", async () => {
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    const result = await commitWeek(
      H,
      WEEK,
      oneDay({ recipes: [], days: [{ date: MONDAY, servings: 8, side: "salad" }] }),
      db,
    );

    expect(result.historyEntryIds).toEqual([]);
    expect(await listHistory(H, {}, db)).toHaveLength(0);
  });

  it("rolls the whole commit back when a later recipe id is taken", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [
            { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
            { recipeId: "tacos", title: "Tacos Again", baseServings: 8 },
          ],
          days: [
            { date: MONDAY, servings: 8, main: "gnocchi" },
            { date: TUESDAY, servings: 8, main: "tacos" },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(/tacos/);

    // The first recipe, the plan, the days and the history are all absent: one transaction.
    await expect(getRecipe(H, "gnocchi", db)).rejects.toThrow(RecipeNotFoundError);
    expect(await listHistory(H, {}, db)).toHaveLength(0);
    expect(await db.query.plans.findFirst()).toBeUndefined();
    expect(await db.query.planDays.findFirst()).toBeUndefined();
  });

  it("leaves the existing recipe untouched when a commit collides with it", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [{ recipeId: "tacos", title: "Tacos Again", baseServings: 4 }],
          days: [{ date: MONDAY, servings: 8, main: "tacos" }],
        }),
        db,
      ),
    ).rejects.toThrow(RecipeExistsError);

    expect(await getRecipe(H, "tacos", db)).toMatchObject({ title: "Tacos", baseServings: 8 });
  });

  it("refuses a day already in the plan, and writes nothing else in the payload", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        {
          recipes: [{ recipeId: "chili", title: "Chili", baseServings: 8 }],
          days: [
            { date: MONDAY, servings: 4, main: "salad", notes: "overwritten" },
            { date: TUESDAY, servings: 8, main: "chili" },
          ],
        },
        db,
      ),
    ).rejects.toThrow(DaysAlreadyPlannedError);

    const monday = await getPlanDay(H, WEEK, MONDAY, "dinner", db);
    expect(monday).toMatchObject({ servings: 8, main: "gnocchi", notes: "58F and wet" });

    await expect(getRecipe(H, "chili", db)).rejects.toThrow(RecipeNotFoundError);
    await expect(getPlanDay(H, WEEK, TUESDAY, "dinner", db)).rejects.toThrow(PlanDayNotFoundError);
  });

  it("overwrites a day when the caller opts in", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    await commitWeek(
      H,
      WEEK,
      {
        replaceExistingDays: true,
        days: [{ date: MONDAY, servings: 4, main: "salad", notes: "swapped" }],
      },
      db,
    );

    expect(await getPlanDay(H, WEEK, MONDAY, "dinner", db)).toMatchObject({
      servings: 4,
      main: "salad",
      notes: "swapped",
    });
  });

  it("drops the replaced main's history entry when a day is overwritten", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    await commitWeek(
      H,
      WEEK,
      { replaceExistingDays: true, days: [{ date: MONDAY, servings: 4, main: "salad" }] },
      db,
    );

    const history = await listHistory(H, {}, db);

    expect(history).toHaveLength(1);
    expect(history[0].recipeId).toBe("salad");
  });

  it("accepts a day the plan does not have without the flag, and leaves the others alone", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "chili", { title: "Chili", baseServings: 8 }, [], db);

    await commitWeek(H, WEEK, { days: [{ date: TUESDAY, servings: 8, main: "chili" }] }, db);

    expect(await getPlanDay(H, WEEK, MONDAY, "dinner", db)).toMatchObject({ main: "gnocchi" });
    expect(await getPlanDay(H, WEEK, TUESDAY, "dinner", db)).toMatchObject({ main: "chili" });
  });

  it("succeeds on a retry after a rolled-back attempt, with no flag", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    const doomed = oneDay({
      recipes: [
        { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
        { recipeId: "tacos", title: "Tacos Again", baseServings: 8 },
      ],
      days: [
        { date: MONDAY, servings: 8, main: "gnocchi" },
        { date: TUESDAY, servings: 8, main: "tacos" },
      ],
    });

    await expect(commitWeek(H, WEEK, doomed, db)).rejects.toThrow(RecipeExistsError);

    // The failed attempt left no plan and no days, so the retry needs no replaceExistingDays.
    const result = await commitWeek(H, WEEK, oneDay(), db);

    expect(result.days).toHaveLength(1);
  });

  it("keeps a rating given between two commits of the same week", async () => {
    const first = await commitWeek(H, WEEK, oneDay(), db);

    await rateMeal(H, first.historyEntryIds[0], { rating: 5 }, ["rating"], db);
    await commitWeek(H, WEEK, { replaceExistingDays: true, days: oneDay().days }, db);

    const history = await listHistory(H, {}, db);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ rating: 5 });
  });

  it("leaves the stored budget alone when a re-commit names none", async () => {
    await commitWeek(H, WEEK, oneDay(), db);

    const again = await commitWeek(H, WEEK, { replaceExistingDays: true, days: oneDay().days }, db);

    expect(again.plan.budgetTarget).toBe("95.00");
  });

  it("names the dish when a day references a recipe that does not exist", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        { recipes: [], days: [{ date: MONDAY, servings: 8, main: "ghost" }] },
        db,
      ),
    ).rejects.toThrow(UnknownRecipeError);

    expect(await db.query.plans.findFirst()).toBeUndefined();
  });

  it("rejects a date outside the plan's own week", async () => {
    await expect(
      commitWeek(H, WEEK, oneDay({ days: [{ date: "2026-09-08", servings: 8 }] }), db),
    ).rejects.toThrow(/2026-W37/);
  });

  it("rejects two days sharing a date and slot", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          days: [
            { date: MONDAY, servings: 8, main: "gnocchi" },
            { date: MONDAY, servings: 4 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(DuplicateCommitDayError);
  });

  it("allows two slots on the same date", async () => {
    await createRecipe(H, "oats", { title: "Oats", baseServings: 4 }, [], db);

    const result = await commitWeek(
      H,
      WEEK,
      oneDay({
        days: [
          { date: MONDAY, servings: 8, main: "gnocchi" },
          { date: MONDAY, mealSlot: "breakfast" as const, servings: 4, main: "oats" },
        ],
      }),
      db,
    );

    expect(result.days).toHaveLength(2);
    expect(result.historyEntryIds).toHaveLength(2);
  });

  it("rejects a recipe no day names, and writes nothing", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [
            { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
            { recipeId: "chili-verde", title: "Chili Verde", baseServings: 8 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(UnreferencedRecipeError);

    expect(await db.query.plans.findFirst()).toBeUndefined();
  });

  it("accepts a recipe named only as a side or in extras", async () => {
    const result = await commitWeek(
      H,
      WEEK,
      oneDay({
        recipes: [
          { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
          { recipeId: "salad", title: "Green Salad", baseServings: 10 },
          { recipeId: "brownies", title: "Brownies", baseServings: 12 },
        ],
        days: [
          {
            date: MONDAY,
            servings: 8,
            main: "gnocchi",
            side: "salad",
            extras: ["brownies"],
            notes: "58F and wet",
          },
        ],
      }),
      db,
    );

    expect(result.createdRecipeIds).toEqual(["gnocchi", "salad", "brownies"]);
  });

  it("rejects two recipes sharing an id", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [
            { recipeId: "gnocchi", title: "One", baseServings: 8 },
            { recipeId: "gnocchi", title: "Two", baseServings: 8 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(DuplicateCommitRecipeError);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import { schema, type Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { createRecipe } from "@server/services/recipes";
import { recordMeal } from "@server/services/history";

import { planningRotation } from "./planning";

const H = "loewer";
const OTHER = "other-household";

let db: Database;
let close: () => Promise<void>;

/** A date `days` ago, so tests do not depend on the calendar. */
function daysAgo(days: number) {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
}

async function recipe(householdId: string, id: string, title: string) {
  await createRecipe(householdId, id, { title, baseServings: 4, totalMin: 30 }, [], db);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "no_repeat_days", "30", db);
});

afterEach(async () => {
  await close();
});

async function tierOf(recipeId: string) {
  const rows = await planningRotation(H, db);

  return rows.find((row) => row.recipeId === recipeId);
}

describe("planningRotation", () => {
  it("puts a recipe with no history in the unplanned tier", async () => {
    await recipe(H, "ziti", "Baked Ziti");

    expect(await tierOf("ziti")).toMatchObject({
      tier: "unplanned",
      lastPlanned: null,
      timesPlanned: 0,
      daysUntilEligible: null,
    });
  });

  it("treats a dish planned exactly no_repeat_days ago as eligible", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(30), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({
      tier: "eligible",
      lastPlanned: daysAgo(30),
      timesPlanned: 1,
      daysUntilEligible: null,
    });
  });

  it("blocks a dish planned one day inside the window, and says when it frees up", async () => {
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recordMeal(H, { date: daysAgo(29), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    expect(await tierOf("pizza")).toMatchObject({
      tier: "blocked",
      lastPlanned: daysAgo(29),
      daysUntilEligible: 1,
    });
  });

  it("counts every planning of a dish and reports the most recent", async () => {
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recordMeal(H, { date: daysAgo(90), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);
    await recordMeal(H, { date: daysAgo(45), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    expect(await tierOf("pizza")).toMatchObject({
      tier: "eligible",
      lastPlanned: daysAgo(45),
      timesPlanned: 2,
    });
  });

  it("counts a breakfast or lunch entry, not just dinner", async () => {
    await recipe(H, "pancakes", "Buttermilk Pancakes");
    await recordMeal(
      H,
      {
        date: daysAgo(5),
        recipeId: "pancakes",
        title: "Buttermilk Pancakes",
        mealSlot: "breakfast",
      },
      db,
    );

    expect(await tierOf("pancakes")).toMatchObject({ tier: "blocked", lastPlanned: daysAgo(5) });
  });

  it("ignores a history entry naming a recipe that no longer exists", async () => {
    await recipe(H, "ziti", "Baked Ziti");
    await recordMeal(H, { date: daysAgo(1), recipeId: "deleted-dish", title: "Gone" }, db);

    const rows = await planningRotation(H, db);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipeId: "ziti", tier: "unplanned" });
  });

  it("orders unplanned first, then eligible oldest-first, then blocked", async () => {
    await recipe(H, "ziti", "Baked Ziti");
    await recipe(H, "tacos", "Tacos");
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recipe(H, "chili", "Chili");
    await recordMeal(H, { date: daysAgo(31), recipeId: "tacos", title: "Tacos" }, db);
    await recordMeal(H, { date: daysAgo(90), recipeId: "chili", title: "Chili" }, db);
    await recordMeal(H, { date: daysAgo(2), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    const rows = await planningRotation(H, db);

    expect(rows.map((row) => row.recipeId)).toEqual(["ziti", "chili", "tacos", "pizza"]);
  });

  it("breaks a tie between two unplanned recipes by title, not insertion order", async () => {
    await recipe(H, "zeta", "Zeta Bake");
    await recipe(H, "alpha", "Alpha Bake");

    const rows = await planningRotation(H, db);

    expect(rows.map((row) => row.recipeId)).toEqual(["alpha", "zeta"]);
  });

  it("carries the fields a planner needs, so it needs no second catalog call", async () => {
    await createRecipe(
      H,
      "ziti",
      {
        title: "Baked Ziti",
        baseServings: 8,
        totalMin: 65,
        costEstimate: 16.84,
        tags: ["italian"],
      },
      [],
      db,
    );

    expect(await tierOf("ziti")).toMatchObject({
      title: "Baked Ziti",
      tags: ["italian"],
      totalMin: 65,
      costEstimate: 16.84,
    });
  });

  it("will not let another household's history change this household's tiers", async () => {
    await db.insert(schema.households).values({ id: OTHER, name: "Other" });
    await recipe(H, "tacos", "Tacos");
    await recipe(OTHER, "tacos", "Tacos");
    await recordMeal(OTHER, { date: daysAgo(1), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({ tier: "unplanned", timesPlanned: 0 });
  });

  it("will not return another household's recipes", async () => {
    await db.insert(schema.households).values({ id: OTHER, name: "Other" });
    await recipe(OTHER, "ziti", "Baked Ziti");

    expect(await planningRotation(H, db)).toEqual([]);
  });

  it("reports no rating for a recipe with no history", async () => {
    await recipe(H, "ziti", "Baked Ziti");

    expect(await tierOf("ziti")).toMatchObject({ rating: null });
  });

  it("reports no rating for a recipe with history but no rating on any entry", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(10), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({ rating: null });
  });

  it("reports the rating from a recipe's only entry", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(10), recipeId: "tacos", title: "Tacos", rating: 5 }, db);

    expect(await tierOf("tacos")).toMatchObject({ rating: 5 });
  });

  it("reports the rating from the more recent of two rated entries", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(90), recipeId: "tacos", title: "Tacos", rating: 2 }, db);
    await recordMeal(H, { date: daysAgo(10), recipeId: "tacos", title: "Tacos", rating: 5 }, db);

    expect(await tierOf("tacos")).toMatchObject({ rating: 5 });
  });

  it("falls back to an older rated entry when the most recent entry is unrated, without disturbing lastPlanned", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(90), recipeId: "tacos", title: "Tacos", rating: 4 }, db);
    await recordMeal(H, { date: daysAgo(10), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({
      rating: 4,
      lastPlanned: daysAgo(10),
    });
  });
});

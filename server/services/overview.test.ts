import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { isoWeekFor } from "@server/lib/iso-week";
import { createPlan, setPlanDay } from "@server/services/plans";
import { createRecipe } from "@server/services/recipes";
import { replaceItems, updateItem } from "@server/services/shopping";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { weekOverview } from "./overview";

const H = "loewer";
const THIS_WEEK = isoWeekFor(new Date().toISOString().slice(0, 10));

let db: Database;
let close: () => Promise<void>;

/** A date inside `THIS_WEEK`, so the overview treats it as the current week rather than a fallback. */
function mondayOfThisWeek() {
  const today = new Date();
  const monday = new Date(today);

  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

  return monday.toISOString().slice(0, 10);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("weekOverview", () => {
  it("reports no plan rather than failing when nothing is planned", async () => {
    expect(await weekOverview(H, db)).toEqual({
      planId: null,
      isCurrentWeek: false,
      days: [],
      outstandingItems: 0,
    });
  });

  it("names the main for each planned day", async () => {
    await createPlan(H, THIS_WEEK, 120, db);
    await createRecipe(H, "fajitas", { title: "Chicken Fajitas", baseServings: 8 }, [], db);
    await setPlanDay(
      H,
      THIS_WEEK,
      mondayOfThisWeek(),
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );

    const overview = await weekOverview(H, db);

    expect(overview.planId).toBe(THIS_WEEK);
    expect(overview.isCurrentWeek).toBe(true);
    expect(overview.days).toEqual([
      {
        date: mondayOfThisWeek(),
        mealSlot: "dinner",
        status: "planned",
        mainRecipeId: "fajitas",
        mainTitle: "Chicken Fajitas",
      },
    ]);
  });

  it("keeps a planned day that has no main, so a potluck is not lost", async () => {
    await createPlan(H, THIS_WEEK, 120, db);
    await createRecipe(H, "cake", { title: "Cake", baseServings: 8 }, [], db);
    await setPlanDay(
      H,
      THIS_WEEK,
      mondayOfThisWeek(),
      "dinner",
      { servings: 24, status: "potluck", extras: ["cake"] },
      db,
    );

    expect((await weekOverview(H, db)).days).toEqual([
      {
        date: mondayOfThisWeek(),
        mealSlot: "dinner",
        status: "potluck",
        mainRecipeId: null,
        mainTitle: null,
      },
    ]);
  });

  it("counts only what is still to buy", async () => {
    await createPlan(H, THIS_WEEK, 120, db);

    const items = await replaceItems(
      H,
      THIS_WEEK,
      [
        { name: "onion", quantity: 2, unit: "ea", category: "produce", feedsRecipes: [] },
        { name: "beef", quantity: 1, unit: "lb", category: "meat", feedsRecipes: [] },
        { name: "salt", quantity: 1, unit: "ea", category: "pantry", feedsRecipes: [] },
      ],
      db,
    );

    const idOf = (name: string) => items.find((item) => item.name === name)!.id;

    await updateItem(H, THIS_WEEK, idOf("onion"), { purchased: true }, ["purchased"], db);
    await updateItem(H, THIS_WEEK, idOf("salt"), { haveAlready: true }, ["haveAlready"], db);

    expect((await weekOverview(H, db)).outstandingItems).toBe(1);
  });

  it("tells a dinner and a lunch on one date apart", async () => {
    await createPlan(H, THIS_WEEK, 120, db);
    await createRecipe(H, "fajitas", { title: "Chicken Fajitas", baseServings: 8 }, [], db);
    await createRecipe(H, "soup", { title: "Tortilla Soup", baseServings: 8 }, [], db);
    await setPlanDay(
      H,
      THIS_WEEK,
      mondayOfThisWeek(),
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );
    await setPlanDay(H, THIS_WEEK, mondayOfThisWeek(), "lunch", { servings: 4, main: "soup" }, db);

    // Without a mealSlot in the key, both days would claim the same main.
    expect((await weekOverview(H, db)).days.map((day) => [day.mealSlot, day.mainTitle])).toEqual([
      ["dinner", "Chicken Fajitas"],
      ["lunch", "Tortilla Soup"],
    ]);
  });

  it("falls back to the most recent week, and says it is not the current one", async () => {
    await createPlan(H, "2020-W01", 100, db);

    const overview = await weekOverview(H, db);

    expect(overview.planId).toBe("2020-W01");
    expect(overview.isCurrentWeek).toBe(false);
  });

  it("keeps one household's week out of another's", async () => {
    await createPlan(H, THIS_WEEK, 120, db);
    await createRecipe(H, "fajitas", { title: "Chicken Fajitas", baseServings: 8 }, [], db);
    await setPlanDay(
      H,
      THIS_WEEK,
      mondayOfThisWeek(),
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );

    expect(await weekOverview("someone-else", db)).toMatchObject({ planId: null, days: [] });
  });
});

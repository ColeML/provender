import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { isoWeekFor } from "@server/lib/iso-week";
import { createPlan, setPlanDay } from "@server/services/plans";
import { createRecipe } from "@server/services/recipes";
import { replaceItems, updateItem } from "@server/services/shopping";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { weekOverview } from "./overview";

const H = "loewer";

/**
 * A fixed Wednesday, held for the whole file.
 *
 * `isCurrentWeek` compares the plan's id against `isoWeekFor(new Date())` read when the service is
 * called, so anything deriving the expected week from a second reading of the real clock can
 * straddle a UTC midnight and disagree with it. Only `Date` is faked — the in-process Postgres and
 * every await still run on real timers.
 */
const NOW = new Date("2026-09-16T12:00:00.000Z");
const THIS_WEEK = isoWeekFor(NOW.toISOString().slice(0, 10));
const MONDAY_OF_THIS_WEEK = "2026-09-14";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
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
      MONDAY_OF_THIS_WEEK,
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );

    const overview = await weekOverview(H, db);

    expect(overview.planId).toBe(THIS_WEEK);
    expect(overview.isCurrentWeek).toBe(true);
    expect(overview.days).toEqual([
      {
        date: MONDAY_OF_THIS_WEEK,
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
      MONDAY_OF_THIS_WEEK,
      "dinner",
      { servings: 24, status: "potluck", extras: ["cake"] },
      db,
    );

    expect((await weekOverview(H, db)).days).toEqual([
      {
        date: MONDAY_OF_THIS_WEEK,
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
      MONDAY_OF_THIS_WEEK,
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );
    await setPlanDay(H, THIS_WEEK, MONDAY_OF_THIS_WEEK, "lunch", { servings: 4, main: "soup" }, db);

    // Without a mealSlot in the key, both days would claim the same main. Lunch comes first
    // because the day reads in meal order, not in the order the enum happens to be stored in.
    expect((await weekOverview(H, db)).days.map((day) => [day.mealSlot, day.mainTitle])).toEqual([
      ["lunch", "Tortilla Soup"],
      ["dinner", "Chicken Fajitas"],
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
      MONDAY_OF_THIS_WEEK,
      "dinner",
      { servings: 8, main: "fajitas" },
      db,
    );

    expect(await weekOverview("someone-else", db)).toMatchObject({ planId: null, days: [] });
  });
});

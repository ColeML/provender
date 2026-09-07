import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { createPlan, deletePlanDay, setPlanDay } from "@server/services/plans";
import { createRecipe, deleteRecipe } from "@server/services/recipes";

import { InvalidDateError, PlanDayNotFoundError } from "@server/services/plans";
import {
  deleteHistoryEntry,
  getHistoryEntry,
  listHistory,
  MealHistoryNotFoundError,
  rateMeal,
  recordMeal,
} from "./history";

const H = "loewer";
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";

let db: Database;
let close: () => Promise<void>;

/** A date `days` ago, so tests do not depend on the calendar. */
function daysAgo(days: number) {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "no_repeat_days", "30", db);
  await setConfigValue(H, "default_budget", "120", db);

  for (const id of ["fajitas", "ziti"]) {
    await createRecipe(H, id, { title: id, baseServings: 8 }, [], db);
  }
});

afterEach(async () => {
  await close();
});

describe("recordMeal", () => {
  it("keys on the date and recipe, so re-planning the same day does not duplicate", async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Chicken Fajitas" }, db);

    const entries = await listHistory(H, { withinDays: 10_000 }, db);

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Chicken Fajitas");
  });
});

describe("recordMeal validation", () => {
  it.each(["2026-13-45", "2026-02-30"])(
    "refuses %s rather than failing in the driver",
    async (date) => {
      await expect(
        recordMeal(H, { date, recipeId: "fajitas", title: "Fajitas" }, db),
      ).rejects.toBeInstanceOf(InvalidDateError);
    },
  );

  it("refuses to link to a day that is not planned", async () => {
    await expect(
      recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas", planId: WEEK }, db),
    ).rejects.toBeInstanceOf(PlanDayNotFoundError);
  });

  it("keeps an existing rating when a re-plan does not mention one", async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas", rating: 5 }, db);
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);

    expect((await getHistoryEntry(H, `${MONDAY}-fajitas`, db)).rating).toBe(5);
  });

  it("applies a rating the caller actually sent, rather than ignoring it", async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas", rating: 5 }, db);
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas", rating: 2 }, db);

    expect((await getHistoryEntry(H, `${MONDAY}-fajitas`, db)).rating).toBe(2);
  });
});

describe("listHistory", () => {
  beforeEach(async () => {
    await recordMeal(H, { date: daysAgo(5), recipeId: "fajitas", title: "Fajitas" }, db);
    await recordMeal(H, { date: daysAgo(90), recipeId: "ziti", title: "Ziti" }, db);
  });

  it("returns only what was planned inside the window", async () => {
    const recent = await listHistory(H, { withinDays: 30 }, db);

    expect(recent.map((entry) => entry.recipeId)).toEqual(["fajitas"]);
  });

  it("falls back to the household's no_repeat_days", async () => {
    await setConfigValue(H, "no_repeat_days", "365", db);

    expect(await listHistory(H, {}, db)).toHaveLength(2);
  });

  it("returns newest first", async () => {
    const all = await listHistory(H, { withinDays: 10_000 }, db);

    expect(all.map((entry) => entry.recipeId)).toEqual(["fajitas", "ziti"]);
  });
});

describe("rateMeal", () => {
  beforeEach(async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);
  });

  it("records a rating and notes", async () => {
    const entry = await rateMeal(
      H,
      `${MONDAY}-fajitas`,
      { rating: 5, notes: "kids loved it" },
      ["rating", "notes"],
      db,
    );

    expect(entry.rating).toBe(5);
    expect(entry.notes).toBe("kids loved it");
  });

  it("leaves notes alone when the mask names only the rating", async () => {
    await rateMeal(H, `${MONDAY}-fajitas`, { rating: 4, notes: "first" }, ["rating", "notes"], db);
    await rateMeal(H, `${MONDAY}-fajitas`, { rating: 2 }, ["rating"], db);

    const entry = await getHistoryEntry(H, `${MONDAY}-fajitas`, db);

    expect(entry.rating).toBe(2);
    expect(entry.notes).toBe("first");
  });

  it("reports a missing entry rather than creating one", async () => {
    await expect(rateMeal(H, "nope", { rating: 5 }, ["rating"], db)).rejects.toBeInstanceOf(
      MealHistoryNotFoundError,
    );
  });
});

describe("deleteHistoryEntry", () => {
  it("forgets a meal, which v1 could not do", async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);

    await deleteHistoryEntry(H, `${MONDAY}-fajitas`, db);

    expect(await listHistory(H, { withinDays: 10_000 }, db)).toEqual([]);
  });
});

describe("clearing a planned day", () => {
  beforeEach(async () => {
    await createPlan(H, WEEK, 120, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas", planId: WEEK }, db);
  });

  it("forgets the meal too, so a dinner that never happened stops blocking itself", async () => {
    await deletePlanDay(H, WEEK, MONDAY, "dinner", {}, db);

    expect(await listHistory(H, { withinDays: 10_000 }, db)).toEqual([]);
  });

  it("keeps the meal when asked, for a day that happened anyway", async () => {
    await deletePlanDay(H, WEEK, MONDAY, "dinner", { keepHistory: true }, db);

    const entries = await listHistory(H, { withinDays: 10_000 }, db);

    expect(entries).toHaveLength(1);
    expect(entries[0].planId).toBeNull();
  });
});

describe("deleting a recipe that has been planned", () => {
  beforeEach(async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);
  });

  it("is allowed, unlike a recipe on a live plan", async () => {
    await expect(deleteRecipe(H, "fajitas", db)).resolves.toBeUndefined();
  });

  it("leaves the entry readable, since it carries its own title", async () => {
    await deleteRecipe(H, "fajitas", db);

    const entry = await getHistoryEntry(H, `${MONDAY}-fajitas`, db);

    // The id is kept rather than nulled — history is a log, and a dangling id matches nothing.
    expect(entry.recipeId).toBe("fajitas");
    expect(entry.title).toBe("Fajitas");
  });
});

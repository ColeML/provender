import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import {
  createPlan,
  InvalidPlanIdError,
  PlanNotFoundError,
  setPlanDay,
} from "@server/services/plans";
import { createRecipe } from "@server/services/recipes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { daySlots, weekPlan } from "./week-plan";

const H = "loewer";
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";
const TUESDAY = "2026-09-01";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await createPlan(H, WEEK, 120, db);
  await createRecipe(
    H,
    "fajitas",
    { title: "Chicken Fajitas", baseServings: 8, costEstimate: 12.5 },
    [],
    db,
  );
  await createRecipe(
    H,
    "rice",
    { title: "Cilantro Lime Rice", baseServings: 5, costEstimate: 2 },
    [],
    db,
  );
  await createRecipe(H, "cake", { title: "Cake", baseServings: 8, costEstimate: 4.25 }, [], db);
});

afterEach(async () => {
  await close();
});

describe("weekPlan", () => {
  it("always returns seven days, planned or not", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    const week = await weekPlan(H, WEEK, db);

    expect(week.days).toHaveLength(7);
    expect(week.days.map((day) => day.planned)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(week.days[0].date).toBe(MONDAY);
  });

  it("names and prices every recipe on a day", async () => {
    await setPlanDay(
      H,
      WEEK,
      MONDAY,
      "dinner",
      { servings: 8, main: "fajitas", side: "rice", extras: ["cake"] },
      db,
    );

    const [monday] = (await weekPlan(H, WEEK, db)).days;

    expect(monday.main).toMatchObject({
      recipeId: "fajitas",
      title: "Chicken Fajitas",
      costEstimate: 12.5,
    });
    expect(monday.side).toMatchObject({ recipeId: "rice", title: "Cilantro Lime Rice" });
    expect(monday.extras.map((extra) => extra.title)).toEqual(["Cake"]);
  });

  it("sums the week against the budget it was planned with", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas", side: "rice" }, db);
    await setPlanDay(H, WEEK, TUESDAY, "dinner", { servings: 8, main: "cake" }, db);

    const week = await weekPlan(H, WEEK, db);

    expect(week.budgetTarget).toBe(120);
    expect(week.estimatedCost).toBe(18.75);
  });

  it("counts a day with no main but with extras, which is what a potluck is", async () => {
    await setPlanDay(
      H,
      WEEK,
      MONDAY,
      "dinner",
      { servings: 24, status: "potluck", extras: ["cake"] },
      db,
    );

    const [monday] = (await weekPlan(H, WEEK, db)).days;

    expect(monday).toMatchObject({ planned: true, status: "potluck", main: null, servings: 24 });
    expect(monday.extras.map((extra) => extra.title)).toEqual(["Cake"]);
  });

  it("gives an unplanned day a column and no recipes", async () => {
    const [monday] = (await weekPlan(H, WEEK, db)).days;

    expect(monday).toMatchObject({
      planned: false,
      status: "unplanned",
      servings: null,
      main: null,
      side: null,
      extras: [],
    });
  });

  it("ignores a lunch, so it cannot take the dinner's column", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await setPlanDay(H, WEEK, MONDAY, "lunch", { servings: 4, main: "rice" }, db);

    const week = await weekPlan(H, WEEK, db);

    expect(week.days).toHaveLength(7);
    expect(week.days[0].main?.recipeId).toBe("fajitas");
  });

  it("rejects an id that is not an ISO week", async () => {
    await expect(weekPlan(H, "last week", db)).rejects.toThrow(InvalidPlanIdError);
  });

  it("reports a week that was never planned", async () => {
    await expect(weekPlan(H, "2026-W37", db)).rejects.toThrow(PlanNotFoundError);
  });

  it("keeps one household's week out of another's", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    await expect(weekPlan("someone-else", WEEK, db)).rejects.toThrow(PlanNotFoundError);
  });
});

describe("daySlots", () => {
  it("returns every meal on the date, in the order they are eaten", async () => {
    await createRecipe(H, "oatmeal", { title: "Baked Oatmeal", baseServings: 8 }, [], db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await setPlanDay(H, WEEK, MONDAY, "lunch", { servings: 4, main: "rice" }, db);
    await setPlanDay(H, WEEK, MONDAY, "breakfast", { servings: 4, main: "oatmeal" }, db);

    const slots = await daySlots(H, MONDAY, db);

    expect(slots.map((slot) => [slot.mealSlot, slot.main?.title])).toEqual([
      ["breakfast", "Baked Oatmeal"],
      ["lunch", "Cilantro Lime Rice"],
      ["dinner", "Chicken Fajitas"],
    ]);
  });

  it("returns a lunch that has no dinner beside it, which weekPlan drops", async () => {
    await setPlanDay(H, WEEK, MONDAY, "lunch", { servings: 4, main: "rice" }, db);

    expect((await daySlots(H, MONDAY, db)).map((slot) => slot.mealSlot)).toEqual(["lunch"]);
    // The grid is dinners only, so the same date reads as unplanned there.
    expect((await weekPlan(H, WEEK, db)).days[0].planned).toBe(false);
  });

  it("returns nothing for a date with no rows", async () => {
    expect(await daySlots(H, TUESDAY, db)).toEqual([]);
  });

  it("keeps one household's day out of another's", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    await expect(daySlots("someone-else", MONDAY, db)).rejects.toThrow(PlanNotFoundError);
  });
});

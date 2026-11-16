import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { schema, type Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { createPlan, deletePlanDay, InvalidDateError, setPlanDay } from "@server/services/plans";
import { createRecipe } from "@server/services/recipes";
import { sql } from "drizzle-orm";

import { createDayShare, getDayShare, getSharedDay } from "./day-shares";

const HOUSEHOLD = "loewer";
const WEEK = "2026-W37";
const MONDAY = "2026-09-07";
const TUESDAY = "2026-09-08";
const UNPLANNED_WEEK_DAY = "2026-09-15";

let db: Database;
let close: () => Promise<void>;

async function expire(token: string) {
  await db
    .update(schema.dayShares)
    .set({ expireTime: sql`now() - interval '1 second'` })
    .where(sql`${schema.dayShares.token} = ${token}`);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await createRecipe(
    HOUSEHOLD,
    "fajitas",
    {
      title: "Chicken Fajitas",
      baseServings: 8,
      totalMin: 40,
      instructions: ["Slice {3|bell pepper} peppers.", "Cook."],
    },
    [
      { name: "bell pepper", quantity: 3, unit: "ea", category: "produce", scaling: "linear" },
      { name: "chili powder", quantity: 2, unit: "Tbsp", category: "pantry", scaling: "seasoning" },
    ],
    db,
  );
  await createRecipe(HOUSEHOLD, "rice", { title: "Cilantro Lime Rice", baseServings: 6 }, [], db);
  await createRecipe(HOUSEHOLD, "oatmeal", { title: "Baked Oatmeal", baseServings: 8 }, [], db);
  await createPlan(HOUSEHOLD, WEEK, 120, db);
});

afterEach(async () => {
  await close();
});

describe("createDayShare", () => {
  it("mints a token long enough not to be guessed, live for 3 days", async () => {
    const share = await createDayShare(HOUSEHOLD, MONDAY, db);

    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share.expireTime.getTime() - share.createTime.getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("returns the same link again while it is live", async () => {
    const first = await createDayShare(HOUSEHOLD, MONDAY, db);
    const second = await createDayShare(HOUSEHOLD, MONDAY, db);

    expect(second.token).toEqual(first.token);
  });

  it("replaces an expired link with a new token", async () => {
    const first = await createDayShare(HOUSEHOLD, MONDAY, db);
    await expire(first.token);

    const second = await createDayShare(HOUSEHOLD, MONDAY, db);

    expect(second.token).not.toEqual(first.token);
    expect(await getSharedDay(first.token, db)).toBeNull();
    expect(await getSharedDay(second.token, db)).not.toBeNull();
  });

  it("gives two dates different tokens", async () => {
    const monday = await createDayShare(HOUSEHOLD, MONDAY, db);
    const tuesday = await createDayShare(HOUSEHOLD, TUESDAY, db);

    expect(monday.token).not.toEqual(tuesday.token);
  });

  it("refuses a string that is not a calendar date", async () => {
    await expect(createDayShare(HOUSEHOLD, "2026-02-30", db)).rejects.toThrow(InvalidDateError);
  });
});

describe("getDayShare", () => {
  it("returns the live link for a date", async () => {
    const minted = await createDayShare(HOUSEHOLD, MONDAY, db);

    expect((await getDayShare(HOUSEHOLD, MONDAY, db))?.token).toEqual(minted.token);
  });

  it("returns null once the link has expired", async () => {
    const { token } = await createDayShare(HOUSEHOLD, MONDAY, db);
    await expire(token);

    expect(await getDayShare(HOUSEHOLD, MONDAY, db)).toBeNull();
  });

  it("returns null for a date that was never shared", async () => {
    expect(await getDayShare(HOUSEHOLD, MONDAY, db)).toBeNull();
  });
});

describe("getSharedDay", () => {
  it("returns every meal on the date in eating order, with each dish's recipe as stored", async () => {
    await setPlanDay(
      HOUSEHOLD,
      WEEK,
      MONDAY,
      "dinner",
      { servings: 8, main: "fajitas", side: "rice", notes: "Bedtime at 8." },
      db,
    );
    await setPlanDay(HOUSEHOLD, WEEK, MONDAY, "breakfast", { servings: 4, main: "oatmeal" }, db);
    const { token } = await createDayShare(HOUSEHOLD, MONDAY, db);

    const shared = await getSharedDay(token, db);

    expect(shared?.date).toEqual(MONDAY);
    expect(shared?.slots.map((slot) => [slot.mealSlot, slot.main?.recipeId])).toEqual([
      ["breakfast", "oatmeal"],
      ["dinner", "fajitas"],
    ]);
    expect(shared?.slots[1].notes).toEqual("Bedtime at 8.");
    expect(shared?.recipes.fajitas).toMatchObject({
      title: "Chicken Fajitas",
      baseServings: 8,
      instructions: ["Slice {3|bell pepper} peppers.", "Cook."],
    });
    expect(
      shared?.recipes.fajitas.ingredients.map((row) => [row.name, Number(row.quantity), row.unit]),
    ).toEqual([
      ["bell pepper", 3, "ea"],
      ["chili powder", 2, "tbsp"],
    ]);
    expect(Object.keys(shared?.recipes ?? {}).sort()).toEqual(["fajitas", "oatmeal", "rice"]);
  });

  it("reads the day live, so an edit made after sharing shows up", async () => {
    const { token } = await createDayShare(HOUSEHOLD, MONDAY, db);
    await setPlanDay(HOUSEHOLD, WEEK, MONDAY, "dinner", { servings: 8, main: "rice" }, db);

    expect((await getSharedDay(token, db))?.slots.map((slot) => slot.main?.recipeId)).toEqual([
      "rice",
    ]);
  });

  it("returns an empty day, not null, for a date with nothing planned", async () => {
    await setPlanDay(HOUSEHOLD, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    const { token } = await createDayShare(HOUSEHOLD, MONDAY, db);
    await deletePlanDay(HOUSEHOLD, WEEK, MONDAY, "dinner", {}, db);

    expect(await getSharedDay(token, db)).toEqual({ date: MONDAY, slots: [], recipes: {} });
  });

  it("returns an empty day for a week nobody has planned", async () => {
    const { token } = await createDayShare(HOUSEHOLD, UNPLANNED_WEEK_DAY, db);

    expect(await getSharedDay(token, db)).toEqual({
      date: UNPLANNED_WEEK_DAY,
      slots: [],
      recipes: {},
    });
  });

  it("returns null for an expired token", async () => {
    const { token } = await createDayShare(HOUSEHOLD, MONDAY, db);
    await expire(token);

    expect(await getSharedDay(token, db)).toBeNull();
  });

  it("returns null for a token nobody minted", async () => {
    expect(await getSharedDay("not-a-token", db)).toBeNull();
  });
});

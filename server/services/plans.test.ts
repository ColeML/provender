import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { createRecipe, deleteRecipe } from "@server/services/recipes";

import {
  createPlan,
  DateOutsidePlanError,
  DuplicateRecipeError,
  InvalidDateError,
  deletePlan,
  deletePlanDay,
  getPlan,
  getPlanDay,
  InvalidPlanIdError,
  PlanDayNotFoundError,
  PlanExistsError,
  PlanNotFoundError,
  setPlanDay,
  updatePlan,
} from "./plans";

const H = "loewer";
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "default_budget", "120", db);

  for (const id of ["fajitas", "pico", "cornbread", "brownies"]) {
    await createRecipe(H, id, { title: id, baseServings: 8 }, [], db);
  }
});

afterEach(async () => {
  await close();
});

describe("createPlan", () => {
  it("takes the budget target from Config when none is given", async () => {
    const plan = await createPlan(H, WEEK, undefined, db);

    expect(plan.budgetTarget).toBe("120.00");
  });

  it("keeps the target it was created with when the default changes later", async () => {
    await createPlan(H, WEEK, undefined, db);
    await setConfigValue(H, "default_budget", "200", db);

    const { plan } = await getPlan(H, WEEK, db);

    expect(plan.budgetTarget).toBe("120.00");
  });

  it("refuses a duplicate week rather than creating a second one", async () => {
    await createPlan(H, WEEK, undefined, db);

    await expect(createPlan(H, WEEK, undefined, db)).rejects.toBeInstanceOf(PlanExistsError);
  });

  it.each(["2026-36", "2026-W54", "next-week"])("rejects %s as a plan id", async (id) => {
    await expect(createPlan(H, id, undefined, db)).rejects.toBeInstanceOf(InvalidPlanIdError);
  });
});

describe("setPlanDay", () => {
  beforeEach(async () => {
    await createPlan(H, WEEK, undefined, db);
  });

  it("stores the main, side and extras as rows", async () => {
    await setPlanDay(
      H,
      WEEK,
      MONDAY,
      "dinner",
      { servings: 8, main: "fajitas", side: "pico", extras: ["cornbread", "brownies"] },
      db,
    );

    const day = await getPlanDay(H, WEEK, MONDAY, "dinner", db);

    expect(day.main).toBe("fajitas");
    expect(day.side).toBe("pico");
    expect(day.extras).toEqual(["cornbread", "brownies"]);
  });

  it("keeps the order of extras, so a dessert does not become a side", async () => {
    await setPlanDay(
      H,
      WEEK,
      MONDAY,
      "dinner",
      { servings: 8, main: "fajitas", extras: ["brownies", "cornbread"] },
      db,
    );

    expect((await getPlanDay(H, WEEK, MONDAY, "dinner", db)).extras).toEqual([
      "brownies",
      "cornbread",
    ]);
  });

  it("replaces the whole day when written again", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas", side: "pico" }, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 4, main: "cornbread" }, db);

    const day = await getPlanDay(H, WEEK, MONDAY, "dinner", db);

    expect(day.main).toBe("cornbread");
    expect(day.side).toBeNull();
    expect(day.servings).toBe(4);
  });

  it("keeps per-day servings, so a potluck day differs from the rest of the week", async () => {
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await setPlanDay(
      H,
      WEEK,
      "2026-09-03",
      "dinner",
      { servings: 27, status: "potluck", main: "cornbread" },
      db,
    );

    const { days } = await getPlan(H, WEEK, db);

    expect(days.map((day) => day.servings)).toEqual([8, 27]);
    expect(days.map((day) => day.status)).toEqual(["planned", "potluck"]);
  });

  it("refuses a date outside the plan's own week", async () => {
    // The Monday of W37 — a caller mistake that would otherwise store a day the grid never shows.
    await expect(
      setPlanDay(H, WEEK, "2026-09-07", "dinner", { servings: 8, main: "fajitas" }, db),
    ).rejects.toBeInstanceOf(DateOutsidePlanError);
  });

  it("refuses the same recipe in two roles, rather than failing on a key clash", async () => {
    await expect(
      setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas", side: "fajitas" }, db),
    ).rejects.toBeInstanceOf(DuplicateRecipeError);
  });

  it("refuses a recipe repeated in extras", async () => {
    await expect(
      setPlanDay(
        H,
        WEEK,
        MONDAY,
        "dinner",
        { servings: 8, main: "fajitas", extras: ["pico", "pico"] },
        db,
      ),
    ).rejects.toBeInstanceOf(DuplicateRecipeError);
  });

  it.each(["2026-13-45", "2026-02-30"])(
    "refuses %s, which is not a calendar date",
    async (date) => {
      await expect(
        setPlanDay(H, WEEK, date, "dinner", { servings: 8, main: "fajitas" }, db),
      ).rejects.toBeInstanceOf(InvalidDateError);
    },
  );

  it("refuses to write a day into a plan that does not exist", async () => {
    await expect(
      setPlanDay(H, "2026-W37", "2026-09-07", "dinner", { servings: 8 }, db),
    ).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("writes nothing when a recipe on the day does not exist", async () => {
    await expect(
      setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "not-a-recipe" }, db),
    ).rejects.toThrow();

    await expect(getPlanDay(H, WEEK, MONDAY, "dinner", db)).rejects.toBeInstanceOf(
      PlanDayNotFoundError,
    );
  });
});

describe("getPlan", () => {
  it("returns only the days that were planned, with no phantom blanks", async () => {
    await createPlan(H, WEEK, undefined, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    const { days } = await getPlan(H, WEEK, db);

    expect(days).toHaveLength(1);
    expect(days[0].date).toBe(MONDAY);
  });

  it("reports a missing plan rather than an empty week", async () => {
    await expect(getPlan(H, WEEK, db)).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

describe("deletePlanDay", () => {
  beforeEach(async () => {
    await createPlan(H, WEEK, undefined, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas", side: "pico" }, db);
  });

  it("removes the row rather than blanking it", async () => {
    await deletePlanDay(H, WEEK, MONDAY, "dinner", {}, db);

    const { days } = await getPlan(H, WEEK, db);

    expect(days).toEqual([]);
  });

  it("takes the day's recipes with it", async () => {
    await deletePlanDay(H, WEEK, MONDAY, "dinner", {}, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8 }, db);

    const day = await getPlanDay(H, WEEK, MONDAY, "dinner", db);

    expect(day.main).toBeNull();
    expect(day.side).toBeNull();
  });

  it("reports a day that was not planned", async () => {
    await expect(deletePlanDay(H, WEEK, "2026-09-01", "dinner", {}, db)).rejects.toBeInstanceOf(
      PlanDayNotFoundError,
    );
  });
});

describe("deletePlan", () => {
  it("takes its days and their recipes with it", async () => {
    await createPlan(H, WEEK, undefined, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    await deletePlan(H, WEEK, db);

    await expect(getPlan(H, WEEK, db)).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

describe("a recipe a plan still uses", () => {
  it("cannot be deleted, so a planned week is never silently emptied", async () => {
    await createPlan(H, WEEK, undefined, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);

    await expect(deleteRecipe(H, "fajitas", db)).rejects.toThrow();

    expect((await getPlanDay(H, WEEK, MONDAY, "dinner", db)).main).toBe("fajitas");
  });

  it("can be deleted once the day no longer references it", async () => {
    await createPlan(H, WEEK, undefined, db);
    await setPlanDay(H, WEEK, MONDAY, "dinner", { servings: 8, main: "fajitas" }, db);
    await deletePlanDay(H, WEEK, MONDAY, "dinner", {}, db);

    await expect(deleteRecipe(H, "fajitas", db)).resolves.toBeUndefined();
  });
});

describe("updatePlan", () => {
  it("changes the budget target", async () => {
    await createPlan(H, WEEK, undefined, db);

    expect((await updatePlan(H, WEEK, 150, db)).budgetTarget).toBe("150.00");
  });

  it("reports a missing plan rather than creating one", async () => {
    await expect(updatePlan(H, WEEK, 150, db)).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

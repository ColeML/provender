import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { schema } from "@server/db";

/**
 * The claim the whole household scope exists to make: one household cannot observe or affect
 * another's rows through any service function.
 *
 * Written from the outside rather than by inspecting queries, because the failure mode is a
 * *forgotten* filter — a query missing `where household_id = ?` looks entirely normal, and only a
 * test that asks the other household what it can see will catch it.
 */
let db: Database;
let close: () => Promise<void>;

const A = "loewer";
const B = "other";

const recipe = { title: "Fajitas", baseServings: 8 };
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

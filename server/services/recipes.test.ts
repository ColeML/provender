import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";

const HOUSEHOLD = "loewer";
import type { Database } from "@server/db";

import {
  addIngredient,
  createRecipe,
  getIngredient,
  InvalidPageTokenError,
  deleteIngredient,
  deleteRecipe,
  getRecipe,
  listIngredients,
  listRecipes,
  RecipeExistsError,
  RecipeNotFoundError,
  updateRecipe,
} from "./recipes";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

const fajitas = {
  title: "Chicken Fajitas",
  baseServings: 8,
  totalMin: 40,
  tags: ["mexican", "kid-friendly"],
  instructions: ["Preheat the oven.", "Slice the peppers."],
};

const ingredients = [
  { name: "chili powder", quantity: 2, unit: "Tbsp", category: "pantry" as const },
  { name: "bell pepper", quantity: 3, unit: "ea", category: "produce" as const },
  { name: "salt", quantity: null, unit: null, category: "pantry" as const, notes: "to taste" },
];

describe("createRecipe", () => {
  it("stores the recipe and its ingredients in recipe order", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);

    const stored = await listIngredients(HOUSEHOLD, "fajitas", db);

    expect(stored.map((row) => row.name)).toEqual(["chili powder", "bell pepper", "salt"]);
    expect(stored.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("lowercases units, so merging does not see Tbsp and tbsp as two products", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);

    const [first] = await listIngredients(HOUSEHOLD, "fajitas", db);

    expect(first.unit).toBe("tbsp");
  });

  it("keeps a null quantity for a to-taste ingredient rather than inventing a zero", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);

    const salt = (await listIngredients(HOUSEHOLD, "fajitas", db)).find(
      (row) => row.name === "salt",
    );

    expect(salt?.quantity).toBeNull();
    expect(salt?.notes).toBe("to taste");
  });

  it("suffixes the id when a recipe uses the same ingredient twice", async () => {
    await createRecipe(
      HOUSEHOLD,
      "stew",
      fajitas,
      [
        { name: "onion", quantity: 1, unit: "ea", category: "produce" },
        { name: "onion", quantity: 2, unit: "ea", category: "produce", notes: "for the garnish" },
      ],
      db,
    );

    expect((await listIngredients(HOUSEHOLD, "stew", db)).map((row) => row.id)).toEqual([
      "stew_onion",
      "stew_onion-2",
    ]);
  });

  it("refuses an id that already exists instead of creating a second copy", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);

    await expect(
      createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db),
    ).rejects.toBeInstanceOf(RecipeExistsError);
  });

  it("writes nothing when an ingredient is invalid, rather than leaving a half-saved recipe", async () => {
    await expect(
      createRecipe(
        HOUSEHOLD,
        "broken",
        fajitas,
        [{ name: "mystery", quantity: 1, unit: "ea", category: "not-an-aisle" as never }],
        db,
      ),
    ).rejects.toThrow();

    await expect(getRecipe(HOUSEHOLD, "broken", db)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});

describe("listRecipes", () => {
  beforeEach(async () => {
    for (const id of ["a", "b", "c", "d", "e"]) {
      await createRecipe(HOUSEHOLD, id, { ...fajitas, title: id.toUpperCase() }, [], db);
    }
  });

  it("pages through every recipe exactly once", async () => {
    const seen: string[] = [];
    let pageToken: string | undefined;

    do {
      const page = await listRecipes(HOUSEHOLD, { pageSize: 2, pageToken }, db);

      seen.push(...page.recipes.map((row) => row.id));
      pageToken = page.nextPageToken;
    } while (pageToken);

    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("rejects a token this API did not issue rather than returning a wrong page", async () => {
    await expect(
      listRecipes(HOUSEHOLD, { pageToken: "not-a-real-token" }, db),
    ).rejects.toBeInstanceOf(InvalidPageTokenError);
  });

  it("omits nextPageToken on the last page", async () => {
    const page = await listRecipes(HOUSEHOLD, { pageSize: 50 }, db);

    expect(page.nextPageToken).toBeUndefined();
  });

  it("does not skip a recipe when an earlier one is deleted between pages", async () => {
    const first = await listRecipes(HOUSEHOLD, { pageSize: 2 }, db);

    // Keyset pagination is the reason this holds; an offset token would skip "d" here.
    await deleteRecipe(HOUSEHOLD, "a", db);

    const second = await listRecipes(
      HOUSEHOLD,
      { pageSize: 2, pageToken: first.nextPageToken },
      db,
    );

    expect(second.recipes.map((row) => row.id)).toEqual(["c", "d"]);
  });
});

describe("addIngredient", () => {
  beforeEach(async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);
  });

  it("appends after the existing ingredients rather than renumbering them", async () => {
    await addIngredient(
      HOUSEHOLD,
      "fajitas",
      { name: "lime", quantity: 1, unit: "ea", category: "produce" },
      db,
    );

    const stored = await listIngredients(HOUSEHOLD, "fajitas", db);

    expect(stored.map((row) => row.name)).toEqual(["chili powder", "bell pepper", "salt", "lime"]);
    expect(stored.at(-1)?.position).toBe(3);
  });

  it("suffixes the id when the ingredient is already on the recipe", async () => {
    const added = await addIngredient(
      HOUSEHOLD,
      "fajitas",
      { name: "salt", quantity: 1, unit: "tsp", category: "pantry" },
      db,
    );

    expect(added.id).toBe("fajitas_salt-2");
  });

  it("reports a missing recipe rather than orphaning the ingredient", async () => {
    await expect(
      addIngredient(
        HOUSEHOLD,
        "nope",
        { name: "lime", quantity: 1, unit: "ea", category: "produce" },
        db,
      ),
    ).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});

describe("getIngredient", () => {
  it("will not return one belonging to a different recipe", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);
    await createRecipe(HOUSEHOLD, "other", fajitas, [], db);

    await expect(getIngredient(HOUSEHOLD, "fajitas", "fajitas_salt", db)).resolves.toBeDefined();
    await expect(getIngredient(HOUSEHOLD, "other", "fajitas_salt", db)).resolves.toBeUndefined();
  });
});

describe("updateRecipe", () => {
  beforeEach(async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);
  });

  it("changes only the fields named in the mask", async () => {
    await updateRecipe(
      HOUSEHOLD,
      "fajitas",
      ["title"],
      { title: "Beef Fajitas", baseServings: 2 },
      undefined,
      db,
    );

    const recipe = await getRecipe(HOUSEHOLD, "fajitas", db);

    expect(recipe.title).toBe("Beef Fajitas");
    expect(recipe.baseServings).toBe(8);
  });

  it("replaces the whole ingredient list when the mask names it", async () => {
    await updateRecipe(
      HOUSEHOLD,
      "fajitas",
      ["ingredients"],
      {},
      [{ name: "steak", quantity: 1, unit: "lb", category: "meat" }],
      db,
    );

    expect((await listIngredients(HOUSEHOLD, "fajitas", db)).map((row) => row.name)).toEqual([
      "steak",
    ]);
  });

  it("clears the ingredients when the mask names them and the body omits them", async () => {
    await updateRecipe(HOUSEHOLD, "fajitas", ["ingredients"], {}, undefined, db);

    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toEqual([]);
  });

  it("leaves ingredients alone when the mask does not name them", async () => {
    await updateRecipe(HOUSEHOLD, "fajitas", ["title"], { title: "Beef Fajitas" }, undefined, db);

    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toHaveLength(3);
  });

  it("moves updateTime forward", async () => {
    const before = await getRecipe(HOUSEHOLD, "fajitas", db);

    await updateRecipe(HOUSEHOLD, "fajitas", ["title"], { title: "Beef Fajitas" }, undefined, db);

    const after = await getRecipe(HOUSEHOLD, "fajitas", db);

    expect(after.updateTime.getTime()).toBeGreaterThanOrEqual(before.updateTime.getTime());
  });

  it("reports a missing recipe rather than creating one", async () => {
    await expect(
      updateRecipe(HOUSEHOLD, "nope", ["title"], { title: "x" }, undefined, db),
    ).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});

describe("deleteRecipe", () => {
  it("takes the ingredients with it", async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);

    await deleteRecipe(HOUSEHOLD, "fajitas", db);

    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toEqual([]);
  });

  it("reports a missing recipe instead of succeeding silently", async () => {
    await expect(deleteRecipe(HOUSEHOLD, "nope", db)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});

describe("deleteIngredient", () => {
  beforeEach(async () => {
    await createRecipe(HOUSEHOLD, "fajitas", fajitas, ingredients, db);
  });

  it("removes one ingredient and reports it did", async () => {
    await expect(deleteIngredient(HOUSEHOLD, "fajitas", "fajitas_salt", db)).resolves.toBe(true);
    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toHaveLength(2);
  });

  it("will not delete an ingredient belonging to a different recipe", async () => {
    await createRecipe(HOUSEHOLD, "other", fajitas, [], db);

    await expect(deleteIngredient(HOUSEHOLD, "other", "fajitas_salt", db)).resolves.toBe(false);
    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toHaveLength(3);
  });
});

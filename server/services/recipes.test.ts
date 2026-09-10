import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { schema } from "@server/db";
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
  scaleRecipe,
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

  it("will not delete another household's ingredient", async () => {
    // Recipe slugs are unique per household, so two households both having `fajitas` gives their
    // ingredients identical ids. Without the household in the filter, either can delete the other's.
    await db.insert(schema.households).values({ id: "someone-else", name: "Someone Else" });
    await createRecipe("someone-else", "fajitas", fajitas, ingredients, db);

    await expect(deleteIngredient("someone-else", "fajitas", "fajitas_salt", db)).resolves.toBe(
      true,
    );
    expect(await listIngredients(HOUSEHOLD, "fajitas", db)).toHaveLength(3);
  });
});

describe("scaleRecipe", () => {
  beforeEach(async () => {
    await createRecipe(
      HOUSEHOLD,
      "stirfry",
      { title: "Stir fry", baseServings: 6 },
      [
        { name: "soy sauce", quantity: 1 / 3, unit: "cup", category: "pantry" },
        { name: "chicken breast", quantity: 1.5, unit: "lb", category: "meat" },
        { name: "garlic", quantity: 3, unit: "clove", category: "produce" },
        { name: "salt", quantity: null, unit: null, category: "pantry", notes: "to taste" },
      ],
      db,
    );
  });

  it("snaps a volume to something measurable, changing the unit if needed", async () => {
    // 1/3 cup at 6 servings becomes 4/9 cup at 8 — which is 7 1/8 tbsp.
    const scaled = await scaleRecipe(HOUSEHOLD, "stirfry", 8, db);
    const soy = scaled.ingredients.find((row) => row.name === "soy sauce");

    expect(soy).toMatchObject({ quantity: 7.125, unit: "tbsp" });
  });

  it("scales a mass linearly and leaves its unit alone", async () => {
    const scaled = await scaleRecipe(HOUSEHOLD, "stirfry", 8, db);
    const chicken = scaled.ingredients.find((row) => row.name === "chicken breast");

    expect(chicken).toMatchObject({ quantity: 2, unit: "lb" });
  });

  it("scales a count without pretending it is a fraction", async () => {
    const scaled = await scaleRecipe(HOUSEHOLD, "stirfry", 8, db);
    const garlic = scaled.ingredients.find((row) => row.name === "garlic");

    // 4 cloves exactly; rounding to whole is the caller's judgment, not this function's.
    expect(garlic).toMatchObject({ quantity: 4, unit: "clove" });
  });

  it("leaves a to-taste ingredient untouched", async () => {
    const scaled = await scaleRecipe(HOUSEHOLD, "stirfry", 8, db);
    const salt = scaled.ingredients.find((row) => row.name === "salt");

    expect(salt).toMatchObject({ quantity: null, notes: "to taste" });
  });

  it("writes nothing — the stored recipe is unchanged", async () => {
    await scaleRecipe(HOUSEHOLD, "stirfry", 24, db);

    const stored = await listIngredients(HOUSEHOLD, "stirfry", db);
    const soy = stored.find((row) => row.name === "soy sauce");

    expect(Number(soy?.quantity)).toBeCloseTo(1 / 3, 4);
    expect((await getRecipe(HOUSEHOLD, "stirfry", db)).baseServings).toBe(6);
  });

  it("reports the factor it used", async () => {
    await expect(scaleRecipe(HOUSEHOLD, "stirfry", 3, db)).resolves.toMatchObject({
      baseServings: 6,
      targetServings: 3,
      factor: 0.5,
    });
  });

  it("reports a recipe that does not exist", async () => {
    await expect(scaleRecipe(HOUSEHOLD, "nope", 4, db)).rejects.toBeInstanceOf(RecipeNotFoundError);
  });
});

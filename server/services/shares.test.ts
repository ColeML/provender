import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { createRecipe, deleteRecipe, RecipeNotFoundError } from "@server/services/recipes";

import { createShare, deleteShare, getShare, getSharedRecipe, ShareExistsError } from "./shares";

const HOUSEHOLD = "loewer";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await createRecipe(
    HOUSEHOLD,
    "fajitas",
    {
      title: "Chicken Fajitas",
      baseServings: 8,
      totalMin: 40,
      costEstimate: 14.5,
      instructions: ["Preheat the oven.", "Slice the peppers."],
    },
    [
      { name: "chili powder", quantity: 2, unit: "Tbsp", category: "pantry" as const },
      { name: "bell pepper", quantity: 3, unit: "ea", category: "produce" as const },
    ],
    db,
  );
});

afterEach(async () => {
  await close();
});

describe("createShare", () => {
  it("mints a token long enough not to be guessed", async () => {
    const share = await createShare(HOUSEHOLD, "fajitas", db);

    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a second share for a recipe that already has one", async () => {
    await createShare(HOUSEHOLD, "fajitas", db);

    await expect(createShare(HOUSEHOLD, "fajitas", db)).rejects.toThrow(ShareExistsError);
  });

  it("refuses to share a recipe that does not exist", async () => {
    await expect(createShare(HOUSEHOLD, "nonesuch", db)).rejects.toThrow(RecipeNotFoundError);
  });

  it("gives two recipes different tokens", async () => {
    await createRecipe(HOUSEHOLD, "ziti", { title: "Baked Ziti", baseServings: 6 }, [], db);

    const fajitas = await createShare(HOUSEHOLD, "fajitas", db);
    const ziti = await createShare(HOUSEHOLD, "ziti", db);

    expect(fajitas.token).not.toEqual(ziti.token);
  });
});

describe("getShare", () => {
  it("returns the live token for a recipe", async () => {
    const minted = await createShare(HOUSEHOLD, "fajitas", db);

    expect((await getShare(HOUSEHOLD, "fajitas", db))?.token).toEqual(minted.token);
  });

  it("returns null for a recipe that was never shared", async () => {
    expect(await getShare(HOUSEHOLD, "fajitas", db)).toBeNull();
  });
});

describe("deleteShare", () => {
  it("revokes the token", async () => {
    const { token } = await createShare(HOUSEHOLD, "fajitas", db);

    expect(await deleteShare(HOUSEHOLD, "fajitas", token, db)).toBe(true);
    expect(await getSharedRecipe(token, db)).toBeNull();
  });

  it("reports an unknown token rather than claiming a revoke", async () => {
    expect(await deleteShare(HOUSEHOLD, "fajitas", "not-a-token", db)).toBe(false);
  });

  it("frees the recipe to be shared again", async () => {
    const { token } = await createShare(HOUSEHOLD, "fajitas", db);
    await deleteShare(HOUSEHOLD, "fajitas", token, db);

    await expect(createShare(HOUSEHOLD, "fajitas", db)).resolves.toBeDefined();
  });
});

describe("getSharedRecipe", () => {
  it("resolves a token to the recipe and its ingredients, in recipe order", async () => {
    const { token } = await createShare(HOUSEHOLD, "fajitas", db);

    const shared = await getSharedRecipe(token, db);

    expect(shared?.recipe.title).toEqual("Chicken Fajitas");
    expect(shared?.ingredients.map((row) => row.name)).toEqual(["chili powder", "bell pepper"]);
  });

  it("returns null for a token nobody minted", async () => {
    expect(await getSharedRecipe("not-a-token", db)).toBeNull();
  });

  it("stops resolving once the recipe is deleted", async () => {
    const { token } = await createShare(HOUSEHOLD, "fajitas", db);

    await deleteRecipe(HOUSEHOLD, "fajitas", db);

    expect(await getSharedRecipe(token, db)).toBeNull();
  });
});

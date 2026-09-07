import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

let testDb: Database;

// A getter, not a value: the module is imported once but each service call reads `db` again, so
// every test gets the database created in its own beforeEach.
vi.mock("@server/db", async () => {
  const actual = await vi.importActual<typeof import("@server/db")>("@server/db");

  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

const { api } = await import("@server/api/app");

const authed = { Authorization: "Bearer test-token" };

const fajitas = {
  title: "Chicken Fajitas",
  baseServings: 8,
  totalMin: 40,
  tags: ["mexican"],
  instructions: ["Preheat.", "Slice."],
  ingredients: [
    { ingredientName: "chili powder", quantity: 2, unit: "Tbsp", category: "pantry" },
    { ingredientName: "salt", quantity: null, unit: null, category: "pantry", notes: "to taste" },
  ],
};

function post(path: string, body: unknown) {
  return api.request(path, {
    method: "POST",
    headers: { ...authed, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("POST /v1/recipes", () => {
  it("creates the recipe and returns an AIP resource name", async () => {
    const response = await post("/v1/recipes?recipeId=fajitas", fajitas);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "recipes/fajitas",
      recipeId: "fajitas",
      title: "Chicken Fajitas",
      tags: ["mexican"],
    });
  });

  it("returns ALREADY_EXISTS rather than a duplicate row", async () => {
    await post("/v1/recipes?recipeId=fajitas", fajitas);

    const response = await post("/v1/recipes?recipeId=fajitas", fajitas);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 409, status: "ALREADY_EXISTS" },
    });
  });

  it("rejects an id that is not a slug", async () => {
    const response = await post("/v1/recipes?recipeId=Not A Slug", fajitas);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });

  it("reports the offending field when the body is invalid", async () => {
    const response = await post("/v1/recipes?recipeId=fajitas", { ...fajitas, baseServings: 0 });

    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      error: { details: [{ fieldViolations: [{ field: string }] }] };
    };

    expect(body.error.details[0].fieldViolations[0].field).toBe("baseServings");
  });
});

describe("GET /v1/recipes", () => {
  it("returns a page and a token, then the rest", async () => {
    for (const id of ["a", "b", "c"]) {
      await post(`/v1/recipes?recipeId=${id}`, { ...fajitas, ingredients: [] });
    }

    const first = (await (
      await api.request("/v1/recipes?pageSize=2", { headers: authed })
    ).json()) as {
      recipes: { recipeId: string }[];
      nextPageToken?: string;
    };

    expect(first.recipes.map((r) => r.recipeId)).toEqual(["a", "b"]);
    expect(first.nextPageToken).toBeTruthy();

    const second = (await (
      await api.request(`/v1/recipes?pageToken=${first.nextPageToken}`, { headers: authed })
    ).json()) as { recipes: { recipeId: string }[]; nextPageToken?: string };

    expect(second.recipes.map((r) => r.recipeId)).toEqual(["c"]);
    expect(second.nextPageToken).toBeUndefined();
  });
});

describe("GET /v1/recipes/{recipe}", () => {
  it("returns NOT_FOUND for an unknown recipe", async () => {
    const response = await api.request("/v1/recipes/nope", { headers: authed });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { status: "NOT_FOUND" } });
  });
});

describe("GET /v1/recipes/{recipe}/ingredients", () => {
  it("returns them in recipe order with resource names", async () => {
    await post("/v1/recipes?recipeId=fajitas", fajitas);

    const body = (await (
      await api.request("/v1/recipes/fajitas/ingredients", { headers: authed })
    ).json()) as { ingredients: { name: string; ingredientName: string; unit: string | null }[] };

    expect(body.ingredients.map((i) => i.ingredientName)).toEqual(["chili powder", "salt"]);
    expect(body.ingredients[0].name).toBe("recipes/fajitas/ingredients/fajitas_chili-powder");
    expect(body.ingredients[0].unit).toBe("tbsp");
  });

  it("distinguishes an unknown recipe from one with no ingredients", async () => {
    await post("/v1/recipes?recipeId=empty", { ...fajitas, ingredients: [] });

    const missing = await api.request("/v1/recipes/nope/ingredients", { headers: authed });
    const empty = await api.request("/v1/recipes/empty/ingredients", { headers: authed });

    expect(missing.status).toBe(404);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ ingredients: [] });
  });
});

describe("PATCH /v1/recipes/{recipe}", () => {
  beforeEach(async () => {
    await post("/v1/recipes?recipeId=fajitas", fajitas);
  });

  function patch(query: string, body: unknown) {
    return api.request(`/v1/recipes/fajitas?${query}`, {
      method: "PATCH",
      headers: { ...authed, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("applies only the masked field", async () => {
    const response = await patch("updateMask=title", { title: "Beef Fajitas", baseServings: 2 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      title: "Beef Fajitas",
      baseServings: 8,
    });
  });

  it("rejects a mask naming an unknown field instead of silently doing nothing", async () => {
    const response = await patch("updateMask=titel", { title: "typo" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT", message: expect.stringContaining("titel") },
    });
  });

  it("requires a mask", async () => {
    const response = await patch("", { title: "x" });

    expect(response.status).toBe(400);
  });
});

describe("DELETE /v1/recipes/{recipe}", () => {
  it("removes the recipe and its ingredients", async () => {
    await post("/v1/recipes?recipeId=fajitas", fajitas);

    expect(
      (await api.request("/v1/recipes/fajitas", { method: "DELETE", headers: authed })).status,
    ).toBe(200);
    expect((await api.request("/v1/recipes/fajitas", { headers: authed })).status).toBe(404);
    expect((await api.request("/v1/recipes/fajitas/ingredients", { headers: authed })).status).toBe(
      404,
    );
  });

  it("returns NOT_FOUND for a recipe that is not there", async () => {
    const response = await api.request("/v1/recipes/nope", { method: "DELETE", headers: authed });

    expect(response.status).toBe(404);
  });
});

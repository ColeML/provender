import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

let testDb: Database;

// A getter, not a value — see the note in `recipes.test.ts`.
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

function request(method: string, path: string, body?: unknown) {
  return api.request(path, {
    method,
    headers: { ...authed, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function shareFajitas() {
  const response = await request("POST", "/v1/recipes/fajitas/shares");

  return (await response.json()) as { token: string; name: string };
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());

  await request("POST", "/v1/recipes?recipeId=fajitas", {
    title: "Chicken Fajitas",
    baseServings: 8,
    ingredients: [{ ingredientName: "salt", quantity: 1, unit: "tsp", category: "pantry" }],
  });
});

describe("POST /v1/recipes/{recipe}/shares", () => {
  it("mints a share and returns an AIP resource name", async () => {
    const response = await request("POST", "/v1/recipes/fajitas/shares");

    expect(response.status).toBe(200);

    const share = await response.json();

    expect(share).toMatchObject({ recipeId: "fajitas" });
    expect(share.name).toEqual(`recipes/fajitas/shares/${share.token}`);
  });

  it("returns ALREADY_EXISTS rather than a second token", async () => {
    await shareFajitas();

    const response = await request("POST", "/v1/recipes/fajitas/shares");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 409, status: "ALREADY_EXISTS" },
    });
  });

  // Asserting the message, not just the status: before the route was mounted this path answered
  // 404 from the API's catch-all, which would let the test pass with no handler behind it.
  it("returns NOT_FOUND for a recipe that does not exist", async () => {
    const response = await request("POST", "/v1/recipes/nonesuch/shares");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 404, status: "NOT_FOUND", message: "No recipe named nonesuch" },
    });
  });
});

describe("GET /v1/recipes/{recipe}/shares", () => {
  it("lists the live share", async () => {
    const { token } = await shareFajitas();

    const response = await request("GET", "/v1/recipes/fajitas/shares");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ shares: [{ token }] });
  });

  it("returns an empty list for a recipe that is not shared", async () => {
    const response = await request("GET", "/v1/recipes/fajitas/shares");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ shares: [] });
  });

  // An unknown recipe answering `{shares: []}` would read as "not shared" rather than "no such
  // recipe", which is the same trap the ingredients list endpoint avoids.
  it("returns NOT_FOUND for a recipe that does not exist", async () => {
    const response = await request("GET", "/v1/recipes/nonesuch/shares");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "No recipe named nonesuch" },
    });
  });
});

describe("DELETE /v1/recipes/{recipe}/shares/{share}", () => {
  it("revokes the share", async () => {
    const { token } = await shareFajitas();

    const response = await request("DELETE", `/v1/recipes/fajitas/shares/${token}`);

    expect(response.status).toBe(200);

    const after = await request("GET", "/v1/recipes/fajitas/shares");

    await expect(after.json()).resolves.toEqual({ shares: [] });
  });

  it("returns NOT_FOUND for a token that was never minted", async () => {
    const response = await request("DELETE", "/v1/recipes/fajitas/shares/not-a-token");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 404, status: "NOT_FOUND", message: "No share not-a-token on fajitas" },
    });
  });
});

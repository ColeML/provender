import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

let testDb: Database;

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

function get(path: string, headers: Record<string, string> = authed) {
  return api.request(path, { method: "GET", headers });
}

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

describe("GET /v1/planning/rotation", () => {
  it("returns every recipe with a tier", async () => {
    await post("/v1/recipes?recipeId=ziti", {
      title: "Baked Ziti",
      baseServings: 8,
      totalMin: 65,
      tags: ["italian"],
      ingredients: [],
    });

    const response = await get("/v1/planning/rotation");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipes: [
        {
          name: "recipes/ziti",
          recipeId: "ziti",
          title: "Baked Ziti",
          tier: "unplanned",
          lastPlanned: null,
          timesPlanned: 0,
          daysUntilEligible: null,
        },
      ],
    });
  });

  it("refuses an unauthenticated request", async () => {
    const response = await get("/v1/planning/rotation", {});

    expect(response.status).toBe(401);
  });
});

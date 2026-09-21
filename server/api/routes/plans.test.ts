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
const { setConfigValue } = await import("@server/services/config");
const { createRecipe } = await import("@server/services/recipes");

const authed = { Authorization: "Bearer test-token" };
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";

function send(method: string, path: string, body?: unknown) {
  return api.request(path, {
    method,
    headers: { ...authed, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
  await setConfigValue("loewer", "default_budget", "120", testDb);

  for (const id of ["fajitas", "pico"]) {
    await createRecipe("loewer", id, { title: id, baseServings: 8 }, [], testDb);
  }
});

describe("POST /v1/plans", () => {
  it("creates the week with the configured budget", async () => {
    const response = await send("POST", `/v1/plans?planId=${WEEK}`, {});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: `plans/${WEEK}`,
      planId: WEEK,
      budgetTarget: 120,
      days: [],
    });
  });

  it("returns ALREADY_EXISTS for a week that is planned", async () => {
    await send("POST", `/v1/plans?planId=${WEEK}`, {});

    expect((await send("POST", `/v1/plans?planId=${WEEK}`, {})).status).toBe(409);
  });

  it("rejects an id that is not an ISO week", async () => {
    const response = await send("POST", "/v1/plans?planId=next-week", {});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });
});

describe("PUT /v1/plans/{plan}/days/{day}", () => {
  beforeEach(async () => {
    await send("POST", `/v1/plans?planId=${WEEK}`, {});
  });

  it("writes a day with its main, side and extras", async () => {
    const response = await send("PUT", `/v1/plans/${WEEK}/days/${MONDAY}`, {
      servings: 8,
      main: "fajitas",
      side: "pico",
      notes: "hot day, no oven",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: `plans/${WEEK}/days/${MONDAY}`,
      main: "fajitas",
      side: "pico",
      servings: 8,
      notes: "hot day, no oven",
    });
  });

  it("refuses a date outside the plan's week", async () => {
    const response = await send("PUT", `/v1/plans/${WEEK}/days/2026-09-07`, {
      servings: 8,
      main: "fajitas",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT", message: expect.stringContaining("2026-W37") },
    });
  });

  it("rejects a day that is not a date", async () => {
    expect((await send("PUT", `/v1/plans/${WEEK}/days/monday`, { servings: 8 })).status).toBe(400);
  });
});

describe("GET /v1/plans/{plan}", () => {
  it("returns only planned days, with no phantom blanks", async () => {
    await send("POST", `/v1/plans?planId=${WEEK}`, {});
    await send("PUT", `/v1/plans/${WEEK}/days/${MONDAY}`, { servings: 8, main: "fajitas" });

    const body = (await (await api.request(`/v1/plans/${WEEK}`, { headers: authed })).json()) as {
      days: { date: string }[];
    };

    expect(body.days).toHaveLength(1);
    expect(body.days[0].date).toBe(MONDAY);
  });

  it("returns NOT_FOUND for an unplanned week", async () => {
    expect((await api.request(`/v1/plans/${WEEK}`, { headers: authed })).status).toBe(404);
  });
});

describe("DELETE /v1/plans/{plan}/days/{day}", () => {
  it("clears the day, replacing plan-clear", async () => {
    await send("POST", `/v1/plans?planId=${WEEK}`, {});
    await send("PUT", `/v1/plans/${WEEK}/days/${MONDAY}`, { servings: 8, main: "fajitas" });

    expect((await send("DELETE", `/v1/plans/${WEEK}/days/${MONDAY}`)).status).toBe(200);
    expect((await send("GET", `/v1/plans/${WEEK}/days/${MONDAY}`)).status).toBe(404);
  });
});

describe("POST /v1/plans/{plan}:commit", () => {
  const body = {
    budgetTarget: 95,
    recipes: [
      {
        recipeId: "gnocchi",
        title: "Sheet-Pan Gnocchi",
        baseServings: 8,
        ingredients: [{ ingredientName: "gnocchi", quantity: 32, unit: "oz", category: "pantry" }],
      },
    ],
    days: [{ date: MONDAY, servings: 8, main: "gnocchi", notes: "58F and wet" }],
  };

  it("writes the week and reports what it wrote", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: {
        name: `plans/${WEEK}`,
        planId: WEEK,
        budgetTarget: 95,
        days: [{ date: MONDAY, main: "gnocchi", servings: 8 }],
      },
      createdRecipeIds: ["gnocchi"],
      historyEntryIds: [`${MONDAY}-gnocchi`],
    });
  });

  it("maps a taken recipe id to ALREADY_EXISTS", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      ...body,
      recipes: [{ recipeId: "fajitas", title: "Fajitas", baseServings: 8 }],
      days: [{ date: MONDAY, servings: 8, main: "fajitas" }],
    });

    expect(response.status).toBe(409);
  });

  it("maps a day already planned to ALREADY_EXISTS", async () => {
    await send("POST", `/v1/plans/${WEEK}:commit`, body);

    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: MONDAY, servings: 4, main: "pico" }],
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "ALREADY_EXISTS", message: expect.stringContaining(MONDAY) },
    });
  });

  it("overwrites that day when the caller opts in", async () => {
    await send("POST", `/v1/plans/${WEEK}:commit`, body);

    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      replaceExistingDays: true,
      recipes: [],
      days: [{ date: MONDAY, servings: 4, main: "pico" }],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: { days: [{ date: MONDAY, main: "pico", servings: 4 }] },
    });
  });

  it("maps an unknown recipe on a day to INVALID_ARGUMENT", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: MONDAY, servings: 8, main: "ghost" }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT", message: expect.stringContaining("ghost") },
    });
  });

  it("maps a date outside the week to INVALID_ARGUMENT", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: "2026-09-08", servings: 8, main: "fajitas" }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects an empty days array before reaching the service", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, { recipes: [], days: [] });

    expect(response.status).toBe(400);
  });
});

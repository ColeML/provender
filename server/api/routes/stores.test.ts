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

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());

  await request("POST", "/v1/stores?storeId=aldi", { storeName: "Aldi", primary: true });
  await request("POST", "/v1/stores?storeId=braums", {
    storeName: "Braum's",
    notes: "Dairy and buns only",
  });
});

describe("/v1/stores", () => {
  it("lists the stores, primary first, as AIP resources", async () => {
    const response = await request("GET", "/v1/stores");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stores: [
        { name: "stores/aldi", storeName: "Aldi", primary: true, notes: null },
        { name: "stores/braums", storeName: "Braum's", notes: "Dairy and buns only" },
      ],
    });
  });

  it("answers ALREADY_EXISTS for a store id that is taken", async () => {
    const response = await request("POST", "/v1/stores?storeId=aldi", { storeName: "Aldi" });

    expect(response.status).toBe(409);
  });

  it("maps storeName in the update mask onto the store's name", async () => {
    const response = await request("PATCH", "/v1/stores/braums?updateMask=storeName,primary", {
      storeName: "Braum's Market",
      primary: true,
    });

    expect(await response.json()).toMatchObject({ storeName: "Braum's Market", primary: true });
  });

  it("rejects an unknown field in the update mask", async () => {
    const response = await request("PATCH", "/v1/stores/braums?updateMask=address", {});

    expect(response.status).toBe(400);
  });
});

describe("/v1/ingredientStores", () => {
  it("sets a rule and routes the shopping list by it", async () => {
    await request("PUT", "/v1/ingredientStores", {
      ingredientName: "milk",
      store: "braums",
      only: true,
    });
    await request("POST", "/v1/plans?planId=2026-W36", { budgetTarget: 120 });

    const response = await request("PUT", "/v1/plans/2026-W36/shoppingList", {
      items: [
        { itemName: "milk", unit: "gal", category: "dairy", store: "aldi" },
        { itemName: "onions", category: "produce" },
      ],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ itemName: "milk", store: "braums" }),
        expect.objectContaining({ itemName: "onions", store: "aldi" }),
      ]),
    });
  });

  it("answers NOT_FOUND for a rule pointing at a store that does not exist", async () => {
    const response = await request("PUT", "/v1/ingredientStores", {
      ingredientName: "milk",
      store: "costco",
    });

    expect(response.status).toBe(404);
  });

  it("answers INVALID_ARGUMENT for a list item bound for an unknown store", async () => {
    await request("POST", "/v1/plans?planId=2026-W36", { budgetTarget: 120 });

    const response = await request("PUT", "/v1/plans/2026-W36/shoppingList", {
      items: [{ itemName: "onions", category: "produce", store: "costco" }],
    });

    expect(response.status).toBe(400);
  });

  it("deletes a rule by the ingredient's id", async () => {
    await request("PUT", "/v1/ingredientStores", {
      ingredientName: "Hamburger Buns",
      store: "braums",
    });

    const response = await request("DELETE", "/v1/ingredientStores/hamburger-buns");

    expect(response.status).toBe(200);
    expect(await (await request("GET", "/v1/ingredientStores")).json()).toEqual({
      ingredientStores: [],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { createPlan } from "@server/services/plans";
import { addItem, listItems, replaceItems } from "@server/services/shopping";

import {
  createStore,
  deleteIngredientStore,
  deleteStore,
  getStore,
  IngredientStoreNotFoundError,
  listIngredientStores,
  listStores,
  routeToStore,
  setIngredientStore,
  StoreExistsError,
  StoreNotFoundError,
  storeRouting,
  UnknownStoreError,
  updateStore,
} from "./stores";

const H = "loewer";
const WEEK = "2026-W36";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("stores", () => {
  it("lists the primary store first, then the rest by name", async () => {
    await createStore(H, "walmart", { name: "Walmart" }, db);
    await createStore(H, "aldi", { name: "Aldi", primary: true }, db);
    await createStore(H, "braums", { name: "Braum's" }, db);

    const stores = await listStores(H, db);

    expect(stores.map((store) => store.id)).toEqual(["aldi", "braums", "walmart"]);
  });

  it("refuses a second store with the same id", async () => {
    await createStore(H, "aldi", { name: "Aldi" }, db);

    await expect(createStore(H, "aldi", { name: "ALDI" }, db)).rejects.toBeInstanceOf(
      StoreExistsError,
    );
  });

  it("keeps one primary store when another is made primary", async () => {
    await createStore(H, "aldi", { name: "Aldi", primary: true }, db);
    await createStore(H, "walmart", { name: "Walmart", primary: true }, db);

    await expect(getStore(H, "aldi", db)).resolves.toMatchObject({ primary: false });

    await updateStore(H, "aldi", { primary: true }, ["primary"], db);

    const primaries = (await listStores(H, db)).filter((store) => store.primary);

    expect(primaries.map((store) => store.id)).toEqual(["aldi"]);
  });

  it("leaves the primary alone when an unknown store is made primary", async () => {
    await createStore(H, "aldi", { name: "Aldi", primary: true }, db);

    await expect(
      updateStore(H, "costco", { primary: true }, ["primary"], db),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
    await expect(getStore(H, "aldi", db)).resolves.toMatchObject({ primary: true });
  });

  it("touches only the fields named in the mask", async () => {
    await createStore(H, "aldi", { name: "Aldi", notes: "Cheapest produce" }, db);

    const store = await updateStore(H, "aldi", { name: "ALDI", notes: "ignored" }, ["name"], db);

    expect(store).toMatchObject({ name: "ALDI", notes: "Cheapest produce" });
  });

  it("stores blank notes as none", async () => {
    const store = await createStore(H, "aldi", { name: "Aldi", notes: "   " }, db);

    expect(store.notes).toBeNull();
  });

  it("forgets the store's rules and unroutes its list items when it is deleted", async () => {
    await createPlan(H, WEEK, 120, db);
    await createStore(H, "braums", { name: "Braum's" }, db);
    await setIngredientStore(H, { name: "milk", storeId: "braums", only: true }, db);
    await replaceItems(H, WEEK, [{ name: "milk", unit: "gal", category: "dairy" }], db);

    await deleteStore(H, "braums", db);

    await expect(listIngredientStores(H, db)).resolves.toEqual([]);
    const [milk] = await listItems(H, WEEK, db);
    expect(milk?.storeId).toBeNull();
  });

  it("reports deleting a store that does not exist", async () => {
    await expect(deleteStore(H, "costco", db)).rejects.toBeInstanceOf(StoreNotFoundError);
  });
});

describe("ingredient stores", () => {
  beforeEach(async () => {
    await createStore(H, "braums", { name: "Braum's" }, db);
    await createStore(H, "aldi", { name: "Aldi" }, db);
  });

  it("keys a rule on the slug of the ingredient's name", async () => {
    const rule = await setIngredientStore(
      H,
      { name: "Hamburger Buns", storeId: "braums", only: true },
      db,
    );

    expect(rule).toMatchObject({ id: "hamburger-buns", name: "Hamburger Buns", only: true });
  });

  it("moves an ingredient when its store is set again", async () => {
    await setIngredientStore(H, { name: "milk", storeId: "braums", only: true }, db);
    await setIngredientStore(H, { name: "Milk", storeId: "aldi" }, db);

    const rules = await listIngredientStores(H, db);

    expect(rules).toEqual([expect.objectContaining({ id: "milk", storeId: "aldi", only: false })]);
  });

  it("refuses a rule for a store that does not exist", async () => {
    await expect(
      setIngredientStore(H, { name: "milk", storeId: "costco" }, db),
    ).rejects.toBeInstanceOf(StoreNotFoundError);
  });

  it("reports deleting a rule that does not exist", async () => {
    await expect(deleteIngredientStore(H, "milk", db)).rejects.toBeInstanceOf(
      IngredientStoreNotFoundError,
    );
  });
});

describe("routeToStore", () => {
  const routing = {
    primary: "aldi",
    known: new Set(["aldi", "braums", "walmart"]),
    rules: new Map([
      ["milk", { storeId: "braums", only: true }],
      ["ground-beef", { storeId: "walmart", only: false }],
    ]),
  };

  it("sends an item with an only rule to its store whatever the caller named", () => {
    expect(routeToStore(routing, "Milk", "aldi")).toBe("braums");
  });

  it("prefers the caller's store over a rule without only", () => {
    expect(routeToStore(routing, "ground beef", "aldi")).toBe("aldi");
  });

  it("falls back to a rule without only when the caller named no store", () => {
    expect(routeToStore(routing, "ground beef", null)).toBe("walmart");
  });

  it("falls back to the primary store last", () => {
    expect(routeToStore(routing, "onions", undefined)).toBe("aldi");
  });

  it("leaves an item without a store when the household has none", () => {
    expect(
      routeToStore({ primary: null, known: new Set(), rules: new Map() }, "onions", null),
    ).toBe(null);
  });

  it("refuses a store the household does not have", () => {
    expect(() => routeToStore(routing, "onions", "costco")).toThrow(UnknownStoreError);
  });
});

describe("routing on the shopping list", () => {
  beforeEach(async () => {
    await createPlan(H, WEEK, 120, db);
    await createStore(H, "aldi", { name: "Aldi", primary: true }, db);
    await createStore(H, "braums", { name: "Braum's" }, db);
    await setIngredientStore(H, { name: "buttermilk", storeId: "braums", only: true }, db);
  });

  it("routes a rebuilt list by the household's rules", async () => {
    const items = await replaceItems(
      H,
      WEEK,
      [
        { name: "buttermilk", unit: "qt", category: "dairy", storeId: "aldi" },
        { name: "onions", quantity: 2, category: "produce" },
      ],
      db,
    );

    expect(Object.fromEntries(items.map((item) => [item.name, item.storeId]))).toEqual({
      buttermilk: "braums",
      onions: "aldi",
    });
  });

  it("moves an item when a rebuild names a different store", async () => {
    await replaceItems(H, WEEK, [{ name: "onions", category: "produce" }], db);
    const [onions] = await replaceItems(
      H,
      WEEK,
      [{ name: "onions", category: "produce", storeId: "braums" }],
      db,
    );

    expect(onions?.storeId).toBe("braums");
  });

  it("routes a hand-added item by the same rules", async () => {
    const item = await addItem(H, WEEK, { name: "Buttermilk", category: "dairy" }, db);

    expect(item?.storeId).toBe("braums");
  });

  it("reads the routing for the household it was asked about", async () => {
    const routing = await storeRouting(H, db);

    expect(routing.primary).toBe("aldi");
    expect(routing.rules.get("buttermilk")).toEqual({ storeId: "braums", only: true });
  });
});

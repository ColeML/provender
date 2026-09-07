import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

import { deletePrice, getPrice, listPrices, PriceNotFoundError, setPrice } from "./prices";

const H = "loewer";
let db: Database;
let close: () => Promise<void>;

const chicken = { ingredient: "chicken breast", unit: "lb", store: "Sam's Club", price: 2.5 };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("setPrice", () => {
  it("records a price", async () => {
    expect((await setPrice(H, chicken, db)).price).toBe("2.50");
  });

  it("corrects an existing price rather than adding a second row", async () => {
    await setPrice(H, chicken, db);
    await setPrice(H, { ...chicken, price: 2.99 }, db);

    const prices = await listPrices(H, db);

    expect(prices).toHaveLength(1);
    expect(prices[0].price).toBe("2.99");
  });

  it("keeps the same item at a different shop separate", async () => {
    await setPrice(H, chicken, db);
    await setPrice(H, { ...chicken, store: "Walmart", price: 3.2 }, db);

    expect(await listPrices(H, db)).toHaveLength(2);
  });

  it("lowercases the unit, so LB and lb are one price", async () => {
    await setPrice(H, chicken, db);
    await setPrice(H, { ...chicken, unit: "LB", price: 4 }, db);

    const prices = await listPrices(H, db);

    expect(prices).toHaveLength(1);
    expect(prices[0].price).toBe("4.00");
  });
});

describe("getPrice", () => {
  it("finds one regardless of unit casing", async () => {
    await setPrice(H, chicken, db);

    expect((await getPrice(H, "chicken breast", "LB", "Sam's Club", db)).price).toBe("2.50");
  });

  it("reports one that was never recorded", async () => {
    await expect(getPrice(H, "saffron", "g", "Walmart", db)).rejects.toBeInstanceOf(
      PriceNotFoundError,
    );
  });
});

describe("deletePrice", () => {
  it("removes it", async () => {
    await setPrice(H, chicken, db);
    await deletePrice(H, "chicken breast", "lb", "Sam's Club", db);

    expect(await listPrices(H, db)).toEqual([]);
  });

  it("reports one that is not there", async () => {
    await expect(deletePrice(H, "saffron", "g", "Walmart", db)).rejects.toBeInstanceOf(
      PriceNotFoundError,
    );
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { createPlan, PlanNotFoundError } from "@server/services/plans";

import {
  addItem,
  deleteItem,
  estimatedTotal,
  getItem,
  listItems,
  ManualItemOnlyError,
  replaceItems,
  ShoppingItemNotFoundError,
  updateItem,
  type ShoppingItemInput,
} from "./shopping";

const H = "loewer";
const WEEK = "2026-W36";

let db: Database;
let close: () => Promise<void>;

const chicken: ShoppingItemInput = {
  name: "chicken breast",
  quantity: 3,
  unit: "lb",
  category: "meat",
  feedsRecipes: ["fajitas"],
  estCost: 12.5,
};

const peppers: ShoppingItemInput = {
  name: "bell peppers",
  quantity: 3,
  unit: "ea",
  category: "produce",
  estCost: 4,
};

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await setConfigValue(H, "default_budget", "120", db);
  await createPlan(H, WEEK, 120, db);
});

afterEach(async () => {
  await close();
});

describe("replaceItems", () => {
  it("writes the list", async () => {
    const items = await replaceItems(H, WEEK, [chicken, peppers], db);

    expect(items.map((item) => item.name).sort()).toEqual(["bell peppers", "chicken breast"]);
  });

  it("reads aisle by aisle, not in the order it was given", async () => {
    // The category enum is declared in the order the aisles are walked, so ordering by it gives a
    // list you can shop straight down. Produce comes before meat regardless of input order.
    const items = await replaceItems(H, WEEK, [chicken, peppers], db);

    expect(items.map((item) => item.category)).toEqual(["produce", "meat"]);
  });

  it("lowercases units, so one product cannot become two entries", async () => {
    await replaceItems(H, WEEK, [{ ...chicken, unit: "LB" }], db);

    expect((await listItems(H, WEEK, db))[0].unit).toBe("lb");
  });

  it("keeps a tick when the list is rebuilt", async () => {
    await replaceItems(H, WEEK, [chicken, peppers], db);
    const [item] = await listItems(H, WEEK, db);

    await updateItem(H, WEEK, item.id, { purchased: true }, ["purchased"], db);
    await replaceItems(H, WEEK, [chicken, peppers], db);

    expect((await getItem(H, WEEK, item.id, db)).purchased).toBe(true);
  });

  it("keeps haveAlready when the list is rebuilt", async () => {
    await replaceItems(H, WEEK, [chicken], db);
    const [item] = await listItems(H, WEEK, db);

    await updateItem(H, WEEK, item.id, { haveAlready: true }, ["haveAlready"], db);
    await replaceItems(H, WEEK, [chicken], db);

    expect((await getItem(H, WEEK, item.id, db)).haveAlready).toBe(true);
  });

  it("updates the quantity and cost of an item that is still called for", async () => {
    await replaceItems(H, WEEK, [chicken], db);
    await replaceItems(H, WEEK, [{ ...chicken, quantity: 5, estCost: 20 }], db);

    const [item] = await listItems(H, WEEK, db);

    expect(item.quantity).toBe("5");
    expect(item.estCost).toBe("20.00");
  });

  it("drops plan items the new list no longer calls for", async () => {
    await replaceItems(H, WEEK, [chicken, peppers], db);
    await replaceItems(H, WEEK, [chicken], db);

    expect((await listItems(H, WEEK, db)).map((item) => item.name)).toEqual(["chicken breast"]);
  });

  it("clears the plan items when given an empty list", async () => {
    await replaceItems(H, WEEK, [chicken], db);
    await replaceItems(H, WEEK, [], db);

    expect(await listItems(H, WEEK, db)).toEqual([]);
  });

  it("reports a plan that does not exist", async () => {
    await expect(replaceItems(H, "2026-W37", [chicken], db)).rejects.toBeInstanceOf(
      PlanNotFoundError,
    );
  });
});

describe("an item added by hand", () => {
  const brownSugar: ShoppingItemInput = {
    name: "brown sugar",
    quantity: 1,
    unit: "bag",
    category: "pantry",
    estCost: 3,
  };

  beforeEach(async () => {
    await replaceItems(H, WEEK, [chicken], db);
    await addItem(H, WEEK, brownSugar, db);
  });

  it("is marked manual, and feeds no recipe", async () => {
    const item = await getItem(H, WEEK, "brown-sugar_bag", db);

    expect(item.source).toBe("manual");
    expect(item.feedsRecipes).toEqual([]);
  });

  it("survives a rebuild that knows nothing about it", async () => {
    await replaceItems(H, WEEK, [chicken, peppers], db);

    expect((await listItems(H, WEEK, db)).map((item) => item.name)).toContain("brown sugar");
  });

  it("survives a rebuild that clears every plan item", async () => {
    await replaceItems(H, WEEK, [], db);

    expect((await listItems(H, WEEK, db)).map((item) => item.name)).toEqual(["brown sugar"]);
  });

  it("keeps its tick across a rebuild", async () => {
    await updateItem(H, WEEK, "brown-sugar_bag", { purchased: true }, ["purchased"], db);
    await replaceItems(H, WEEK, [chicken, peppers], db);

    expect((await getItem(H, WEEK, "brown-sugar_bag", db)).purchased).toBe(true);
  });

  it("can be deleted", async () => {
    await deleteItem(H, WEEK, "brown-sugar_bag", db);

    await expect(getItem(H, WEEK, "brown-sugar_bag", db)).rejects.toBeInstanceOf(
      ShoppingItemNotFoundError,
    );
  });

  it("is adjusted rather than rejected when added twice", async () => {
    await addItem(H, WEEK, { ...brownSugar, quantity: 2 }, db);

    const items = await listItems(H, WEEK, db);

    expect(items.filter((item) => item.name === "brown sugar")).toHaveLength(1);
    expect((await getItem(H, WEEK, "brown-sugar_bag", db)).quantity).toBe("2");
  });
});

describe("deleting a plan item", () => {
  it("is refused, because a rebuild would bring it back", async () => {
    await replaceItems(H, WEEK, [chicken], db);
    const [item] = await listItems(H, WEEK, db);

    await expect(deleteItem(H, WEEK, item.id, db)).rejects.toBeInstanceOf(ManualItemOnlyError);
  });
});

describe("updateItem", () => {
  it("toggles purchased without touching anything else", async () => {
    await replaceItems(H, WEEK, [chicken], db);
    const [before] = await listItems(H, WEEK, db);

    await updateItem(H, WEEK, before.id, { purchased: true }, ["purchased"], db);

    const after = await getItem(H, WEEK, before.id, db);

    expect(after.purchased).toBe(true);
    expect(after.haveAlready).toBe(before.haveAlready);
    expect(after.quantity).toBe(before.quantity);
  });

  it("reports an item that is not on the list", async () => {
    await expect(
      updateItem(H, WEEK, "nope", { purchased: true }, ["purchased"], db),
    ).rejects.toBeInstanceOf(ShoppingItemNotFoundError);
  });
});

describe("estimatedTotal", () => {
  it("ignores what the shopper already has", async () => {
    await replaceItems(H, WEEK, [chicken, peppers], db);
    const [first] = await listItems(H, WEEK, db);

    await updateItem(H, WEEK, first.id, { haveAlready: true }, ["haveAlready"], db);

    expect(estimatedTotal(await listItems(H, WEEK, db))).toBeCloseTo(12.5);
  });
});

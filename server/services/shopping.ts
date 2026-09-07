import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import { PlanNotFoundError } from "./plans";

/**
 * The shopping list for a week.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 */

export type ShoppingItem = typeof schema.shoppingListItems.$inferSelect;
export type ItemSource = (typeof schema.shoppingItemSource.enumValues)[number];
export type Category = (typeof schema.ingredientCategory.enumValues)[number];

export interface ShoppingItemInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category: Category;
  feedsRecipes?: string[];
  estCost?: number | null;
  haveAlready?: boolean;
}

export class ShoppingItemNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No item named ${id} on this list`);
  }
}

export class ManualItemOnlyError extends Error {
  constructor(readonly id: string) {
    super(
      `${id} comes from the plan, so deleting it would only bring it back on the next rebuild — ` +
        `set haveAlready instead`,
    );
  }
}

function normalizeUnit(unit: string | null | undefined) {
  const trimmed = unit?.trim();

  return trimmed ? trimmed.toLowerCase() : null;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

/**
 * The item's id, from its name and unit.
 *
 * Two entries for the same product in the same unit are the same row, which is what carries a
 * tick across a rebuild.
 */
export function shoppingItemId(name: string, unit: string | null | undefined) {
  const normalized = normalizeUnit(unit);

  return normalized ? `${slug(name)}_${slug(normalized)}` : slug(name);
}

function toRow(householdId: string, planId: string, input: ShoppingItemInput, position: number) {
  return {
    householdId,
    planId,
    id: shoppingItemId(input.name, input.unit),
    name: input.name,
    quantity:
      input.quantity === null || input.quantity === undefined ? null : String(input.quantity),
    unit: normalizeUnit(input.unit),
    category: input.category,
    feedsRecipes: input.feedsRecipes ?? [],
    estCost: input.estCost === null || input.estCost === undefined ? null : String(input.estCost),
    haveAlready: input.haveAlready ?? false,
    position,
  };
}

async function requirePlan(householdId: string, planId: string, db: Database) {
  const [plan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)));

  if (!plan) {
    throw new PlanNotFoundError(planId);
  }
}

export async function listItems(householdId: string, planId: string, db: Database = defaultDb) {
  return db
    .select()
    .from(schema.shoppingListItems)
    .where(
      and(
        eq(schema.shoppingListItems.householdId, householdId),
        eq(schema.shoppingListItems.planId, planId),
      ),
    )
    .orderBy(
      asc(schema.shoppingListItems.category),
      asc(schema.shoppingListItems.position),
      asc(schema.shoppingListItems.name),
    );
}

/**
 * Replace the plan's items, keeping what the shopper has done and what they added.
 *
 * Two things survive: `purchased` and `haveAlready` on any item still called for — because the row
 * is keyed on name and unit, so it is the same row rather than a re-matched one — and every
 * `manual` item, because a rebuild is about which recipes are scheduled and has no opinion on the
 * brown sugar you added yourself.
 */
export async function replaceItems(
  householdId: string,
  planId: string,
  inputs: ShoppingItemInput[],
  db: Database = defaultDb,
) {
  await requirePlan(householdId, planId, db);

  const rows = inputs.map((input, index) => toRow(householdId, planId, input, index));

  return db.transaction(async (tx) => {
    const planScope = and(
      eq(schema.shoppingListItems.householdId, householdId),
      eq(schema.shoppingListItems.planId, planId),
      eq(schema.shoppingListItems.source, "plan"),
    );

    // Only plan items the new list no longer calls for. Manual items are never in scope here.
    await tx.delete(schema.shoppingListItems).where(
      rows.length > 0
        ? and(
            planScope,
            notInArray(
              schema.shoppingListItems.id,
              rows.map((row) => row.id),
            ),
          )
        : planScope,
    );

    if (rows.length > 0) {
      await tx
        .insert(schema.shoppingListItems)
        .values(rows.map((row) => ({ ...row, source: "plan" as const })))
        .onConflictDoUpdate({
          target: [
            schema.shoppingListItems.householdId,
            schema.shoppingListItems.planId,
            schema.shoppingListItems.id,
          ],
          // `purchased` and `haveAlready` are absent on purpose: the shopper owns those, and a
          // rebuild must not send them back around the store or re-add something they have.
          set: {
            name: sql`excluded.name`,
            quantity: sql`excluded.quantity`,
            unit: sql`excluded.unit`,
            category: sql`excluded.category`,
            feedsRecipes: sql`excluded.feeds_recipes`,
            estCost: sql`excluded.est_cost`,
            position: sql`excluded.position`,
            updateTime: sql`now()`,
          },
        });
    }

    return listItems(householdId, planId, tx as unknown as Database);
  });
}

/** Add one item by hand. It survives every rebuild — that is what `manual` means. */
export async function addItem(
  householdId: string,
  planId: string,
  input: ShoppingItemInput,
  db: Database = defaultDb,
) {
  await requirePlan(householdId, planId, db);

  const existing = await listItems(householdId, planId, db);
  const row = toRow(householdId, planId, input, existing.length);

  const [item] = await db
    .insert(schema.shoppingListItems)
    .values({ ...row, source: "manual" })
    .onConflictDoUpdate({
      target: [
        schema.shoppingListItems.householdId,
        schema.shoppingListItems.planId,
        schema.shoppingListItems.id,
      ],
      // Adding something already on the list adjusts it rather than failing — a shopper asking
      // twice means "make sure this is on there", not "error".
      set: {
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        category: row.category,
        estCost: row.estCost,
        updateTime: sql`now()`,
      },
    })
    .returning();

  return item;
}

export async function getItem(
  householdId: string,
  planId: string,
  id: string,
  db: Database = defaultDb,
) {
  const [item] = await db
    .select()
    .from(schema.shoppingListItems)
    .where(
      and(
        eq(schema.shoppingListItems.householdId, householdId),
        eq(schema.shoppingListItems.planId, planId),
        eq(schema.shoppingListItems.id, id),
      ),
    );

  if (!item) {
    throw new ShoppingItemNotFoundError(id);
  }

  return item;
}

/**
 * Tick an item, or mark it as already owned.
 *
 * The most frequent write in the app, and it happens on a phone in a shop — so it updates one
 * row by id without reading first, and the caller can fire it optimistically.
 */
export async function updateItem(
  householdId: string,
  planId: string,
  id: string,
  fields: { purchased?: boolean; haveAlready?: boolean; quantity?: number | null },
  updateMask: string[],
  db: Database = defaultDb,
) {
  const named = new Set(updateMask);
  const patch: Record<string, unknown> = { updateTime: sql`now()` };

  if (named.has("purchased")) {
    patch.purchased = fields.purchased ?? false;
  }

  if (named.has("haveAlready")) {
    patch.haveAlready = fields.haveAlready ?? false;
  }

  if (named.has("quantity")) {
    patch.quantity =
      fields.quantity === null || fields.quantity === undefined ? null : String(fields.quantity);
  }

  const [item] = await db
    .update(schema.shoppingListItems)
    .set(patch)
    .where(
      and(
        eq(schema.shoppingListItems.householdId, householdId),
        eq(schema.shoppingListItems.planId, planId),
        eq(schema.shoppingListItems.id, id),
      ),
    )
    .returning();

  if (!item) {
    throw new ShoppingItemNotFoundError(id);
  }

  return item;
}

/**
 * Remove an item you added yourself.
 *
 * A plan item cannot be deleted: a rebuild would re-add anything a recipe still calls for, so the
 * delete would look like it silently failed. `haveAlready` is how you drop one of those.
 */
export async function deleteItem(
  householdId: string,
  planId: string,
  id: string,
  db: Database = defaultDb,
) {
  const item = await getItem(householdId, planId, id, db);

  if (item.source !== "manual") {
    throw new ManualItemOnlyError(id);
  }

  await db
    .delete(schema.shoppingListItems)
    .where(
      and(
        eq(schema.shoppingListItems.householdId, householdId),
        eq(schema.shoppingListItems.planId, planId),
        eq(schema.shoppingListItems.id, id),
      ),
    );
}

/** What the list costs, ignoring what the shopper already has. */
export function estimatedTotal(items: ShoppingItem[]) {
  return items
    .filter((item) => !item.haveAlready)
    .reduce((total, item) => total + Number(item.estCost ?? 0), 0);
}

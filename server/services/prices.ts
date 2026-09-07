import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { and, asc, eq, sql } from "drizzle-orm";

/**
 * Prices the household has paid.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 */

export type Price = typeof schema.prices.$inferSelect;

export interface PriceInput {
  ingredient: string;
  unit: string;
  store: string;
  price: number;
}

export class PriceNotFoundError extends Error {
  constructor(ingredient: string, unit: string, store: string) {
    super(`No price recorded for ${ingredient} (${unit}) at ${store}`);
  }
}

function normalizeUnit(unit: string) {
  return unit.trim().toLowerCase();
}

export async function listPrices(householdId: string, db: Database = defaultDb) {
  return db
    .select()
    .from(schema.prices)
    .where(eq(schema.prices.householdId, householdId))
    .orderBy(asc(schema.prices.ingredient), asc(schema.prices.store));
}

/** Record what something cost. Recording it again is a correction, not a second data point. */
export async function setPrice(householdId: string, input: PriceInput, db: Database = defaultDb) {
  const unit = normalizeUnit(input.unit);

  const [price] = await db
    .insert(schema.prices)
    .values({
      householdId,
      ingredient: input.ingredient.trim(),
      unit,
      store: input.store.trim(),
      price: String(input.price),
    })
    .onConflictDoUpdate({
      target: [
        schema.prices.householdId,
        schema.prices.ingredient,
        schema.prices.unit,
        schema.prices.store,
      ],
      set: { price: String(input.price), updateTime: sql`now()` },
    })
    .returning();

  return price;
}

export async function getPrice(
  householdId: string,
  ingredient: string,
  unit: string,
  store: string,
  db: Database = defaultDb,
) {
  const [price] = await db
    .select()
    .from(schema.prices)
    .where(
      and(
        eq(schema.prices.householdId, householdId),
        eq(schema.prices.ingredient, ingredient),
        eq(schema.prices.unit, normalizeUnit(unit)),
        eq(schema.prices.store, store),
      ),
    );

  if (!price) {
    throw new PriceNotFoundError(ingredient, unit, store);
  }

  return price;
}

export async function deletePrice(
  householdId: string,
  ingredient: string,
  unit: string,
  store: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.prices)
    .where(
      and(
        eq(schema.prices.householdId, householdId),
        eq(schema.prices.ingredient, ingredient),
        eq(schema.prices.unit, normalizeUnit(unit)),
        eq(schema.prices.store, store),
      ),
    )
    .returning({ ingredient: schema.prices.ingredient });

  if (deleted.length === 0) {
    throw new PriceNotFoundError(ingredient, unit, store);
  }
}

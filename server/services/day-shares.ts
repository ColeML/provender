import "server-only";

import { randomBytes } from "node:crypto";

import { db as defaultDb, schema, type Database } from "@server/db";
import { isCalendarDate } from "@server/lib/iso-week";
import { InvalidDateError, InvalidPlanIdError, PlanNotFoundError } from "@server/services/plans";
import { daySlots, type WeekPlanDay } from "@server/services/week-plan";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";

export type DayShare = typeof schema.dayShares.$inferSelect;

type Recipe = typeof schema.recipes.$inferSelect;
type Ingredient = typeof schema.ingredients.$inferSelect;

export interface SharedDay {
  date: string;
  slots: WeekPlanDay[];
  /** Every dish on the day, keyed by recipe id, with its ingredients in recipe order. */
  recipes: Record<string, Recipe & { ingredients: Ingredient[] }>;
}

const live = () => gt(schema.dayShares.expireTime, sql`now()`);

/**
 * The live link for a date, creating one if there is none.
 *
 * An expired row still holds the date's slot in the unique index, so it is deleted first, in the
 * same transaction as the insert.
 */
export async function createDayShare(householdId: string, date: string, db: Database = defaultDb) {
  if (!isCalendarDate(date)) {
    throw new InvalidDateError(date);
  }

  return db.transaction(async (tx) => {
    const forDate = and(
      eq(schema.dayShares.householdId, householdId),
      eq(schema.dayShares.date, date),
    );

    await tx
      .delete(schema.dayShares)
      .where(and(forDate, lte(schema.dayShares.expireTime, sql`now()`)));

    const [minted] = await tx
      .insert(schema.dayShares)
      .values({ token: randomBytes(32).toString("base64url"), householdId, date })
      .onConflictDoNothing({ target: [schema.dayShares.householdId, schema.dayShares.date] })
      .returning();

    if (minted) {
      return minted;
    }

    const [existing] = await tx.select().from(schema.dayShares).where(forDate);

    return existing;
  });
}

/** The live link for a date, or null. */
export async function getDayShare(householdId: string, date: string, db: Database = defaultDb) {
  const [share] = await db
    .select()
    .from(schema.dayShares)
    .where(
      and(eq(schema.dayShares.householdId, householdId), eq(schema.dayShares.date, date), live()),
    );

  return share ?? null;
}

/**
 * The day behind a share token, read live.
 *
 * Like `getSharedRecipe`, this takes no `householdId`: `/d/{token}` answers before anyone has a
 * session. The household is read off the token's own row and never accepted from a caller, and
 * the page must never take a date in the token's place, or any household's days could be read by
 * guessing dates.
 */
export async function getSharedDay(
  token: string,
  db: Database = defaultDb,
): Promise<SharedDay | null> {
  const [share] = await db
    .select()
    .from(schema.dayShares)
    .where(and(eq(schema.dayShares.token, token), live()));

  if (!share) {
    return null;
  }

  const { householdId, date } = share;

  // A link can outlive its week's plan, or be made before the week is planned at all.
  const slots = await daySlots(householdId, date, db).catch((error: unknown) => {
    if (error instanceof PlanNotFoundError || error instanceof InvalidPlanIdError) {
      return [];
    }

    throw error;
  });

  const ids = [...new Set(slots.flatMap((slot) => [slot.main, slot.side, ...slot.extras]))].flatMap(
    (recipe) => (recipe === null ? [] : [recipe.recipeId]),
  );

  if (ids.length === 0) {
    return { date, slots, recipes: {} };
  }

  const [recipes, ingredients] = await Promise.all([
    db
      .select()
      .from(schema.recipes)
      .where(and(eq(schema.recipes.householdId, householdId), inArray(schema.recipes.id, ids))),
    db
      .select()
      .from(schema.ingredients)
      .where(
        and(
          eq(schema.ingredients.householdId, householdId),
          inArray(schema.ingredients.recipeId, ids),
        ),
      )
      .orderBy(asc(schema.ingredients.position)),
  ]);

  return {
    date,
    slots,
    recipes: Object.fromEntries(
      recipes.map((recipe) => [
        recipe.id,
        { ...recipe, ingredients: ingredients.filter((row) => row.recipeId === recipe.id) },
      ]),
    ),
  };
}

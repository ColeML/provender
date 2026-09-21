import "server-only";

import { randomBytes } from "node:crypto";

import { db as defaultDb, schema, type Database } from "@server/db";
import { getRecipe, listIngredients } from "@server/services/recipes";
import { and, eq } from "drizzle-orm";

/**
 * Public share links.
 *
 * Every function here takes `householdId` first, as the rest of the services do — except
 * `getSharedRecipe`, which is the one read in the app that deliberately has no household to scope
 * to. See the note on it.
 */

export type RecipeShare = typeof schema.recipeShares.$inferSelect;

/** Raised when a recipe already has a live share (AIP-133 → ALREADY_EXISTS). */
export class ShareExistsError extends Error {
  constructor(readonly recipeId: string) {
    super(`${recipeId} is already shared`);
  }
}

/** 256 bits, so the token is not worth guessing at. base64url keeps it safe in a path segment. */
function mintToken() {
  return randomBytes(32).toString("base64url");
}

export async function createShare(householdId: string, recipeId: string, db: Database = defaultDb) {
  // Resolve the recipe first so an unknown id is a NOT_FOUND rather than a foreign key violation,
  // which the handler would have no way to tell from a genuine failure.
  await getRecipe(householdId, recipeId, db);

  // Insert-then-check, as in `createRecipe`: a SELECT followed by an INSERT lets two callers both
  // find nothing and both insert, and the loser fails on the unique index instead of ALREADY_EXISTS.
  let share;

  try {
    [share] = await db
      .insert(schema.recipeShares)
      .values({ token: mintToken(), householdId, recipeId })
      .onConflictDoNothing({
        target: [schema.recipeShares.householdId, schema.recipeShares.recipeId],
      })
      .returning();
  } catch (error) {
    // The recipe can be deleted between the check above and this insert, and the foreign key is
    // what refuses the row. Re-resolving turns that into the NOT_FOUND the caller expects rather
    // than a 500, and rethrows anything else untouched.
    await getRecipe(householdId, recipeId, db);

    throw error;
  }

  if (!share) {
    throw new ShareExistsError(recipeId);
  }

  return share;
}

export async function getShare(householdId: string, recipeId: string, db: Database = defaultDb) {
  const [share] = await db
    .select()
    .from(schema.recipeShares)
    .where(
      and(
        eq(schema.recipeShares.householdId, householdId),
        eq(schema.recipeShares.recipeId, recipeId),
      ),
    );

  return share ?? null;
}

export async function deleteShare(
  householdId: string,
  recipeId: string,
  token: string,
  db: Database = defaultDb,
) {
  const revoked = await db
    .delete(schema.recipeShares)
    .where(
      and(
        eq(schema.recipeShares.householdId, householdId),
        eq(schema.recipeShares.recipeId, recipeId),
        eq(schema.recipeShares.token, token),
      ),
    )
    .returning();

  return revoked.length > 0;
}

/**
 * The recipe behind a share token.
 *
 * The one exported service function without a `householdId`, and the only one that may not have
 * it: `/r/{token}` answers before anyone has a session, so there is no caller to resolve a
 * household from. The token is the whole key — this must never accept a recipe id, or the page
 * becomes a way to read any household's library by guessing slugs, which are words like `ziti`.
 * The household on the row is read *out* of the token, never matched against one supplied.
 */
export async function getSharedRecipe(token: string, db: Database = defaultDb) {
  const [share] = await db
    .select()
    .from(schema.recipeShares)
    .where(eq(schema.recipeShares.token, token));

  if (!share) {
    return null;
  }

  const [recipe] = await db
    .select()
    .from(schema.recipes)
    .where(
      and(eq(schema.recipes.householdId, share.householdId), eq(schema.recipes.id, share.recipeId)),
    );

  if (!recipe) {
    return null;
  }

  const ingredients = await listIngredients(share.householdId, share.recipeId, db);

  return { recipe, ingredients };
}

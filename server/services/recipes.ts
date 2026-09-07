import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { and, asc, eq, gt, sql } from "drizzle-orm";

/**
 * The recipe library.
 *
 * As with every service here, the tRPC procedures and the REST handlers are thin callers of these
 * functions — see `coding-standards.md`. `db` is a parameter with a default so a test can pass a
 * stub without mocking the module graph.
 */

export type Recipe = typeof schema.recipes.$inferSelect;
export type Ingredient = typeof schema.ingredients.$inferSelect;

export interface IngredientInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category: (typeof schema.ingredientCategory.enumValues)[number];
  notes?: string | null;
}

export interface RecipeInput {
  title: string;
  sourceUrl?: string | null;
  imageUrl?: string | null;
  baseServings: number;
  prepMin?: number | null;
  cookMin?: number | null;
  totalMin?: number | null;
  costEstimate?: number | null;
  tags?: string[];
  instructions?: string[];
}

/** Raised when a caller tries to create a recipe whose id is taken (AIP-133 → ALREADY_EXISTS). */
export class RecipeExistsError extends Error {
  constructor(readonly recipeId: string) {
    super(`A recipe named ${recipeId} already exists`);
  }
}

/** Raised when a page token is not one this API issued (→ INVALID_ARGUMENT). */
export class InvalidPageTokenError extends Error {
  constructor() {
    super("The pageToken is not valid");
  }
}

/** Raised when a recipe id does not resolve (→ NOT_FOUND). */
export class RecipeNotFoundError extends Error {
  constructor(readonly recipeId: string) {
    super(`No recipe named ${recipeId}`);
  }
}

/**
 * Units are compared, not just displayed — the shopping list merges by (name, unit), so `Tbsp` and
 * `tbsp` would look like two different products. v1's data contains both.
 */
function normalizeUnit(unit: string | null | undefined) {
  const trimmed = unit?.trim();

  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * `<recipe_id>_<name-slug>`, suffixed when a recipe uses the same ingredient twice.
 *
 * Kept from v1 so ids survive the migration and stay readable in a resource name.
 */
function ingredientId(recipeId: string, name: string, taken: Set<string>) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item";

  let candidate = `${recipeId}_${slug}`;

  for (let suffix = 2; taken.has(candidate); suffix += 1) {
    candidate = `${recipeId}_${slug}-${suffix}`;
  }

  taken.add(candidate);

  return candidate;
}

function ingredientRows(
  recipeId: string,
  inputs: IngredientInput[],
  taken = new Set<string>(),
  startPosition = 0,
) {
  return inputs.map((input, index) => ({
    id: ingredientId(recipeId, input.name, taken),
    recipeId,
    name: input.name,
    quantity:
      input.quantity === null || input.quantity === undefined ? null : String(input.quantity),
    unit: normalizeUnit(input.unit),
    category: input.category,
    notes: input.notes?.trim() || null,
    position: startPosition + index,
  }));
}

export interface ListOptions {
  pageSize?: number;
  pageToken?: string;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Keyset pagination over the id.
 *
 * The token is an opaque base64 of the last id returned, not an offset: a recipe created or
 * deleted between pages shifts every offset, which silently skips or repeats rows. Opaque because
 * callers must not build one themselves — that is what lets this change later.
 */
function encodeToken(id: string) {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodeToken(token: string | undefined) {
  if (!token) {
    return undefined;
  }

  // `Buffer.from` never throws on malformed base64 — it returns whatever it could decode. Without
  // this check a corrupted token becomes an arbitrary cursor and the caller gets a silently wrong
  // page rather than an error.
  const decoded = Buffer.from(token, "base64url").toString("utf8");

  if (!decoded || encodeToken(decoded) !== token) {
    throw new InvalidPageTokenError();
  }

  return decoded;
}

export async function listRecipes(options: ListOptions = {}, db: Database = defaultDb) {
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const after = decodeToken(options.pageToken);

  // One extra row tells us whether another page exists without a second count query.
  const rows = await db
    .select()
    .from(schema.recipes)
    .where(after ? gt(schema.recipes.id, after) : undefined)
    .orderBy(asc(schema.recipes.id))
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  const last = page.at(-1);

  return {
    recipes: page,
    nextPageToken: rows.length > pageSize && last ? encodeToken(last.id) : undefined,
  };
}

export async function getRecipe(recipeId: string, db: Database = defaultDb) {
  const [recipe] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, recipeId));

  if (!recipe) {
    throw new RecipeNotFoundError(recipeId);
  }

  return recipe;
}

export async function listIngredients(recipeId: string, db: Database = defaultDb) {
  return db
    .select()
    .from(schema.ingredients)
    .where(eq(schema.ingredients.recipeId, recipeId))
    .orderBy(asc(schema.ingredients.position));
}

/**
 * Create a recipe, optionally with its ingredients, in one transaction.
 *
 * Ingredients are accepted inline rather than requiring a POST per ingredient: saving a scraped
 * recipe is otherwise seventeen calls, and a failure halfway leaves a recipe with half its
 * ingredients. The sub-collection still exists for editing one later.
 */
export async function createRecipe(
  recipeId: string,
  input: RecipeInput,
  ingredients: IngredientInput[] = [],
  db: Database = defaultDb,
) {
  return db.transaction(async (tx) => {
    // Insert-then-check rather than check-then-insert: a SELECT followed by an INSERT lets two
    // concurrent callers both find nothing and both insert, so the loser fails on the primary key
    // with an error this function does not recognise and the caller sees 500 instead of 409.
    const [recipe] = await tx
      .insert(schema.recipes)
      .values({
        id: recipeId,
        title: input.title,
        sourceUrl: input.sourceUrl ?? null,
        imageUrl: input.imageUrl ?? null,
        baseServings: input.baseServings,
        prepMin: input.prepMin ?? null,
        cookMin: input.cookMin ?? null,
        totalMin: input.totalMin ?? null,
        costEstimate:
          input.costEstimate === null || input.costEstimate === undefined
            ? null
            : String(input.costEstimate),
        tags: input.tags ?? [],
        instructions: input.instructions ?? [],
      })
      .onConflictDoNothing({ target: schema.recipes.id })
      .returning();

    if (!recipe) {
      throw new RecipeExistsError(recipeId);
    }

    if (ingredients.length > 0) {
      await tx.insert(schema.ingredients).values(ingredientRows(recipeId, ingredients));
    }

    return recipe;
  });
}

/**
 * Partial update (AIP-134). Only the fields named in `updateMask` are touched.
 *
 * `ingredients` in the mask replaces the whole set, because an ingredient list is edited as a list
 * — reconciling individual rows against a client's copy is how duplicates appear.
 */
export async function updateRecipe(
  recipeId: string,
  updateMask: string[],
  input: Partial<RecipeInput>,
  ingredients: IngredientInput[] | undefined,
  db: Database = defaultDb,
) {
  const fields = new Set(updateMask);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipeId));

    if (!existing) {
      throw new RecipeNotFoundError(recipeId);
    }

    // The database's clock, matching the column defaults. Mixing in the Node process's clock
    // lets skew produce an updateTime earlier than the row's own createTime.
    const patch: Record<string, unknown> = { updateTime: sql`now()` };

    if (fields.has("title") && input.title !== undefined) patch.title = input.title;
    if (fields.has("sourceUrl")) patch.sourceUrl = input.sourceUrl ?? null;
    if (fields.has("imageUrl")) patch.imageUrl = input.imageUrl ?? null;
    if (fields.has("baseServings") && input.baseServings !== undefined)
      patch.baseServings = input.baseServings;
    if (fields.has("prepMin")) patch.prepMin = input.prepMin ?? null;
    if (fields.has("cookMin")) patch.cookMin = input.cookMin ?? null;
    if (fields.has("totalMin")) patch.totalMin = input.totalMin ?? null;
    if (fields.has("costEstimate"))
      patch.costEstimate =
        input.costEstimate === null || input.costEstimate === undefined
          ? null
          : String(input.costEstimate);
    if (fields.has("tags")) patch.tags = input.tags ?? [];
    if (fields.has("instructions")) patch.instructions = input.instructions ?? [];

    const [recipe] = await tx
      .update(schema.recipes)
      .set(patch)
      .where(eq(schema.recipes.id, recipeId))
      .returning();

    if (fields.has("ingredients")) {
      // An omitted body field under a mask that names it means "clear it", the same as every
      // other field here. Skipping the delete when `ingredients` is absent would make this the one
      // field where naming it in the mask does nothing.
      const replacement = ingredients ?? [];

      await tx.delete(schema.ingredients).where(eq(schema.ingredients.recipeId, recipeId));

      if (replacement.length > 0) {
        await tx.insert(schema.ingredients).values(ingredientRows(recipeId, replacement));
      }
    }

    return recipe;
  });
}

export async function deleteRecipe(recipeId: string, db: Database = defaultDb) {
  const deleted = await db
    .delete(schema.recipes)
    .where(eq(schema.recipes.id, recipeId))
    .returning({ id: schema.recipes.id });

  if (deleted.length === 0) {
    throw new RecipeNotFoundError(recipeId);
  }
}

export async function getIngredient(recipeId: string, id: string, db: Database = defaultDb) {
  const [ingredient] = await db
    .select()
    .from(schema.ingredients)
    .where(and(eq(schema.ingredients.recipeId, recipeId), eq(schema.ingredients.id, id)));

  return ingredient;
}

/**
 * Append one ingredient to an existing recipe.
 *
 * Exists so adding an ingredient is not a read-modify-write of the whole list, which would drop
 * anything added concurrently in between. The position continues from the current last one.
 */
export async function addIngredient(
  recipeId: string,
  input: IngredientInput,
  db: Database = defaultDb,
) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.ingredients)
      .where(eq(schema.ingredients.recipeId, recipeId))
      .orderBy(asc(schema.ingredients.position));

    const [recipe] = await tx
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipeId));

    if (!recipe) {
      throw new RecipeNotFoundError(recipeId);
    }

    const taken = new Set(existing.map((row) => row.id));
    const [row] = ingredientRows(recipeId, [input], taken, existing.length);

    const [created] = await tx.insert(schema.ingredients).values(row).returning();

    return created;
  });
}

export async function deleteIngredient(
  recipeId: string,
  ingredientId: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.ingredients)
    .where(and(eq(schema.ingredients.recipeId, recipeId), eq(schema.ingredients.id, ingredientId)))
    .returning({ id: schema.ingredients.id });

  return deleted.length > 0;
}

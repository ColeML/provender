import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { and, asc, eq, gt } from "drizzle-orm";

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

function ingredientRows(recipeId: string, inputs: IngredientInput[]) {
  const taken = new Set<string>();

  return inputs.map((input, position) => ({
    id: ingredientId(recipeId, input.name, taken),
    recipeId,
    name: input.name,
    quantity:
      input.quantity === null || input.quantity === undefined ? null : String(input.quantity),
    unit: normalizeUnit(input.unit),
    category: input.category,
    notes: input.notes?.trim() || null,
    position,
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

  const decoded = Buffer.from(token, "base64url").toString("utf8");

  return decoded || undefined;
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
    const existing = await tx
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipeId));

    if (existing.length > 0) {
      throw new RecipeExistsError(recipeId);
    }

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
      .returning();

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

    const patch: Record<string, unknown> = { updateTime: new Date() };

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

    if (fields.has("ingredients") && ingredients) {
      await tx.delete(schema.ingredients).where(eq(schema.ingredients.recipeId, recipeId));

      if (ingredients.length > 0) {
        await tx.insert(schema.ingredients).values(ingredientRows(recipeId, ingredients));
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

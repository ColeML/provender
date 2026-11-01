import "server-only";

import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";
import { parseStep, type StepPart } from "@server/lib/step-quantities";
import { scaleFactor, scaleQuantity, type ScalingKind } from "@server/lib/units";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * The recipe library.
 *
 * As with every service here, the tRPC procedures and the REST handlers are thin callers of these
 * functions — see `coding-standards.md`.
 *
 * `householdId` is the required first parameter on every exported function. The failure that
 * matters is not a wrong query but a forgotten one: a function that omits the household filter
 * returns every household's rows and looks entirely normal in review. Requiring it moves that
 * mistake to compile time.
 */

export type Recipe = typeof schema.recipes.$inferSelect;
export type Ingredient = typeof schema.ingredients.$inferSelect;

export interface IngredientInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  category: (typeof schema.ingredientCategory.enumValues)[number];
  notes?: string | null;
  scaling: ScalingKind;
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

/** Raised when same-named ingredients of one recipe differ in scaling (→ INVALID_ARGUMENT). */
export class ScalingConflictError extends Error {
  constructor(
    readonly ingredientName: string,
    kinds: readonly [ScalingKind, ScalingKind],
  ) {
    super(
      `Every ${ingredientName} in a recipe must have the same scaling, not both ${kinds[0]} and ${kinds[1]}`,
    );
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

export function assertConsistentScaling(
  ingredients: readonly { name: string; scaling: ScalingKind }[],
) {
  const kinds = new Map<string, ScalingKind>();

  for (const { name, scaling } of ingredients) {
    const key = name.trim().toLowerCase();
    const seen = kinds.get(key);

    if (seen !== undefined && seen !== scaling) {
      throw new ScalingConflictError(name.trim(), [seen, scaling]);
    }

    kinds.set(key, scaling);
  }
}

function ingredientRows(
  householdId: string,
  recipeId: string,
  inputs: IngredientInput[],
  taken = new Set<string>(),
  startPosition = 0,
) {
  return inputs.map((input, index) => ({
    householdId,
    id: ingredientId(recipeId, input.name, taken),
    recipeId,
    name: input.name,
    quantity:
      input.quantity === null || input.quantity === undefined ? null : String(input.quantity),
    unit: normalizeUnit(input.unit),
    category: input.category,
    notes: input.notes?.trim() || null,
    scaling: input.scaling,
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

export interface RecipeSummary {
  recipeId: string;
  title: string;
  costEstimate: number | null;
  totalMin: number | null;
}

export async function listRecipes(
  householdId: string,
  options: ListOptions = {},
  db: Database = defaultDb,
) {
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const after = decodeToken(options.pageToken);

  // One extra row tells us whether another page exists without a second count query.
  const rows = await db
    .select()
    .from(schema.recipes)
    .where(
      after
        ? and(eq(schema.recipes.householdId, householdId), gt(schema.recipes.id, after))
        : eq(schema.recipes.householdId, householdId),
    )
    .orderBy(asc(schema.recipes.id))
    .limit(pageSize + 1);

  const page = rows.slice(0, pageSize);
  const last = page.at(-1);

  return {
    recipes: page,
    nextPageToken: rows.length > pageSize && last ? encodeToken(last.id) : undefined,
  };
}

export async function getRecipe(householdId: string, recipeId: string, db: Database = defaultDb) {
  const [recipe] = await db
    .select()
    .from(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), eq(schema.recipes.id, recipeId)));

  if (!recipe) {
    throw new RecipeNotFoundError(recipeId);
  }

  return recipe;
}

/**
 * Every recipe in the library, following the page token to exhaustion.
 *
 * For the screens that show the whole library rather than a page of it. `listRecipes` caps a page
 * at `MAX_PAGE_SIZE`, so a caller that asks for one big page and ignores the token silently loses
 * everything past it — and a search over that page reports a real recipe as missing.
 */
export async function allRecipes(householdId: string, db: Database = defaultDb) {
  const recipes: Recipe[] = [];
  let pageToken: string | undefined;

  do {
    const page = await listRecipes(householdId, { pageSize: MAX_PAGE_SIZE, pageToken }, db);

    recipes.push(...page.recipes);
    pageToken = page.nextPageToken;
  } while (pageToken !== undefined);

  return recipes;
}

export async function listIngredients(
  householdId: string,
  recipeId: string,
  db: Database = defaultDb,
) {
  return db
    .select()
    .from(schema.ingredients)
    .where(
      and(
        eq(schema.ingredients.householdId, householdId),
        eq(schema.ingredients.recipeId, recipeId),
      ),
    )
    .orderBy(asc(schema.ingredients.position));
}

/**
 * The recipes behind a set of ids, for a screen that holds ids and needs to show names.
 *
 * Returns a map rather than an array because every caller is doing a lookup, and an empty set of
 * ids skips the query — `inArray` with an empty list is not valid SQL in every dialect.
 */
export async function recipesByIds(
  householdId: string,
  ids: readonly string[],
  db: Queryable = defaultDb,
) {
  const wanted = [...new Set(ids)];

  if (wanted.length === 0) {
    return new Map<string, RecipeSummary>();
  }

  const rows = await db
    .select({
      id: schema.recipes.id,
      title: schema.recipes.title,
      costEstimate: schema.recipes.costEstimate,
      totalMin: schema.recipes.totalMin,
    })
    .from(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), inArray(schema.recipes.id, wanted)));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        recipeId: row.id,
        title: row.title,
        costEstimate: row.costEstimate === null ? null : Number(row.costEstimate),
        totalMin: row.totalMin,
      },
    ]),
  );
}

/**
 * Create a recipe, optionally with its ingredients, in one transaction.
 *
 * Ingredients are accepted inline rather than requiring a POST per ingredient: saving a scraped
 * recipe is otherwise seventeen calls, and a failure halfway leaves a recipe with half its
 * ingredients. The sub-collection still exists for editing one later.
 */
export async function createRecipe(
  householdId: string,
  recipeId: string,
  input: RecipeInput,
  ingredients: IngredientInput[] = [],
  db: Database = defaultDb,
) {
  return db.transaction((tx) => insertRecipe(householdId, recipeId, input, ingredients, tx));
}

/** The write itself, so a caller committing a whole week can run it in its own transaction. */
export async function insertRecipe(
  householdId: string,
  recipeId: string,
  input: RecipeInput,
  ingredients: IngredientInput[] = [],
  db: Queryable = defaultDb,
) {
  assertConsistentScaling(ingredients);

  // Insert-then-check rather than check-then-insert: a SELECT followed by an INSERT lets two
  // concurrent callers both find nothing and both insert, so the loser fails on the primary key
  // with an error this function does not recognise and the caller sees 500 instead of 409.
  const [recipe] = await db
    .insert(schema.recipes)
    .values({
      householdId,
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
    .onConflictDoNothing({ target: [schema.recipes.householdId, schema.recipes.id] })
    .returning();

  if (!recipe) {
    throw new RecipeExistsError(recipeId);
  }

  if (ingredients.length > 0) {
    await db.insert(schema.ingredients).values(ingredientRows(householdId, recipeId, ingredients));
  }

  return recipe;
}

/** What every write stores: trimmed, no blanks, and no note twice when only the case differs. */
export function normalizeNotes(notes: string[]) {
  const seen = new Set<string>();

  return notes
    .map((note) => note.trim())
    .filter((note) => {
      const folded = note.toLowerCase();

      if (note === "" || seen.has(folded)) {
        return false;
      }

      seen.add(folded);

      return true;
    });
}

/**
 * Partial update (AIP-134). Only the fields named in `updateMask` are touched.
 *
 * `ingredients` in the mask replaces the whole set, because an ingredient list is edited as a list
 * — reconciling individual rows against a client's copy is how duplicates appear.
 */
export async function updateRecipe(
  householdId: string,
  recipeId: string,
  updateMask: string[],
  input: Partial<RecipeInput> & { rating?: number | null; notes?: string[] },
  ingredients: IngredientInput[] | undefined,
  db: Database = defaultDb,
) {
  const fields = new Set(updateMask);

  if (fields.has("ingredients")) {
    assertConsistentScaling(ingredients ?? []);
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.recipes)
      .where(and(eq(schema.recipes.householdId, householdId), eq(schema.recipes.id, recipeId)));

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
    if (fields.has("rating")) patch.rating = input.rating ?? null;
    if (fields.has("notes")) patch.notes = normalizeNotes(input.notes ?? []);

    const [recipe] = await tx
      .update(schema.recipes)
      .set(patch)
      .where(and(eq(schema.recipes.householdId, householdId), eq(schema.recipes.id, recipeId)))
      .returning();

    if (fields.has("ingredients")) {
      // An omitted body field under a mask that names it means "clear it", the same as every
      // other field here. Skipping the delete when `ingredients` is absent would make this the one
      // field where naming it in the mask does nothing.
      const replacement = ingredients ?? [];

      await tx
        .delete(schema.ingredients)
        .where(
          and(
            eq(schema.ingredients.householdId, householdId),
            eq(schema.ingredients.recipeId, recipeId),
          ),
        );

      if (replacement.length > 0) {
        await tx
          .insert(schema.ingredients)
          .values(ingredientRows(householdId, recipeId, replacement));
      }
    }

    return recipe;
  });
}

export async function deleteRecipe(
  householdId: string,
  recipeId: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), eq(schema.recipes.id, recipeId)))
    .returning({ id: schema.recipes.id });

  if (deleted.length === 0) {
    throw new RecipeNotFoundError(recipeId);
  }
}

export async function getIngredient(
  householdId: string,
  recipeId: string,
  id: string,
  db: Database = defaultDb,
) {
  const [ingredient] = await db
    .select()
    .from(schema.ingredients)
    .where(
      and(
        eq(schema.ingredients.householdId, householdId),
        eq(schema.ingredients.recipeId, recipeId),
        eq(schema.ingredients.id, id),
      ),
    );

  return ingredient;
}

/**
 * Append one ingredient to an existing recipe.
 *
 * Exists so adding an ingredient is not a read-modify-write of the whole list, which would drop
 * anything added concurrently in between. The position continues from the current last one.
 */
export async function addIngredient(
  householdId: string,
  recipeId: string,
  input: IngredientInput,
  db: Database = defaultDb,
) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(schema.ingredients)
      .where(
        and(
          eq(schema.ingredients.householdId, householdId),
          eq(schema.ingredients.recipeId, recipeId),
        ),
      )
      .orderBy(asc(schema.ingredients.position));

    const [recipe] = await tx
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(and(eq(schema.recipes.householdId, householdId), eq(schema.recipes.id, recipeId)));

    if (!recipe) {
      throw new RecipeNotFoundError(recipeId);
    }

    assertConsistentScaling([...existing, input]);

    const taken = new Set(existing.map((row) => row.id));
    const [row] = ingredientRows(householdId, recipeId, [input], taken, existing.length);

    const [created] = await tx.insert(schema.ingredients).values(row).returning();

    return created;
  });
}

export async function deleteIngredient(
  householdId: string,
  recipeId: string,
  ingredientId: string,
  db: Database = defaultDb,
) {
  const deleted = await db
    .delete(schema.ingredients)
    .where(
      and(
        eq(schema.ingredients.householdId, householdId),
        eq(schema.ingredients.recipeId, recipeId),
        eq(schema.ingredients.id, ingredientId),
      ),
    )
    .returning({ id: schema.ingredients.id });

  return deleted.length > 0;
}

export interface ScaledIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: Ingredient["category"];
  notes: string | null;
  scaling: ScalingKind;
}

export interface ScaledRecipe {
  recipeId: string;
  baseServings: number;
  targetServings: number;
  factor: number;
  ingredients: ScaledIngredient[];
  /** Each step split into text and marked amounts, the amounts scaled as an ingredient is. */
  instructions: StepPart[][];
}

/**
 * A recipe's ingredients and marked step amounts at a different serving count, writing nothing.
 *
 * Each ingredient follows its scaling kind's curve, chosen when the recipe was saved. Cook time and
 * pan size stay with the caller. Marked step amounts scale linearly.
 *
 * Volume quantities are snapped to something a kitchen can measure, which may change the unit
 * (`4/9 cup` becomes `7⅛ tbsp`). An ingredient with no quantity — "salt, to taste" — passes
 * through untouched.
 */
export async function scaleRecipe(
  householdId: string,
  recipeId: string,
  targetServings: number,
  db: Database = defaultDb,
): Promise<ScaledRecipe> {
  const recipe = await getRecipe(householdId, recipeId, db);
  const ingredients = await listIngredients(householdId, recipeId, db);
  const factor = scaleFactor(recipe.baseServings, targetServings);

  return {
    recipeId,
    baseServings: recipe.baseServings,
    targetServings,
    factor,
    ingredients: ingredients.map((ingredient) => {
      if (ingredient.quantity === null) {
        return {
          name: ingredient.name,
          quantity: null,
          unit: ingredient.unit,
          category: ingredient.category,
          notes: ingredient.notes,
          scaling: ingredient.scaling,
        };
      }

      const scaled = scaleQuantity(
        Number(ingredient.quantity),
        ingredient.unit,
        factor,
        ingredient.scaling,
      );

      return {
        name: ingredient.name,
        quantity: scaled.quantity,
        unit: scaled.unit,
        category: ingredient.category,
        notes: ingredient.notes,
        scaling: ingredient.scaling,
      };
    }),
    instructions: recipe.instructions.map((step) =>
      parseStep(step).map((part) =>
        typeof part === "string" ? part : scaleQuantity(part.quantity, part.unit, factor, "linear"),
      ),
    ),
  };
}

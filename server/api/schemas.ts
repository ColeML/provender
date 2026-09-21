import { z } from "@hono/zod-openapi";

import type { IngredientInput } from "@server/services/recipes";

/** The store aisles the shopping list groups by. Mirrors the `ingredient_category` enum. */
export const CategorySchema = z.enum([
  "produce",
  "meat",
  "dairy",
  "bakery",
  "frozen",
  "pantry",
  "other",
]);

export const IngredientSchema = z
  .object({
    name: z.string().openapi({ example: "recipes/chicken-fajitas/ingredients/fajitas_paprika" }),
    ingredientName: z.string().min(1).openapi({ example: "paprika" }),
    // Null rather than absent for "to taste" and garnishes: the field is answered, not unknown.
    quantity: z.number().nullable().openapi({ example: 1 }),
    unit: z.string().nullable().openapi({ example: "tbsp" }),
    category: CategorySchema,
    notes: z.string().nullable().openapi({ example: "to taste" }),
  })
  .openapi("Ingredient");

export const IngredientInputSchema = z
  .object({
    ingredientName: z.string().min(1),
    quantity: z.number().nullish(),
    unit: z.string().nullish(),
    category: CategorySchema,
    notes: z.string().nullish(),
  })
  .openapi("IngredientInput");

/** The HTTP field is `ingredientName`; the service field is `name`. One place converts. */
export function toIngredientInput(input: z.infer<typeof IngredientInputSchema>): IngredientInput {
  return {
    name: input.ingredientName,
    quantity: input.quantity,
    unit: input.unit,
    category: input.category,
    notes: input.notes,
  };
}

export const RecipeSchema = z
  .object({
    name: z.string().openapi({ example: "recipes/chicken-fajitas" }),
    recipeId: z.string().openapi({ example: "chicken-fajitas" }),
    title: z.string().openapi({ example: "Chicken Fajitas" }),
    sourceUrl: z.string().nullable(),
    imageUrl: z.string().nullable(),
    // The servings the recipe is stored at — what gets cooked, not the source's original yield.
    baseServings: z.number().int().openapi({ example: 8 }),
    prepMin: z.number().int().nullable(),
    cookMin: z.number().int().nullable(),
    totalMin: z.number().int().nullable(),
    costEstimate: z.number().nullable().openapi({ example: 10.19 }),
    tags: z.array(z.string()),
    instructions: z.array(z.string()),
    createTime: z.string().openapi({ example: "2026-09-07T03:00:00.000Z" }),
    updateTime: z.string(),
  })
  .openapi("Recipe");

export const RecipeInputSchema = z
  .object({
    title: z.string().min(1),
    sourceUrl: z.string().url().nullish(),
    imageUrl: z.string().url().nullish(),
    baseServings: z.number().int().positive(),
    prepMin: z.number().int().nonnegative().nullish(),
    cookMin: z.number().int().nonnegative().nullish(),
    totalMin: z.number().int().nonnegative().nullish(),
    costEstimate: z.number().nonnegative().nullish(),
    tags: z.array(z.string()).optional(),
    instructions: z.array(z.string()).optional(),
    ingredients: z.array(IngredientInputSchema).optional(),
  })
  .openapi("RecipeInput");

export const ListRecipesResponseSchema = z
  .object({
    recipes: z.array(RecipeSchema),
    nextPageToken: z.string().optional(),
  })
  .openapi("ListRecipesResponse");

export const ShareSchema = z
  .object({
    name: z.string().openapi({ example: "recipes/chicken-fajitas/shares/9xK2...q7" }),
    // The token is the id in the resource name, and the whole key `/r/{token}` resolves by.
    token: z.string().openapi({ example: "9xK2...q7" }),
    recipeId: z.string().openapi({ example: "chicken-fajitas" }),
    createTime: z.string().openapi({ example: "2026-09-21T14:00:00.000Z" }),
  })
  // No `updateTime`: a share is minted and revoked, never changed.
  .openapi("Share");

// No `nextPageToken`, and the route takes no `pageSize`/`pageToken` — the deliberate exception to
// the List convention in `coding-standards.md`. The unique index on (household_id, recipe_id) caps
// this collection at one row, so there is never a second page to ask for.
export const ListSharesResponseSchema = z
  .object({ shares: z.array(ShareSchema) })
  .openapi("ListSharesResponse");

export const MealSlotSchema = z.enum(["breakfast", "lunch", "dinner"]);

export const PlanDaySchema = z
  .object({
    name: z.string().openapi({ example: "plans/2026-W36/days/2026-08-31" }),
    date: z.string().openapi({ example: "2026-08-31" }),
    mealSlot: MealSlotSchema,
    servings: z.number().int().openapi({ example: 8 }),
    // Free text on purpose: v1 grew `potluck` alongside `planned` without a schema change.
    status: z.string().openapi({ example: "planned" }),
    notes: z.string().nullable(),
    main: z.string().nullable().openapi({ example: "chicken-fajitas" }),
    side: z.string().nullable(),
    extras: z.array(z.string()),
  })
  .openapi("PlanDay");

export const PlanDayInputSchema = z
  .object({
    servings: z.number().int().positive(),
    status: z.string().optional(),
    notes: z.string().nullish(),
    main: z.string().nullish(),
    side: z.string().nullish(),
    extras: z.array(z.string()).optional(),
  })
  .openapi("PlanDayInput");

export const CommitDayInputSchema = PlanDayInputSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealSlot: MealSlotSchema.default("dinner"),
}).openapi("CommitDayInput");

export const CommitRecipeInputSchema = RecipeInputSchema.extend({
  recipeId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
}).openapi("CommitRecipeInput");

export const PlanSchema = z
  .object({
    name: z.string().openapi({ example: "plans/2026-W36" }),
    planId: z.string().openapi({ example: "2026-W36" }),
    budgetTarget: z.number().nullable().openapi({ example: 120 }),
    days: z.array(PlanDaySchema),
    createTime: z.string(),
    updateTime: z.string(),
  })
  .openapi("Plan");

export const WeekCommitRequestSchema = z
  .object({
    budgetTarget: z.number().nonnegative().nullish(),
    recipes: z.array(CommitRecipeInputSchema).optional(),
    // At least one day: a commit that writes nothing is a caller mistake, not an empty success.
    days: z.array(CommitDayInputSchema).min(1),
    replaceExistingDays: z.boolean().optional(),
  })
  .openapi("WeekCommitRequest");

export const WeekCommitResponseSchema = z
  .object({
    plan: PlanSchema,
    createdRecipeIds: z.array(z.string()),
    historyEntryIds: z.array(z.string()),
  })
  .openapi("WeekCommitResponse");

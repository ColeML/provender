import { z } from "@hono/zod-openapi";

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

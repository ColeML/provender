import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  CategorySchema,
  IngredientInputSchema,
  IngredientSchema,
  ListRecipesResponseSchema,
  RecipeInputSchema,
  RecipeSchema,
} from "@server/api/schemas";
import {
  createRecipe,
  deleteIngredient,
  deleteRecipe,
  getRecipe,
  listIngredients,
  listRecipes,
  updateRecipe,
  addIngredient,
  getIngredient,
  InvalidPageTokenError,
  scaleRecipe,
  RecipeExistsError,
  RecipeNotFoundError,
  type Ingredient,
  type IngredientInput,
  type Recipe,
} from "@server/services/recipes";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

/**
 * Wire shapes.
 *
 * `numeric` columns come back from the driver as strings, so the conversion happens once here
 * rather than in every caller. `name` is the AIP relative resource name, built rather than stored.
 */
function toRecipeResource(recipe: Recipe) {
  return {
    name: `recipes/${recipe.id}`,
    recipeId: recipe.id,
    title: recipe.title,
    sourceUrl: recipe.sourceUrl,
    imageUrl: recipe.imageUrl,
    baseServings: recipe.baseServings,
    prepMin: recipe.prepMin,
    cookMin: recipe.cookMin,
    totalMin: recipe.totalMin,
    costEstimate: recipe.costEstimate === null ? null : Number(recipe.costEstimate),
    tags: recipe.tags,
    instructions: recipe.instructions,
    createTime: recipe.createTime.toISOString(),
    updateTime: recipe.updateTime.toISOString(),
  };
}

function toIngredientResource(ingredient: Ingredient) {
  return {
    name: `recipes/${ingredient.recipeId}/ingredients/${ingredient.id}`,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity === null ? null : Number(ingredient.quantity),
    unit: ingredient.unit,
    category: ingredient.category,
    notes: ingredient.notes,
  };
}

/** The API calls it `ingredientName`; `name` is reserved for the resource name (AIP-122). */
function toIngredientInput(input: {
  ingredientName: string;
  quantity?: number | null;
  unit?: string | null;
  category: IngredientInput["category"];
  notes?: string | null;
}): IngredientInput {
  return {
    name: input.ingredientName,
    quantity: input.quantity,
    unit: input.unit,
    category: input.category,
    notes: input.notes,
  };
}

/** What `updateMask` may name. A mask naming anything else is rejected rather than ignored. */
const UPDATABLE_FIELDS = new Set([
  "title",
  "sourceUrl",
  "imageUrl",
  "baseServings",
  "prepMin",
  "cookMin",
  "totalMin",
  "costEstimate",
  "tags",
  "instructions",
  "ingredients",
]);

const RecipeIdParam = z.object({
  recipe: z
    .string()
    .min(1)
    .openapi({ param: { name: "recipe", in: "path" }, example: "fajitas" }),
});

export const recipesRoutes = new OpenAPIHono<ApiEnv>();

recipesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/recipes",
    summary: "List recipes",
    request: {
      query: z.object({
        pageSize: z.coerce.number().int().positive().max(200).optional(),
        pageToken: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "A page of recipes",
        content: { "application/json": { schema: ListRecipesResponseSchema } },
      },
      400: { description: "The pageToken is not one this API issued" },
    },
  }),
  async (c) => {
    const { pageSize, pageToken } = c.req.valid("query");

    try {
      const { recipes, nextPageToken } = await listRecipes(c.get("householdId"), {
        pageSize,
        pageToken,
      });

      return c.json(
        { recipes: recipes.map(toRecipeResource), ...(nextPageToken ? { nextPageToken } : {}) },
        200,
      );
    } catch (error) {
      if (error instanceof InvalidPageTokenError) {
        return apiError(c, "INVALID_ARGUMENT", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/recipes/{recipe}",
    summary: "Get a recipe",
    request: { params: RecipeIdParam },
    responses: {
      200: { description: "The recipe", content: { "application/json": { schema: RecipeSchema } } },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");

    try {
      return c.json(toRecipeResource(await getRecipe(c.get("householdId"), recipe)), 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "post",
    path: "/recipes",
    summary: "Create a recipe",
    request: {
      // Client-assigned id (AIP-133): the caller picks the slug, so re-sending the same recipe
      // conflicts instead of silently creating a second copy.
      query: z.object({
        recipeId: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
      }),
      body: { content: { "application/json": { schema: RecipeInputSchema } } },
    },
    responses: {
      200: {
        description: "The created recipe",
        content: { "application/json": { schema: RecipeSchema } },
      },
      409: { description: "A recipe with that id already exists" },
    },
  }),
  async (c) => {
    const { recipeId } = c.req.valid("query");
    const { ingredients, ...recipe } = c.req.valid("json");

    try {
      const created = await createRecipe(
        c.get("householdId"),
        recipeId,
        recipe,
        (ingredients ?? []).map(toIngredientInput),
      );

      return c.json(toRecipeResource(created), 200);
    } catch (error) {
      if (error instanceof RecipeExistsError) {
        return apiError(c, "ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/recipes/{recipe}",
    summary: "Partially update a recipe",
    request: {
      params: RecipeIdParam,
      // AIP-134: only the named fields are touched. Without a mask, omitting a field is
      // indistinguishable from clearing it, and a client that fetched an older copy silently
      // reverts whatever changed in between.
      query: z.object({
        updateMask: z
          .string()
          .min(1)
          .openapi({ example: "title,tags", description: "Comma-separated field names" }),
      }),
      body: { content: { "application/json": { schema: RecipeInputSchema.partial() } } },
    },
    responses: {
      200: {
        description: "The updated recipe",
        content: { "application/json": { schema: RecipeSchema } },
      },
      400: { description: "The update mask names an unknown field" },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");
    const { updateMask } = c.req.valid("query");
    const { ingredients, ...patch } = c.req.valid("json");

    const fields = updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const unknown = fields.filter((field) => !UPDATABLE_FIELDS.has(field));

    if (fields.length === 0) {
      // An empty mask would update nothing and answer 200, so a client that built the mask from an
      // empty array would read a lost write as a successful one.
      return apiError(c, "INVALID_ARGUMENT", "updateMask names no fields");
    }

    if (unknown.length > 0) {
      // Silently ignoring an unknown field means a typo'd mask reports success while changing
      // nothing — the caller has no way to tell that from a no-op update.
      return apiError(
        c,
        "INVALID_ARGUMENT",
        `Unknown field(s) in updateMask: ${unknown.join(", ")}`,
      );
    }

    try {
      const updated = await updateRecipe(
        c.get("householdId"),
        recipe,
        fields,
        patch,
        ingredients?.map(toIngredientInput),
      );

      return c.json(toRecipeResource(updated), 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/recipes/{recipe}",
    summary: "Delete a recipe and its ingredients",
    request: { params: RecipeIdParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");

    try {
      await deleteRecipe(c.get("householdId"), recipe);

      return c.json({}, 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/recipes/{recipe}/ingredients",
    summary: "List a recipe's ingredients, in recipe order",
    request: { params: RecipeIdParam },
    responses: {
      200: {
        description: "The ingredients",
        content: {
          "application/json": { schema: z.object({ ingredients: z.array(IngredientSchema) }) },
        },
      },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");

    try {
      // Resolve the recipe first: an unknown id would otherwise return an empty list, which reads
      // as "this recipe has no ingredients" rather than "there is no such recipe".
      await getRecipe(c.get("householdId"), recipe);

      return c.json(
        {
          ingredients: (await listIngredients(c.get("householdId"), recipe)).map(
            toIngredientResource,
          ),
        },
        200,
      );
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "post",
    path: "/recipes/{recipe}/ingredients",
    summary: "Add one ingredient to a recipe",
    request: {
      params: RecipeIdParam,
      body: { content: { "application/json": { schema: IngredientInputSchema } } },
    },
    responses: {
      200: {
        description: "The added ingredient",
        content: { "application/json": { schema: IngredientSchema } },
      },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const created = await addIngredient(c.get("householdId"), recipe, toIngredientInput(input));

      return c.json(toIngredientResource(created), 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/recipes/{recipe}/ingredients/{ingredient}",
    summary: "Get one ingredient",
    request: {
      params: RecipeIdParam.extend({
        ingredient: z
          .string()
          .min(1)
          .openapi({ param: { name: "ingredient", in: "path" }, example: "fajitas_paprika" }),
      }),
    },
    responses: {
      200: {
        description: "The ingredient",
        content: { "application/json": { schema: IngredientSchema } },
      },
      404: { description: "No such ingredient" },
    },
  }),
  async (c) => {
    const { recipe, ingredient } = c.req.valid("param");
    const found = await getIngredient(c.get("householdId"), recipe, ingredient);

    if (!found) {
      return apiError(c, "NOT_FOUND", `No ingredient named ${ingredient} on ${recipe}`);
    }

    return c.json(toIngredientResource(found), 200);
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/recipes/{recipe}/ingredients/{ingredient}",
    summary: "Delete one ingredient",
    request: {
      params: RecipeIdParam.extend({
        ingredient: z
          .string()
          .min(1)
          .openapi({ param: { name: "ingredient", in: "path" }, example: "fajitas_paprika" }),
      }),
    },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      404: { description: "No such ingredient" },
    },
  }),
  async (c) => {
    const { recipe, ingredient } = c.req.valid("param");

    if (!(await deleteIngredient(c.get("householdId"), recipe, ingredient))) {
      return apiError(c, "NOT_FOUND", `No ingredient named ${ingredient} on ${recipe}`);
    }

    return c.json({}, 200);
  },
);

recipesRoutes.openapi(
  createRoute({
    method: "post",
    // AIP-136: a custom method, because scaling neither creates nor changes a resource. POST
    // rather than GET because it is a computation over a body, and it deliberately writes nothing.
    path: "/recipes:scale",
    summary: "Scale a recipe's ingredients without changing it",
    description:
      "The mechanical half of scaling. Volume quantities snap to something a kitchen can " +
      "measure, which may change the unit \u2014 4/9 cup becomes 7 1/8 tbsp. The judgment stays with " +
      "the caller: spices and leavening do not scale linearly, eggs and cans round to whole " +
      "numbers, and cook time and pan size need adjusting.\n\n" +
      "The recipe is named in the body rather than the path. AIP-136 would put this on the " +
      "resource (`recipes/{recipe}:scale`), but Hono reads a colon as a parameter marker, so a " +
      "colon straight after a path parameter makes the parameter unbindable \u2014 verified, " +
      "including with the colon escaped. A collection-level custom method is the same AIP-136 " +
      "shape without the collision.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              recipeId: z.string().min(1),
              targetServings: z.number().int().positive().max(500),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "The scaled ingredients",
        content: {
          "application/json": {
            schema: z.object({
              recipeId: z.string(),
              baseServings: z.number().int(),
              targetServings: z.number().int(),
              factor: z.number(),
              ingredients: z.array(
                z.object({
                  ingredientName: z.string(),
                  quantity: z.number().nullable(),
                  unit: z.string().nullable(),
                  category: CategorySchema,
                  notes: z.string().nullable(),
                }),
              ),
            }),
          },
        },
      },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipeId, targetServings } = c.req.valid("json");

    try {
      const scaled = await scaleRecipe(c.get("householdId"), recipeId, targetServings);

      return c.json(
        {
          ...scaled,
          ingredients: scaled.ingredients.map((ingredient) => ({
            ingredientName: ingredient.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            category: ingredient.category,
            notes: ingredient.notes,
          })),
        },
        200,
      );
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

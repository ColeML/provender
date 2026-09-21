import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import { ListSharesResponseSchema, ShareSchema } from "@server/api/schemas";
import { getRecipe, RecipeNotFoundError } from "@server/services/recipes";
import {
  createShare,
  deleteShare,
  getShare,
  ShareExistsError,
  type RecipeShare,
} from "@server/services/shares";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toShareResource(share: RecipeShare) {
  return {
    name: `recipes/${share.recipeId}/shares/${share.token}`,
    token: share.token,
    recipeId: share.recipeId,
    createTime: share.createTime.toISOString(),
  };
}

const RecipeIdParam = z.object({
  recipe: z
    .string()
    .min(1)
    .openapi({ param: { name: "recipe", in: "path" }, example: "fajitas" }),
});

export const sharesRoutes = new OpenAPIHono<ApiEnv>();

sharesRoutes.openapi(
  createRoute({
    method: "post",
    path: "/recipes/{recipe}/shares",
    summary: "Mint a public link to a recipe",
    description:
      "The token is the whole key: `/r/{token}` renders the recipe to anyone holding the link, " +
      "with no session and nothing household-specific on the page. A recipe holds one share at a " +
      "time, so minting a second answers ALREADY_EXISTS — read the live one with GET, or " +
      "revoke it first to rotate the link.",
    request: { params: RecipeIdParam },
    responses: {
      200: { description: "The share", content: { "application/json": { schema: ShareSchema } } },
      404: { description: "No such recipe" },
      409: { description: "The recipe is already shared" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");

    try {
      return c.json(toShareResource(await createShare(c.get("householdId"), recipe)), 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      if (error instanceof ShareExistsError) {
        return apiError(c, "ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  },
);

sharesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/recipes/{recipe}/shares",
    summary: "List a recipe's live share, if it has one",
    request: { params: RecipeIdParam },
    responses: {
      200: {
        description: "The live share, or an empty list",
        content: { "application/json": { schema: ListSharesResponseSchema } },
      },
      404: { description: "No such recipe" },
    },
  }),
  async (c) => {
    const { recipe } = c.req.valid("param");
    const householdId = c.get("householdId");

    try {
      // Resolve the recipe first: an unknown id would otherwise answer an empty list, which reads
      // as "not shared" rather than "there is no such recipe".
      await getRecipe(householdId, recipe);

      const share = await getShare(householdId, recipe);

      return c.json({ shares: share === null ? [] : [toShareResource(share)] }, 200);
    } catch (error) {
      if (error instanceof RecipeNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

sharesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/recipes/{recipe}/shares/{share}",
    summary: "Revoke a share, so the link stops resolving",
    request: {
      params: RecipeIdParam.extend({
        share: z
          .string()
          .min(1)
          .openapi({ param: { name: "share", in: "path" }, example: "9xK2...q7" }),
      }),
    },
    responses: {
      200: { description: "Revoked", content: { "application/json": { schema: z.object({}) } } },
      404: { description: "No such share" },
    },
  }),
  async (c) => {
    const { recipe, share } = c.req.valid("param");

    if (!(await deleteShare(c.get("householdId"), recipe, share))) {
      return apiError(c, "NOT_FOUND", `No share ${share} on ${recipe}`);
    }

    return c.json({}, 200);
  },
);

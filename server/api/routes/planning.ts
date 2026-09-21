import type { ApiEnv } from "@server/api/middleware/bearer";
import { planningRotation, type RotationEntry } from "@server/services/planning";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(entry: RotationEntry) {
  return {
    name: `recipes/${entry.recipeId}`,
    recipeId: entry.recipeId,
    title: entry.title,
    tags: entry.tags,
    totalMin: entry.totalMin,
    costEstimate: entry.costEstimate,
    tier: entry.tier,
    lastPlanned: entry.lastPlanned,
    timesPlanned: entry.timesPlanned,
    daysUntilEligible: entry.daysUntilEligible,
    rating: entry.rating,
  };
}

const RotationEntrySchema = z
  .object({
    name: z.string().openapi({ example: "recipes/baked-ziti" }),
    recipeId: z.string(),
    title: z.string(),
    tags: z.array(z.string()),
    totalMin: z.number().int().nullable(),
    costEstimate: z.number().nullable(),
    tier: z.enum(["unplanned", "eligible", "blocked"]),
    lastPlanned: z.string().nullable().openapi({ example: "2026-08-31" }),
    timesPlanned: z.number().int(),
    daysUntilEligible: z.number().int().nullable(),
    rating: z.number().int().nullable(),
  })
  .openapi("RotationEntry");

export const planningRoutes = new OpenAPIHono<ApiEnv>().openapi(
  createRoute({
    method: "get",
    path: "/planning/rotation",
    summary: "The cookbook ranked for planning",
    description:
      "Every recipe, tiered. `unplanned` has never been planned, `eligible` is outside " +
      "`no_repeat_days`, `blocked` is inside it and carries `daysUntilEligible`. Rows are sorted " +
      "for readability but `tier` is the contract — position within a tier means nothing. " +
      "This reports only: a blocked dish is still plannable on request.",
    responses: {
      200: {
        description: "The ranked cookbook",
        content: {
          "application/json": {
            schema: z.object({ recipes: z.array(RotationEntrySchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const rows = await planningRotation(c.get("householdId"));

    return c.json({ recipes: rows.map(toResource) }, 200);
  },
);

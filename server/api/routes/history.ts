import { MealSlotSchema } from "@server/api/schemas";
import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import { InvalidDateError, PlanDayNotFoundError } from "@server/services/plans";
import {
  deleteHistoryEntry,
  getHistoryEntry,
  listHistory,
  MealHistoryNotFoundError,
  rateMeal,
  recordMeal,
  type MealHistoryEntry,
} from "@server/services/history";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(entry: MealHistoryEntry) {
  return {
    name: `mealHistory/${entry.id}`,
    entryId: entry.id,
    date: entry.date,
    recipeId: entry.recipeId,
    title: entry.title,
    mealSlot: entry.mealSlot,
    rating: entry.rating,
    notes: entry.notes,
    planId: entry.planId,
    createTime: entry.createTime.toISOString(),
    updateTime: entry.updateTime.toISOString(),
  };
}

const EntrySchema = z
  .object({
    name: z.string().openapi({ example: "mealHistory/2026-08-31-fajitas" }),
    entryId: z.string(),
    date: z.string(),
    recipeId: z.string().nullable(),
    title: z.string(),
    mealSlot: MealSlotSchema,
    rating: z.number().int().nullable(),
    notes: z.string().nullable(),
    planId: z.string().nullable(),
    createTime: z.string(),
    updateTime: z.string(),
  })
  .openapi("MealHistoryEntry");

const EntryParam = z.object({
  entry: z
    .string()
    .min(1)
    .openapi({ param: { name: "entry", in: "path" }, example: "2026-08-31-fajitas" }),
});

function historyError(c: Parameters<typeof apiError>[0], error: unknown) {
  if (error instanceof MealHistoryNotFoundError || error instanceof PlanDayNotFoundError) {
    return apiError(c, "NOT_FOUND", error.message);
  }

  if (error instanceof InvalidDateError) {
    return apiError(c, "INVALID_ARGUMENT", error.message);
  }

  throw error;
}

export const historyRoutes = new OpenAPIHono<ApiEnv>();

historyRoutes.openapi(
  createRoute({
    method: "get",
    path: "/mealHistory",
    summary: "List meals planned recently",
    description:
      "Records what was *planned*, not what was eaten. A dish here may never have been cooked, " +
      "so treat repeat-avoidance as a suggestion the caller can override.",
    request: {
      query: z.object({
        withinDays: z.coerce.number().int().positive().max(3650).optional(),
      }),
    },
    responses: {
      200: {
        description: "Entries, newest first",
        content: {
          "application/json": { schema: z.object({ entries: z.array(EntrySchema) }) },
        },
      },
    },
  }),
  async (c) => {
    const { withinDays } = c.req.valid("query");
    const entries = await listHistory(c.get("householdId"), { withinDays });

    return c.json({ entries: entries.map(toResource) }, 200);
  },
);

historyRoutes.openapi(
  createRoute({
    method: "post",
    path: "/mealHistory",
    summary: "Record a planned meal",
    description:
      "Only mains are recorded — sides may repeat freely. That rule lives with the caller, so " +
      "that a meal cooked without a plan can still be recorded.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              recipeId: z.string().min(1),
              title: z.string().min(1),
              mealSlot: MealSlotSchema.optional(),
              rating: z.number().int().min(1).max(5).nullish(),
              notes: z.string().nullish(),
              planId: z.string().nullish(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "The entry", content: { "application/json": { schema: EntrySchema } } },
      400: { description: "The date is not a calendar date" },
      404: { description: "The linked plan day does not exist" },
    },
  }),
  async (c) => {
    try {
      return c.json(toResource(await recordMeal(c.get("householdId"), c.req.valid("json"))), 200);
    } catch (error) {
      return historyError(c, error);
    }
  },
);

historyRoutes.openapi(
  createRoute({
    method: "get",
    path: "/mealHistory/{entry}",
    summary: "Get one entry",
    request: { params: EntryParam },
    responses: {
      200: { description: "The entry", content: { "application/json": { schema: EntrySchema } } },
      404: { description: "No such entry" },
    },
  }),
  async (c) => {
    const { entry } = c.req.valid("param");

    try {
      return c.json(toResource(await getHistoryEntry(c.get("householdId"), entry)), 200);
    } catch (error) {
      return historyError(c, error);
    }
  },
);

historyRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/mealHistory/{entry}",
    summary: "Rate or annotate a meal",
    request: {
      params: EntryParam,
      query: z.object({ updateMask: z.string().min(1).openapi({ example: "rating,notes" }) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              rating: z.number().int().min(1).max(5).nullish(),
              notes: z.string().nullish(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "The entry", content: { "application/json": { schema: EntrySchema } } },
      400: { description: "The update mask names an unknown field" },
      404: { description: "No such entry" },
    },
  }),
  async (c) => {
    const { entry } = c.req.valid("param");
    const { updateMask } = c.req.valid("query");
    const fields = updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const unknown = fields.filter((field) => field !== "rating" && field !== "notes");

    if (fields.length === 0) {
      // An empty mask would update nothing and answer 200, so a client that built the mask from an
      // empty array would read a lost write as a successful one.
      return apiError(c, "INVALID_ARGUMENT", "updateMask names no fields");
    }

    if (unknown.length > 0) {
      return apiError(
        c,
        "INVALID_ARGUMENT",
        `Unknown field(s) in updateMask: ${unknown.join(", ")}`,
      );
    }

    try {
      const updated = await rateMeal(c.get("householdId"), entry, c.req.valid("json"), fields);

      return c.json(toResource(updated), 200);
    } catch (error) {
      return historyError(c, error);
    }
  },
);

historyRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/mealHistory/{entry}",
    summary: "Forget a meal",
    description:
      "v1 had no equivalent, so a dinner that was planned and skipped blocked itself for the " +
      "whole no-repeat window with no way to take it back.",
    request: { params: EntryParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      404: { description: "No such entry" },
    },
  }),
  async (c) => {
    const { entry } = c.req.valid("param");

    try {
      await deleteHistoryEntry(c.get("householdId"), entry);

      return c.json({}, 200);
    } catch (error) {
      return historyError(c, error);
    }
  },
);

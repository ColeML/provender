import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import { PlanDayInputSchema, PlanDaySchema, PlanSchema } from "@server/api/schemas";
import {
  createPlan,
  DateOutsidePlanError,
  DuplicateRecipeError,
  InvalidDateError,
  deletePlan,
  deletePlanDay,
  getPlan,
  getPlanDay,
  InvalidPlanIdError,
  PlanDayNotFoundError,
  PlanExistsError,
  PlanNotFoundError,
  setPlanDay,
  updatePlan,
  type MealSlot,
  type Plan,
  type PlanDayWithRecipes,
} from "@server/services/plans";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toDayResource(planId: string, day: PlanDayWithRecipes) {
  return {
    name: `plans/${planId}/days/${day.date}`,
    date: day.date,
    mealSlot: day.mealSlot,
    servings: day.servings,
    status: day.status,
    notes: day.notes,
    main: day.main,
    side: day.side,
    extras: day.extras,
  };
}

function toPlanResource(plan: Plan, days: PlanDayWithRecipes[]) {
  return {
    name: `plans/${plan.id}`,
    planId: plan.id,
    budgetTarget: plan.budgetTarget === null ? null : Number(plan.budgetTarget),
    days: days.map((day) => toDayResource(plan.id, day)),
    createTime: plan.createTime.toISOString(),
    updateTime: plan.updateTime.toISOString(),
  };
}

/** Every plan error has one AIP status; mapping it once keeps the handlers to their happy path. */
function planError(c: Parameters<typeof apiError>[0], error: unknown) {
  if (error instanceof PlanNotFoundError || error instanceof PlanDayNotFoundError) {
    return apiError(c, "NOT_FOUND", error.message);
  }

  if (
    error instanceof InvalidPlanIdError ||
    error instanceof DateOutsidePlanError ||
    error instanceof InvalidDateError ||
    error instanceof DuplicateRecipeError
  ) {
    return apiError(c, "INVALID_ARGUMENT", error.message);
  }

  if (error instanceof PlanExistsError) {
    return apiError(c, "ALREADY_EXISTS", error.message);
  }

  throw error;
}

const PlanParam = z.object({
  plan: z
    .string()
    .min(1)
    .openapi({ param: { name: "plan", in: "path" }, example: "2026-W36" }),
});

const DayParam = PlanParam.extend({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .openapi({ param: { name: "day", in: "path" }, example: "2026-08-31" }),
});

const MealSlotQuery = z.object({
  mealSlot: z.enum(["dinner", "lunch"]).default("dinner"),
});

const ERRORS = {
  400: { description: "Invalid plan id, or a date outside the plan's week" },
  404: { description: "No such plan or day" },
} as const;

export const plansRoutes = new OpenAPIHono<ApiEnv>();

plansRoutes.openapi(
  createRoute({
    method: "get",
    path: "/plans/{plan}",
    summary: "Get a week's plan with its days",
    request: { params: PlanParam },
    responses: {
      200: { description: "The plan", content: { "application/json": { schema: PlanSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");

    try {
      const { plan: row, days } = await getPlan(c.get("householdId"), plan);

      return c.json(toPlanResource(row, days), 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "post",
    path: "/plans",
    summary: "Create a week's plan",
    request: {
      query: z.object({ planId: z.string().min(1) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ budgetTarget: z.number().nonnegative().nullish() }),
          },
        },
      },
    },
    responses: {
      200: { description: "The plan", content: { "application/json": { schema: PlanSchema } } },
      409: { description: "That week is already planned" },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { planId } = c.req.valid("query");
    const { budgetTarget } = c.req.valid("json");

    try {
      const plan = await createPlan(c.get("householdId"), planId, budgetTarget);

      return c.json(toPlanResource(plan, []), 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/plans/{plan}",
    summary: "Update a plan's budget target",
    request: {
      params: PlanParam,
      query: z.object({ updateMask: z.literal("budgetTarget") }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ budgetTarget: z.number().nonnegative().nullable() }),
          },
        },
      },
    },
    responses: {
      200: { description: "The plan", content: { "application/json": { schema: PlanSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");
    const { budgetTarget } = c.req.valid("json");

    try {
      const updated = await updatePlan(c.get("householdId"), plan, budgetTarget);
      const { days } = await getPlan(c.get("householdId"), plan);

      return c.json(toPlanResource(updated, days), 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/plans/{plan}",
    summary: "Delete a plan and its days",
    request: { params: PlanParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");

    try {
      await deletePlan(c.get("householdId"), plan);

      return c.json({}, 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "get",
    path: "/plans/{plan}/days/{day}",
    summary: "Get one day",
    request: { params: DayParam, query: MealSlotQuery },
    responses: {
      200: { description: "The day", content: { "application/json": { schema: PlanDaySchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, day } = c.req.valid("param");
    const { mealSlot } = c.req.valid("query");

    try {
      const row = await getPlanDay(c.get("householdId"), plan, day, mealSlot as MealSlot);

      return c.json(toDayResource(plan, row), 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "put",
    path: "/plans/{plan}/days/{day}",
    summary: "Write one day, replacing whatever was there",
    description:
      "A day is edited as a whole — its main, side and extras change together — so this replaces " +
      "rather than merges. PUT rather than PATCH for that reason: it is not a partial update.",
    request: {
      params: DayParam,
      query: MealSlotQuery,
      body: { content: { "application/json": { schema: PlanDayInputSchema } } },
    },
    responses: {
      200: { description: "The day", content: { "application/json": { schema: PlanDaySchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, day } = c.req.valid("param");
    const { mealSlot } = c.req.valid("query");
    const input = c.req.valid("json");

    try {
      const row = await setPlanDay(c.get("householdId"), plan, day, mealSlot as MealSlot, input);

      return c.json(toDayResource(plan, row), 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

plansRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/plans/{plan}/days/{day}",
    summary: "Clear one day",
    description:
      "Replaces v1's `plan-clear`. The row is removed rather than blanked, so an unplanned day is " +
      "the absence of a row and readers never skip a phantom entry.",
    request: {
      params: DayParam,
      query: MealSlotQuery.extend({
        // The day's history entry goes with it by default: History records what was planned, and
        // a meal that never happened should not block itself from being planned again.
        keepHistory: z.stringbool().optional(),
      }),
    },
    responses: {
      200: { description: "Cleared", content: { "application/json": { schema: z.object({}) } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, day } = c.req.valid("param");
    const { mealSlot, keepHistory } = c.req.valid("query");

    try {
      await deletePlanDay(c.get("householdId"), plan, day, mealSlot as MealSlot, { keepHistory });

      return c.json({}, 200);
    } catch (error) {
      return planError(c, error);
    }
  },
);

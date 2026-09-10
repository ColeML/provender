import "server-only";

import { getConfig } from "@server/services/config";
import { listHistory } from "@server/services/history";
import { currentOrLatestPlan, deletePlanDay, getPlan, setPlanDay } from "@server/services/plans";
import { weekPlan } from "@server/services/week-plan";
import { listPrices } from "@server/services/prices";
import { getForecast } from "@server/services/weather";
import { estimatedTotal, listItems, updateItem } from "@server/services/shopping";
import { getRecipe, listIngredients, listRecipes, scaleRecipe } from "@server/services/recipes";

import { z } from "zod";

import { protectedProcedure, router } from "../init";

/**
 * The application router. Every procedure the client can call is reachable from here, and its
 * *type* is what gives the browser end-to-end type safety with no code generation step.
 *
 * Procedures delegate to `server/services/*` and decide nothing themselves — see the note in
 * `server/services/config.ts`.
 */
export const appRouter = router({
  config: router({
    get: protectedProcedure.query(({ ctx }) => getConfig(ctx.householdId, ctx.db)),
  }),
  mealHistory: router({
    list: protectedProcedure
      .input(z.object({ withinDays: z.number().int().positive().optional() }).optional())
      .query(({ ctx, input }) =>
        listHistory(ctx.householdId, { withinDays: input?.withinDays }, ctx.db),
      ),
  }),
  prices: router({
    list: protectedProcedure.query(({ ctx }) => listPrices(ctx.householdId, ctx.db)),
  }),
  weather: router({
    get: protectedProcedure
      .input(
        z.object({ location: z.string().optional(), days: z.number().int().optional() }).optional(),
      )
      .query(({ ctx, input }) => getForecast(ctx.householdId, input ?? {}, ctx.db)),
  }),
  shoppingList: router({
    get: protectedProcedure
      .input(z.object({ planId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const items = await listItems(ctx.householdId, input.planId, ctx.db);

        return { items, estimatedTotal: estimatedTotal(items) };
      }),
    /** What the /shop screen loads: the week to shop for, and its list. */
    current: protectedProcedure.query(async ({ ctx }) => {
      const plan = await currentOrLatestPlan(ctx.householdId, ctx.db);

      if (!plan) {
        return { planId: null, budgetTarget: null, items: [], estimatedTotal: 0 };
      }

      const items = await listItems(ctx.householdId, plan.id, ctx.db);

      return {
        planId: plan.id,
        budgetTarget: plan.budgetTarget === null ? null : Number(plan.budgetTarget),
        items,
        estimatedTotal: estimatedTotal(items),
      };
    }),
    // The optimistic toggle the /shop screen fires on every tap.
    setPurchased: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1),
          itemId: z.string().min(1),
          purchased: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) =>
        updateItem(
          ctx.householdId,
          input.planId,
          input.itemId,
          { purchased: input.purchased },
          ["purchased"],
          ctx.db,
        ),
      ),
  }),
  plans: router({
    get: protectedProcedure
      .input(z.object({ planId: z.string().min(1) }))
      .query(({ ctx, input }) => getPlan(ctx.householdId, input.planId, ctx.db)),
    /** What the /plan grid loads: seven dates with their recipes named and priced. */
    week: protectedProcedure
      .input(z.object({ planId: z.string().min(1) }))
      .query(({ ctx, input }) => weekPlan(ctx.householdId, input.planId, ctx.db)),
    setDay: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1),
          date: z.string().min(1),
          servings: z.number().int().positive().max(500),
          status: z.string().min(1).optional(),
          notes: z.string().nullable().optional(),
          main: z.string().nullable().optional(),
          side: z.string().nullable().optional(),
          extras: z.array(z.string().min(1)).optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { planId, date, ...day } = input;

        return setPlanDay(ctx.householdId, planId, date, "dinner", day, ctx.db);
      }),
    clearDay: protectedProcedure
      .input(z.object({ planId: z.string().min(1), date: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deletePlanDay(ctx.householdId, input.planId, input.date, "dinner", {}, ctx.db),
      ),
  }),
  recipes: router({
    list: protectedProcedure
      .input(z.object({ pageSize: z.number().int().positive().max(200).optional() }).optional())
      .query(({ ctx, input }) =>
        listRecipes(ctx.householdId, { pageSize: input?.pageSize }, ctx.db),
      ),
    get: protectedProcedure
      .input(z.object({ recipeId: z.string().min(1) }))
      .query(({ ctx, input }) => getRecipe(ctx.householdId, input.recipeId, ctx.db)),
    ingredients: protectedProcedure
      .input(z.object({ recipeId: z.string().min(1) }))
      .query(({ ctx, input }) => listIngredients(ctx.householdId, input.recipeId, ctx.db)),
    /** The cook view's scale control. Writes nothing — the stored recipe keeps its servings. */
    scale: protectedProcedure
      .input(
        z.object({
          recipeId: z.string().min(1),
          targetServings: z.number().int().positive().max(500),
        }),
      )
      .query(({ ctx, input }) =>
        scaleRecipe(ctx.householdId, input.recipeId, input.targetServings, ctx.db),
      ),
  }),
});

export type AppRouter = typeof appRouter;

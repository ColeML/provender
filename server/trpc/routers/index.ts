import "server-only";

import { getConfig } from "@server/services/config";
import { listHistory } from "@server/services/history";
import { getPlan } from "@server/services/plans";
import { getRecipe, listIngredients, listRecipes } from "@server/services/recipes";

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
  plans: router({
    get: protectedProcedure
      .input(z.object({ planId: z.string().min(1) }))
      .query(({ ctx, input }) => getPlan(ctx.householdId, input.planId, ctx.db)),
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
  }),
});

export type AppRouter = typeof appRouter;

import "server-only";

import { schema } from "@server/db";
import { getConfig, InvalidSettingError, setConfigValue } from "@server/services/config";
import { listHistory } from "@server/services/history";
import { currentOrLatestPlan, deletePlanDay, getPlan, setPlanDay } from "@server/services/plans";
import { weekPlan } from "@server/services/week-plan";
import { listPrices } from "@server/services/prices";
import { getForecast } from "@server/services/weather";
import {
  addItem,
  deleteItem,
  estimatedTotal,
  listItems,
  updateItem,
} from "@server/services/shopping";
import {
  getRecipe,
  listIngredients,
  listRecipes,
  scaleRecipe,
  updateRecipe,
} from "@server/services/recipes";
import { createShare, deleteShare } from "@server/services/shares";
import {
  createStore,
  deleteIngredientStore,
  deleteStore,
  IngredientStoreNotFoundError,
  listIngredientStores,
  listStores,
  setIngredientStore,
  storeId,
  StoreExistsError,
  StoreNotFoundError,
  UnknownStoreError,
  updateStore,
} from "@server/services/stores";
import {
  addWeekNote,
  BlankNoteError,
  DateOutsideWeekError,
  deleteWeekNote,
  InvalidWeekIdError,
  listWeekNotes,
  updateWeekNote,
  WeekNoteNotFoundError,
} from "@server/services/week-notes";
import { TRPCError } from "@trpc/server";

import { z } from "zod";

import { protectedProcedure, router } from "../init";

/** The caller's mistake, so a 400 or 404 rather than the 500 tRPC gives any thrown error. */
function rejectBadNote(error: unknown): never {
  if (error instanceof WeekNoteNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }

  if (
    error instanceof InvalidWeekIdError ||
    error instanceof DateOutsideWeekError ||
    error instanceof BlankNoteError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  throw error;
}

/** The same mapping for stores: a name taken, or a store that is not there. */
function rejectBadStore(error: unknown): never {
  if (error instanceof StoreExistsError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  if (error instanceof StoreNotFoundError || error instanceof IngredientStoreNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }

  if (error instanceof UnknownStoreError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  throw error;
}

function rejectBadSetting(error: unknown): never {
  if (error instanceof InvalidSettingError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  throw error;
}

const AisleSchema = z.enum(schema.ingredientCategory.enumValues);

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
    set: protectedProcedure
      .input(z.object({ key: z.string().min(1), value: z.string() }))
      .mutation(({ ctx, input }) =>
        setConfigValue(ctx.householdId, input.key, input.value, ctx.db).catch(rejectBadSetting),
      ),
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
    /** Something the shopper is out of, which no recipe called for. */
    addItem: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1),
          itemName: z.string().min(1).max(120),
          quantity: z.number().positive().max(9999).nullable(),
          unit: z.string().min(1).max(120).nullable().optional(),
          estCost: z.number().nonnegative().max(99999).nullable().optional(),
          category: AisleSchema,
          storeId: z.string().min(1).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        addItem(
          ctx.householdId,
          input.planId,
          {
            name: input.itemName,
            quantity: input.quantity,
            unit: input.unit,
            category: input.category,
            estCost: input.estCost,
            storeId: input.storeId,
          },
          ctx.db,
        ).catch(rejectBadStore),
      ),
    /** Only a manual item — the service refuses a plan item, which a rebuild would re-add. */
    deleteItem: protectedProcedure
      .input(z.object({ planId: z.string().min(1), itemId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deleteItem(ctx.householdId, input.planId, input.itemId, ctx.db),
      ),
    /** Buy more of a manual item. A plan item gets an extra row instead, which a rebuild keeps. */
    setQuantity: protectedProcedure
      .input(
        z.object({
          planId: z.string().min(1),
          itemId: z.string().min(1),
          quantity: z.number().positive().max(9999),
        }),
      )
      .mutation(({ ctx, input }) =>
        updateItem(
          ctx.householdId,
          input.planId,
          input.itemId,
          { quantity: input.quantity },
          ["quantity"],
          ctx.db,
        ),
      ),
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
  stores: router({
    list: protectedProcedure.query(({ ctx }) => listStores(ctx.householdId, ctx.db)),
    /** The id is the name's slug, so the settings screen never asks for one. */
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(80),
          notes: z.string().max(1000).nullable().optional(),
          primary: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        createStore(ctx.householdId, storeId(input.name), input, ctx.db).catch(rejectBadStore),
      ),
    update: protectedProcedure
      .input(
        z.object({
          storeId: z.string().min(1),
          name: z.string().trim().min(1).max(80).optional(),
          notes: z.string().max(1000).nullable().optional(),
          primary: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { storeId: id, ...fields } = input;
        // The mask is the fields the caller sent, so the form can save notes without a name.
        const mask = Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([field]) => field);

        return updateStore(ctx.householdId, id, fields, mask, ctx.db).catch(rejectBadStore);
      }),
    remove: protectedProcedure
      .input(z.object({ storeId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deleteStore(ctx.householdId, input.storeId, ctx.db).catch(rejectBadStore),
      ),
  }),
  ingredientStores: router({
    list: protectedProcedure.query(({ ctx }) => listIngredientStores(ctx.householdId, ctx.db)),
    set: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          storeId: z.string().min(1),
          only: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) =>
        setIngredientStore(ctx.householdId, input, ctx.db).catch(rejectBadStore),
      ),
    remove: protectedProcedure
      .input(z.object({ ingredientId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deleteIngredientStore(ctx.householdId, input.ingredientId, ctx.db).catch(rejectBadStore),
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
  weekNotes: router({
    list: protectedProcedure
      .input(z.object({ weekId: z.string().min(1) }))
      .query(({ ctx, input }) =>
        listWeekNotes(ctx.householdId, input.weekId, ctx.db).catch(rejectBadNote),
      ),
    add: protectedProcedure
      .input(
        z.object({
          weekId: z.string().min(1),
          date: z.string().nullable().optional(),
          body: z.string(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { weekId, ...note } = input;

        return addWeekNote(ctx.householdId, weekId, note, ctx.db).catch(rejectBadNote);
      }),
    update: protectedProcedure
      .input(
        z.object({
          weekId: z.string().min(1),
          noteId: z.string().min(1),
          date: z.string().nullable().optional(),
          body: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { weekId, noteId, ...update } = input;

        return updateWeekNote(ctx.householdId, weekId, noteId, update, ctx.db).catch(rejectBadNote);
      }),
    remove: protectedProcedure
      .input(z.object({ weekId: z.string().min(1), noteId: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deleteWeekNote(ctx.householdId, input.weekId, input.noteId, ctx.db).catch(rejectBadNote),
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
    setRating: protectedProcedure
      .input(
        z.object({
          recipeId: z.string().min(1),
          rating: z.number().int().min(1).max(5).nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        updateRecipe(
          ctx.householdId,
          input.recipeId,
          ["rating"],
          { rating: input.rating },
          undefined,
          ctx.db,
        ),
      ),
    share: protectedProcedure
      .input(z.object({ recipeId: z.string().min(1) }))
      .mutation(({ ctx, input }) => createShare(ctx.householdId, input.recipeId, ctx.db)),
    revokeShare: protectedProcedure
      .input(z.object({ recipeId: z.string().min(1), token: z.string().min(1) }))
      .mutation(({ ctx, input }) =>
        deleteShare(ctx.householdId, input.recipeId, input.token, ctx.db),
      ),
  }),
});

export type AppRouter = typeof appRouter;

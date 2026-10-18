import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  createStore,
  deleteIngredientStore,
  deleteStore,
  getStore,
  IngredientStoreNotFoundError,
  listIngredientStores,
  listStores,
  setIngredientStore,
  StoreExistsError,
  StoreNotFoundError,
  updateStore,
  type IngredientStore,
  type Store,
} from "@server/services/stores";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toStoreResource(store: Store) {
  return {
    name: `stores/${store.id}`,
    storeId: store.id,
    storeName: store.name,
    notes: store.notes,
    primary: store.primary,
    createTime: store.createTime.toISOString(),
    updateTime: store.updateTime.toISOString(),
  };
}

function toRuleResource(rule: IngredientStore) {
  return {
    name: `ingredientStores/${rule.id}`,
    ingredientId: rule.id,
    ingredientName: rule.name,
    store: rule.storeId,
    only: rule.only,
    createTime: rule.createTime.toISOString(),
    updateTime: rule.updateTime.toISOString(),
  };
}

const StoreSchema = z
  .object({
    name: z.string().openapi({ example: "stores/aldi" }),
    storeId: z.string(),
    storeName: z.string().openapi({ example: "Aldi" }),
    notes: z.string().nullable().openapi({
      example: "Cheapest for produce, dairy and staples. Poor meat counter.",
      description: "What the household wants the planner to know when it picks a store.",
    }),
    primary: z.boolean().openapi({
      description: "Where anything without a better home goes. At most one store has it.",
    }),
    createTime: z.string(),
    updateTime: z.string(),
  })
  .openapi("Store");

const StoreInputSchema = z
  .object({
    storeName: z.string().trim().min(1),
    notes: z.string().nullish(),
    primary: z.boolean().optional(),
  })
  .openapi("StoreInput");

const RuleSchema = z
  .object({
    name: z.string().openapi({ example: "ingredientStores/milk" }),
    ingredientId: z.string(),
    ingredientName: z.string().openapi({ example: "milk" }),
    store: z.string().openapi({ example: "braums" }),
    only: z.boolean().openapi({
      description:
        "True when the ingredient is bought at this store and nowhere else. False is a " +
        "preference the planner may override.",
    }),
    createTime: z.string(),
    updateTime: z.string(),
  })
  .openapi("IngredientStore");

const StoreParam = z.object({
  store: z
    .string()
    .min(1)
    .openapi({ param: { name: "store", in: "path" }, example: "aldi" }),
});

const IngredientParam = z.object({
  ingredient: z
    .string()
    .min(1)
    .openapi({ param: { name: "ingredient", in: "path" }, example: "milk" }),
});

const DELETED = {
  description: "Deleted",
  content: { "application/json": { schema: z.object({}) } },
} as const;

export const storesRoutes = new OpenAPIHono<ApiEnv>();

storesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/stores",
    summary: "List the stores the household shops at",
    description:
      "The primary store first. Read `notes` when deciding which store a shopping list item " +
      "goes to — it is how the household describes what each store is for.",
    responses: {
      200: {
        description: "Stores",
        content: { "application/json": { schema: z.object({ stores: z.array(StoreSchema) }) } },
      },
    },
  }),
  async (c) =>
    c.json({ stores: (await listStores(c.get("householdId"))).map(toStoreResource) }, 200),
);

storesRoutes.openapi(
  createRoute({
    method: "post",
    path: "/stores",
    summary: "Add a store",
    description: "Making it `primary` takes that from whichever store had it.",
    request: {
      // Client-assigned id (AIP-133), as for recipes.
      query: z.object({
        storeId: z
          .string()
          .min(1)
          .regex(/^[a-z0-9][a-z0-9-]*$/),
      }),
      body: { content: { "application/json": { schema: StoreInputSchema } } },
    },
    responses: {
      200: { description: "The store", content: { "application/json": { schema: StoreSchema } } },
      409: { description: "A store with that id already exists" },
    },
  }),
  async (c) => {
    const { storeId } = c.req.valid("query");
    const { storeName, notes, primary } = c.req.valid("json");

    try {
      const store = await createStore(c.get("householdId"), storeId, {
        name: storeName,
        notes,
        primary,
      });

      return c.json(toStoreResource(store), 200);
    } catch (error) {
      if (error instanceof StoreExistsError) {
        return apiError(c, "ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  },
);

storesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/stores/{store}",
    summary: "Get a store",
    request: { params: StoreParam },
    responses: {
      200: { description: "The store", content: { "application/json": { schema: StoreSchema } } },
      404: { description: "No such store" },
    },
  }),
  async (c) => {
    const { store } = c.req.valid("param");

    try {
      return c.json(toStoreResource(await getStore(c.get("householdId"), store)), 200);
    } catch (error) {
      if (error instanceof StoreNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

storesRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/stores/{store}",
    summary: "Rename a store, change its notes, or make it primary",
    description: "The id stays what the store was created as, so its ingredients stay with it.",
    request: {
      params: StoreParam,
      query: z.object({
        updateMask: z.string().min(1).openapi({ example: "notes,primary" }),
      }),
      body: { content: { "application/json": { schema: StoreInputSchema.partial() } } },
    },
    responses: {
      200: { description: "The store", content: { "application/json": { schema: StoreSchema } } },
      400: { description: "The update mask names no fields, or an unknown one" },
      404: { description: "No such store" },
    },
  }),
  async (c) => {
    const { store } = c.req.valid("param");
    const { updateMask } = c.req.valid("query");
    const { storeName, notes, primary } = c.req.valid("json");
    const allowed = new Map([
      ["storeName", "name"],
      ["notes", "notes"],
      ["primary", "primary"],
    ]);
    const fields = updateMask
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const unknown = fields.filter((field) => !allowed.has(field));

    if (fields.length === 0) {
      return apiError(c, "INVALID_ARGUMENT", "updateMask names no fields");
    }

    if (unknown.length > 0) {
      return apiError(
        c,
        "INVALID_ARGUMENT",
        `Unknown field(s) in updateMask: ${unknown.join(", ")}`,
      );
    }

    if (fields.includes("storeName") && storeName === undefined) {
      return apiError(c, "INVALID_ARGUMENT", "updateMask names storeName but the body has none");
    }

    try {
      const updated = await updateStore(
        c.get("householdId"),
        store,
        { name: storeName, notes, primary },
        fields.map((field) => allowed.get(field) ?? field),
      );

      return c.json(toStoreResource(updated), 200);
    } catch (error) {
      if (error instanceof StoreNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

storesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/stores/{store}",
    summary: "Forget a store",
    description:
      "Its ingredient rules go with it. Shopping list items bound for it are routed again at " +
      "once, to a usual-store rule or else the primary store.",
    request: { params: StoreParam },
    responses: { 200: DELETED, 404: { description: "No such store" } },
  }),
  async (c) => {
    const { store } = c.req.valid("param");

    try {
      await deleteStore(c.get("householdId"), store);

      return c.json({}, 200);
    } catch (error) {
      if (error instanceof StoreNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

storesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/ingredientStores",
    summary: "List which ingredients the household buys at which store",
    description:
      "A rule with `only` is enforced: the shopping list sends an item of exactly that name to " +
      "that store whatever the caller asks. Without `only` it is the store the item goes to when " +
      "the caller names none. Matching a differently worded item (`whole milk` to `milk`) is " +
      "the caller's judgment — name the store on the item.",
    responses: {
      200: {
        description: "Rules",
        content: {
          "application/json": { schema: z.object({ ingredientStores: z.array(RuleSchema) }) },
        },
      },
    },
  }),
  async (c) =>
    c.json(
      { ingredientStores: (await listIngredientStores(c.get("householdId"))).map(toRuleResource) },
      200,
    ),
);

storesRoutes.openapi(
  createRoute({
    method: "put",
    path: "/ingredientStores",
    summary: "Set which store an ingredient comes from",
    description:
      "PUT rather than POST, as for prices: an ingredient has one store, so setting it again " +
      "moves it.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              ingredientName: z.string().trim().min(1),
              store: z.string().min(1),
              only: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "The rule", content: { "application/json": { schema: RuleSchema } } },
      404: { description: "No such store" },
    },
  }),
  async (c) => {
    const { ingredientName, store, only } = c.req.valid("json");

    try {
      const rule = await setIngredientStore(c.get("householdId"), {
        name: ingredientName,
        storeId: store,
        only,
      });

      return c.json(toRuleResource(rule), 200);
    } catch (error) {
      if (error instanceof StoreNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

storesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/ingredientStores/{ingredient}",
    summary: "Stop sending an ingredient to a particular store",
    request: { params: IngredientParam },
    responses: { 200: DELETED, 404: { description: "No rule for that ingredient" } },
  }),
  async (c) => {
    const { ingredient } = c.req.valid("param");

    try {
      await deleteIngredientStore(c.get("householdId"), ingredient);

      return c.json({}, 200);
    } catch (error) {
      if (error instanceof IngredientStoreNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

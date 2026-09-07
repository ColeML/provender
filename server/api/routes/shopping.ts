import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import { CategorySchema } from "@server/api/schemas";
import { PlanNotFoundError } from "@server/services/plans";
import {
  addItem,
  deleteItem,
  estimatedTotal,
  getItem,
  listItems,
  ManualItemOnlyError,
  replaceItems,
  ShoppingItemNotFoundError,
  updateItem,
  type ShoppingItem,
} from "@server/services/shopping";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(planId: string, item: ShoppingItem) {
  return {
    name: `plans/${planId}/shoppingList/items/${item.id}`,
    itemId: item.id,
    itemName: item.name,
    quantity: item.quantity === null ? null : Number(item.quantity),
    unit: item.unit,
    category: item.category,
    feedsRecipes: item.feedsRecipes,
    estCost: item.estCost === null ? null : Number(item.estCost),
    purchased: item.purchased,
    haveAlready: item.haveAlready,
    source: item.source,
  };
}

const ItemSchema = z
  .object({
    name: z.string().openapi({ example: "plans/2026-W36/shoppingList/items/chicken-breast_lb" }),
    itemId: z.string(),
    itemName: z.string(),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    category: CategorySchema,
    feedsRecipes: z.array(z.string()),
    estCost: z.number().nullable(),
    purchased: z.boolean(),
    haveAlready: z.boolean(),
    source: z.enum(["plan", "manual"]),
  })
  .openapi("ShoppingListItem");

const ItemInputSchema = z
  .object({
    itemName: z.string().min(1),
    quantity: z.number().nullish(),
    unit: z.string().nullish(),
    category: CategorySchema,
    feedsRecipes: z.array(z.string()).optional(),
    estCost: z.number().nonnegative().nullish(),
    haveAlready: z.boolean().optional(),
  })
  .openapi("ShoppingListItemInput");

const ListSchema = z
  .object({
    name: z.string().openapi({ example: "plans/2026-W36/shoppingList" }),
    items: z.array(ItemSchema),
    /** What is left to buy — items already in the pantry are excluded. */
    estimatedTotal: z.number(),
  })
  .openapi("ShoppingList");

function toInput(input: z.infer<typeof ItemInputSchema>) {
  return {
    name: input.itemName,
    quantity: input.quantity,
    unit: input.unit,
    category: input.category,
    feedsRecipes: input.feedsRecipes,
    estCost: input.estCost,
    haveAlready: input.haveAlready,
  };
}

const PlanParam = z.object({
  plan: z
    .string()
    .min(1)
    .openapi({ param: { name: "plan", in: "path" }, example: "2026-W36" }),
});

const ItemParam = PlanParam.extend({
  item: z
    .string()
    .min(1)
    .openapi({ param: { name: "item", in: "path" }, example: "chicken-breast_lb" }),
});

function shoppingError(c: Parameters<typeof apiError>[0], error: unknown) {
  if (error instanceof PlanNotFoundError || error instanceof ShoppingItemNotFoundError) {
    return apiError(c, "NOT_FOUND", error.message);
  }

  if (error instanceof ManualItemOnlyError) {
    return apiError(c, "FAILED_PRECONDITION", error.message);
  }

  throw error;
}

const ERRORS = { 404: { description: "No such plan or item" } } as const;

export const shoppingRoutes = new OpenAPIHono<ApiEnv>();

shoppingRoutes.openapi(
  createRoute({
    method: "get",
    path: "/plans/{plan}/shoppingList",
    summary: "Get the week's shopping list, aisle by aisle",
    request: { params: PlanParam },
    responses: {
      200: { description: "The list", content: { "application/json": { schema: ListSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");
    const items = await listItems(c.get("householdId"), plan);

    return c.json(
      {
        name: `plans/${plan}/shoppingList`,
        items: items.map((item) => toResource(plan, item)),
        estimatedTotal: estimatedTotal(items),
      },
      200,
    );
  },
);

shoppingRoutes.openapi(
  createRoute({
    method: "put",
    path: "/plans/{plan}/shoppingList",
    summary: "Rebuild the list from the week's recipes",
    description:
      "Replaces the items the plan calls for. Two things survive: a shopper's `purchased` and " +
      "`haveAlready` on anything still needed, and every item added by hand — a rebuild is about " +
      "which recipes are scheduled and has no opinion on what you added yourself.",
    request: {
      params: PlanParam,
      body: {
        content: {
          "application/json": { schema: z.object({ items: z.array(ItemInputSchema) }) },
        },
      },
    },
    responses: {
      200: { description: "The list", content: { "application/json": { schema: ListSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");
    const { items } = c.req.valid("json");

    try {
      const written = await replaceItems(c.get("householdId"), plan, items.map(toInput));

      return c.json(
        {
          name: `plans/${plan}/shoppingList`,
          items: written.map((item) => toResource(plan, item)),
          estimatedTotal: estimatedTotal(written),
        },
        200,
      );
    } catch (error) {
      return shoppingError(c, error);
    }
  },
);

shoppingRoutes.openapi(
  createRoute({
    method: "post",
    path: "/plans/{plan}/shoppingList/items",
    summary: "Add something no recipe calls for",
    description:
      "The item is marked `manual` and survives every rebuild. Adding one that is already on the " +
      "list adjusts it rather than failing.",
    request: {
      params: PlanParam,
      body: { content: { "application/json": { schema: ItemInputSchema } } },
    },
    responses: {
      200: { description: "The item", content: { "application/json": { schema: ItemSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");

    try {
      const item = await addItem(c.get("householdId"), plan, toInput(c.req.valid("json")));

      return c.json(toResource(plan, item), 200);
    } catch (error) {
      return shoppingError(c, error);
    }
  },
);

shoppingRoutes.openapi(
  createRoute({
    method: "get",
    path: "/plans/{plan}/shoppingList/items/{item}",
    summary: "Get one item",
    request: { params: ItemParam },
    responses: {
      200: { description: "The item", content: { "application/json": { schema: ItemSchema } } },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, item } = c.req.valid("param");

    try {
      return c.json(toResource(plan, await getItem(c.get("householdId"), plan, item)), 200);
    } catch (error) {
      return shoppingError(c, error);
    }
  },
);

shoppingRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/plans/{plan}/shoppingList/items/{item}",
    summary: "Tick an item off, or mark it as already owned",
    description:
      "The most frequent write in the app, made from a phone in a shop. It updates one row by id " +
      "without reading first, so a client can fire it optimistically.",
    request: {
      params: ItemParam,
      query: z.object({
        updateMask: z.string().min(1).openapi({ example: "purchased" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              purchased: z.boolean().optional(),
              haveAlready: z.boolean().optional(),
              quantity: z.number().nullish(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "The item", content: { "application/json": { schema: ItemSchema } } },
      400: { description: "The update mask names no fields, or an unknown one" },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, item } = c.req.valid("param");
    const { updateMask } = c.req.valid("query");
    const allowed = new Set(["purchased", "haveAlready", "quantity"]);
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

    try {
      const updated = await updateItem(
        c.get("householdId"),
        plan,
        item,
        c.req.valid("json"),
        fields,
      );

      return c.json(toResource(plan, updated), 200);
    } catch (error) {
      return shoppingError(c, error);
    }
  },
);

shoppingRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/plans/{plan}/shoppingList/items/{item}",
    summary: "Remove an item you added yourself",
    description:
      "Only `manual` items can be deleted. A plan item would come back on the next rebuild, so " +
      "deleting one would look like it silently failed — set `haveAlready` instead.",
    request: { params: ItemParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      400: { description: "The item comes from the plan" },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan, item } = c.req.valid("param");

    try {
      await deleteItem(c.get("householdId"), plan, item);

      return c.json({}, 200);
    } catch (error) {
      return shoppingError(c, error);
    }
  },
);

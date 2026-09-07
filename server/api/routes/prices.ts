import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  deletePrice,
  listPrices,
  PriceNotFoundError,
  setPrice,
  type Price,
} from "@server/services/prices";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(price: Price) {
  return {
    ingredient: price.ingredient,
    unit: price.unit,
    store: price.store,
    price: Number(price.price),
    updateTime: price.updateTime.toISOString(),
  };
}

const PriceSchema = z
  .object({
    ingredient: z.string().openapi({ example: "chicken breast" }),
    unit: z.string().openapi({ example: "lb" }),
    store: z.string().openapi({ example: "Sam's Club" }),
    price: z.number().openapi({ example: 2.5 }),
    updateTime: z.string(),
  })
  .openapi("Price");

const Selector = z.object({
  ingredient: z.string().min(1),
  unit: z.string().min(1),
  store: z.string().min(1),
});

export const pricesRoutes = new OpenAPIHono<ApiEnv>();

pricesRoutes.openapi(
  createRoute({
    method: "get",
    path: "/prices",
    summary: "List prices the household has paid",
    description:
      "The most accurate input to a budget estimate, because it comes from the shops actually " +
      "used. Prefer these over any lookup or guess.",
    responses: {
      200: {
        description: "Prices",
        content: { "application/json": { schema: z.object({ prices: z.array(PriceSchema) }) } },
      },
    },
  }),
  async (c) => c.json({ prices: (await listPrices(c.get("householdId"))).map(toResource) }, 200),
);

pricesRoutes.openapi(
  createRoute({
    method: "put",
    path: "/prices",
    summary: "Record what something cost",
    description:
      "PUT rather than POST: a price is identified by its ingredient, unit and store, so recording " +
      "one again is a correction rather than a second data point.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: Selector.extend({ price: z.number().nonnegative() }),
          },
        },
      },
    },
    responses: {
      200: { description: "The price", content: { "application/json": { schema: PriceSchema } } },
    },
  }),
  async (c) => c.json(toResource(await setPrice(c.get("householdId"), c.req.valid("json"))), 200),
);

pricesRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/prices",
    summary: "Forget a price",
    request: { query: Selector },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({}) } } },
      404: { description: "No such price" },
    },
  }),
  async (c) => {
    const { ingredient, unit, store } = c.req.valid("query");

    try {
      await deletePrice(c.get("householdId"), ingredient, unit, store);

      return c.json({}, 200);
    } catch (error) {
      if (error instanceof PriceNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      throw error;
    }
  },
);

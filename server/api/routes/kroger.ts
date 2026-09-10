import { apiError } from "@server/api/errors";
import type { Context } from "hono";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  findLocations,
  KrogerNotConfiguredError,
  KrogerUnavailableError,
  NoStoreConfiguredError,
  searchPrices,
} from "@server/services/kroger";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const LocationSchema = z
  .object({
    locationId: z.string().openapi({ example: "01400943" }),
    name: z.string().openapi({ example: "Dillons" }),
    chain: z.string().openapi({ example: "DILLONS" }),
    address: z.string().openapi({ example: "3rd & Woodlawn, Wichita, KS" }),
  })
  .openapi("KrogerLocation");

const PriceCandidateSchema = z
  .object({
    description: z.string().openapi({ example: "Kroger Ground Beef 80/20" }),
    brand: z.string().nullable().openapi({ example: "Kroger" }),
    size: z.string().nullable().openapi({ example: "16 oz" }),
    regular: z.number().nullable().openapi({ example: 5.49 }),
    promo: z.number().nullable().openapi({ example: 4.99 }),
  })
  .openapi("KrogerPriceCandidate");

/**
 * Kroger lookups, opt-in.
 *
 * Without credentials in the environment every route here answers FAILED_PRECONDITION saying so,
 * rather than failing as an obscure upstream error.
 */
export const krogerRoutes = new OpenAPIHono<ApiEnv>();

/**
 * FAILED_PRECONDITION for anything the deployment has to fix, UNAVAILABLE for anything a retry
 * might. Missing credentials are neither a bad request nor a transient fault, and reporting them
 * as either sends the caller looking in the wrong place.
 */
function krogerError(c: Context, error: unknown) {
  if (error instanceof KrogerNotConfiguredError || error instanceof NoStoreConfiguredError) {
    return apiError(c, "FAILED_PRECONDITION", error.message);
  }

  if (error instanceof KrogerUnavailableError) {
    return apiError(c, "UNAVAILABLE", error.message);
  }

  throw error;
}

krogerRoutes.openapi(
  createRoute({
    method: "get",
    path: "/kroger/locations",
    summary: "Find Kroger-family stores near a zip",
    description:
      "How a household picks the store its prices come from. Save the chosen `locationId` as the " +
      "`kroger_location_id` setting and price lookups will default to it.",
    request: {
      query: z.object({
        zipCode: z.string().min(1).openapi({ example: "67206" }),
        chain: z.string().min(1).optional().openapi({ example: "DILLONS" }),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    responses: {
      200: {
        description: "Nearby stores",
        content: {
          "application/json": { schema: z.object({ locations: z.array(LocationSchema) }) },
        },
      },
      400: { description: "Kroger credentials are not configured" },
      503: { description: "Kroger is unreachable" },
    },
  }),
  async (c) => {
    const { zipCode, chain, limit } = c.req.valid("query");

    try {
      const locations = await findLocations(c.get("householdId"), { zipCode, chain, limit });

      return c.json({ locations }, 200);
    } catch (error) {
      return krogerError(c, error);
    }
  },
);

krogerRoutes.openapi(
  createRoute({
    method: "get",
    path: "/kroger/prices",
    summary: "Look up real store prices for an item",
    description:
      "Every match is returned, not a single best guess: a search for chicken breast comes back " +
      "with deli slices priced per pound alongside the raw cutlets, and only the caller can tell " +
      "which one the recipe meant. These are one tier of a budget estimate \u2014 prefer the " +
      "household's learned prices over them.",
    request: {
      query: z.object({
        term: z.string().min(1).openapi({ example: "ground beef" }),
        locationId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      }),
    },
    responses: {
      200: {
        description: "Price candidates at the store",
        content: {
          "application/json": {
            schema: z.object({
              term: z.string(),
              locationId: z.string(),
              candidates: z.array(PriceCandidateSchema),
            }),
          },
        },
      },
      400: { description: "Kroger is not configured, or no store has been chosen" },
      503: { description: "Kroger is unreachable" },
    },
  }),
  async (c) => {
    const { term, locationId, limit } = c.req.valid("query");

    try {
      return c.json(await searchPrices(c.get("householdId"), { term, locationId, limit }), 200);
    } catch (error) {
      return krogerError(c, error);
    }
  },
);

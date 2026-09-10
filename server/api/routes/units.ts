import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import { convert, IncompatibleUnitsError, UnknownUnitError } from "@server/lib/units";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

/**
 * Unit conversion.
 *
 * The one deliberate deviation from resource-oriented design in this API: there is no unit
 * resource, only arithmetic. Modelling one to satisfy AIP would be ceremony around a function.
 */
export const unitsRoutes = new OpenAPIHono<ApiEnv>();

unitsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/units:convert",
    summary: "Convert a quantity between kitchen units",
    description:
      "Volume and mass, US customary \u2014 a cup is 236.588 ml, not the 240 ml legal cup. Volume " +
      "and mass cannot be interconverted, because that needs a density this does not know.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              quantity: z.number(),
              from: z.string().min(1).openapi({ example: "cup" }),
              to: z.string().min(1).openapi({ example: "tbsp" }),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "The converted amount",
        content: {
          "application/json": {
            schema: z.object({ quantity: z.number(), unit: z.string() }),
          },
        },
      },
      400: { description: "An unknown unit, or volume against mass" },
    },
  }),
  async (c) => {
    const { quantity, from, to } = c.req.valid("json");

    try {
      return c.json({ quantity: convert(quantity, from, to), unit: to.trim().toLowerCase() }, 200);
    } catch (error) {
      if (error instanceof UnknownUnitError || error instanceof IncompatibleUnitsError) {
        return apiError(c, "INVALID_ARGUMENT", error.message);
      }

      throw error;
    }
  },
);

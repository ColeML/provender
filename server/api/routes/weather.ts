import { apiError } from "@server/api/errors";
import type { ApiEnv } from "@server/api/middleware/bearer";
import {
  getForecast,
  LocationNotFoundError,
  NoLocationConfiguredError,
  WeatherUnavailableError,
} from "@server/services/weather";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const DayForecastSchema = z
  .object({
    date: z.string().openapi({ example: "2026-09-07" }),
    high: z.number().nullable().openapi({ example: 101.4 }),
    low: z.number().nullable().openapi({ example: 75.3 }),
    precipChance: z.number().nullable().openapi({ example: 20 }),
    conditions: z.string().openapi({ example: "partly cloudy" }),
  })
  .openapi("DayForecast");

const ForecastSchema = z
  .object({
    name: z.string().openapi({ example: "weather" }),
    location: z.string().openapi({ example: "Edmond, Oklahoma, US" }),
    days: z.array(DayForecastSchema),
  })
  .openapi("Forecast");

export const weatherRoutes = new OpenAPIHono<ApiEnv>();

weatherRoutes.openapi(
  createRoute({
    method: "get",
    path: "/weather",
    summary: "The forecast for the household's location",
    description:
      "Free and keyless, from Open-Meteo. Used to bias a menu — cold and wet toward soups and " +
      "braises, hot toward the grill and no oven \u2014 so conditions come back as plain language " +
      "rather than a WMO code.",
    request: {
      query: z.object({
        location: z.string().min(1).optional(),
        days: z.coerce.number().int().min(1).max(16).optional(),
        celsius: z.stringbool().optional(),
      }),
    },
    responses: {
      200: {
        description: "The forecast",
        content: { "application/json": { schema: ForecastSchema } },
      },
      400: { description: "No location given and none configured" },
      404: { description: "The location could not be found" },
      503: { description: "Open-Meteo is unreachable" },
    },
  }),
  async (c) => {
    const { location, days, celsius } = c.req.valid("query");

    try {
      const forecast = await getForecast(c.get("householdId"), {
        location,
        days,
        fahrenheit: !celsius,
      });

      return c.json({ name: "weather", ...forecast }, 200);
    } catch (error) {
      if (error instanceof NoLocationConfiguredError) {
        return apiError(c, "INVALID_ARGUMENT", error.message);
      }

      if (error instanceof LocationNotFoundError) {
        return apiError(c, "NOT_FOUND", error.message);
      }

      if (error instanceof WeatherUnavailableError) {
        // UNAVAILABLE, not INTERNAL: the request was fine and retrying may well work.
        return apiError(c, "UNAVAILABLE", error.message);
      }

      throw error;
    }
  },
);

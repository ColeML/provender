import { getConfig } from "@server/services/config";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { apiError, validationError } from "./errors";

const ConfigSchema = z
  .record(z.string(), z.string())
  .openapi("Config", { example: { people: "4", default_budget: "120" } });

const getConfigRoute = createRoute({
  method: "get",
  path: "/config",
  summary: "Get household settings",
  responses: {
    200: {
      description: "The household settings, as a flat key/value object",
      content: { "application/json": { schema: ConfigSchema } },
    },
  },
});

/**
 * The REST API.
 *
 * Mounted at `/v1` by the catch-all route handler rather than laid out as directories, because
 * AIP-136 custom methods carry a colon (`/v1/recipes:scrape`) and a Next route segment named
 * `recipes:scrape` is not something to rely on. Routing here also means zod is the single source
 * of truth for validation, types, and the generated OpenAPI document the skills read.
 *
 * Handlers delegate to `server/services/*` and decide nothing themselves.
 */
export const api = new OpenAPIHono({
  // Without this, a failed request validation returns Hono's own error shape and the API has two
  // error formats depending on where the failure happened.
  defaultHook: (result, c) => {
    if (!result.success) {
      return validationError(c, result.error);
    }
  },
}).basePath("/v1");

api.openapi(getConfigRoute, async (c) => c.json(await getConfig(), 200));

api.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { version: "1.0.0", title: "Provender" },
});

// Hono's default 404 is plain text, which would make an unknown path the one response that does
// not follow AIP-193.
api.notFound((c) => apiError(c, "NOT_FOUND", `Unknown path: ${new URL(c.req.url).pathname}`));

api.onError((error, c) => {
  console.error(error);

  return apiError(c, "INTERNAL", "Something went wrong");
});

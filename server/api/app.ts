import { requireBearerToken, type ApiEnv } from "@server/api/middleware/bearer";
import { historyRoutes } from "@server/api/routes/history";
import { plansRoutes } from "@server/api/routes/plans";
import { pricesRoutes } from "@server/api/routes/prices";
import { shoppingRoutes } from "@server/api/routes/shopping";
import { recipesRoutes } from "@server/api/routes/recipes";
import { getConfig, setConfigValue } from "@server/services/config";
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
export const api = new OpenAPIHono<ApiEnv>({
  // Without this, a failed request validation returns Hono's own error shape and the API has two
  // error formats depending on where the failure happened.
  defaultHook: (result, c) => {
    if (!result.success) {
      return validationError(c, result.error);
    }
  },
}).basePath("/v1");

// The document stays public so an agent can discover the surface before it has a token, and
// because it describes the API rather than exposing any of its data. Registered before the
// bearer middleware so the middleware does not cover it.
api.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { version: "1.0.0", title: "Provender" },
});

api.use("/*", requireBearerToken);

api.openapi(getConfigRoute, async (c) => c.json(await getConfig(c.get("householdId")), 200));

/**
 * Settings are written a key at a time, and the whole object is never replaced.
 *
 * The set of keys is open — v1 grew `no_repeat_days`, `pantry_staples` and `render_dir` over time
 * — so a replace would mean any caller with a stale copy silently dropping keys it had never
 * heard of.
 */
api.openapi(
  createRoute({
    method: "patch",
    path: "/config",
    summary: "Set household settings, a key at a time",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z
              .object({ values: z.record(z.string().min(1), z.string()) })
              .openapi("ConfigPatch", { example: { values: { people: "4" } } }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "The settings after the change",
        content: { "application/json": { schema: ConfigSchema } },
      },
    },
  }),
  async (c) => {
    const householdId = c.get("householdId");
    const { values } = c.req.valid("json");

    for (const [key, value] of Object.entries(values)) {
      await setConfigValue(householdId, key, value);
    }

    return c.json(await getConfig(householdId), 200);
  },
);

// Mounted after the bearer middleware, like every other route — see the test that walks the
// generated document and asserts each one is gated.
api.route("/", recipesRoutes);
api.route("/", plansRoutes);
api.route("/", historyRoutes);
api.route("/", shoppingRoutes);
api.route("/", pricesRoutes);

// Hono's default 404 is plain text, which would make an unknown path the one response that does
// not follow AIP-193.
api.notFound((c) => apiError(c, "NOT_FOUND", `Unknown path: ${new URL(c.req.url).pathname}`));

api.onError((error, c) => {
  console.error(error);

  return apiError(c, "INTERNAL", "Something went wrong");
});

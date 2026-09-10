import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

let testDb: Database;

vi.mock("@server/db", async () => {
  const actual = await vi.importActual<typeof import("@server/db")>("@server/db");

  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

const { db } = await import("@server/db");
const { api } = await import("./app");
const { appRouter } = await import("@server/trpc/routers");
const { createCallerFactory } = await import("@server/trpc/init");
const { setConfigValue } = await import("@server/services/config");

/** The token vitest.config.mts puts in the environment. */
const authed = { headers: { Authorization: "Bearer test-token" } };

const householdId = "loewer";

/**
 * A signed-in context, as `createContext` builds one after `auth()` resolves.
 *
 * No `user.id`: `authorize()` returns one, but Auth.js's default session callback copies only
 * name/email/image off the token, so a real session never carries it.
 */
const session = { user: { name: "Household" }, expires: "2099-01-01" };

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
  await setConfigValue(householdId, "people", "4", testDb);
  await setConfigValue(householdId, "default_budget", "120", testDb);
});

describe("GET /v1/config", () => {
  it("returns the settings as a flat object", async () => {
    const response = await api.request("/v1/config", authed);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ people: "4", default_budget: "120" });
  });
});

describe("the two transports", () => {
  /**
   * The drift guard. REST and tRPC exist side by side because each suits a different caller, and
   * that is only safe while neither of them decides anything — both delegate to the same service.
   */
  it("return the same thing for the same resource", async () => {
    const caller = createCallerFactory(appRouter)({ db, session, householdId });

    const [restResponse, viaTrpc] = await Promise.all([
      api.request("/v1/config", authed),
      caller.config.get(),
    ]);
    const viaRest = await restResponse.json();

    expect(viaRest).toEqual(viaTrpc);
  });

  it("both refuse an unauthenticated caller", async () => {
    const caller = createCallerFactory(appRouter)({ db, session: null, householdId: null });

    const response = await api.request("/v1/config");

    expect(response.status).toBe(401);
    await expect(caller.config.get()).rejects.toThrow("Not signed in");
  });
});

describe("unknown paths", () => {
  it("use the AIP-193 error shape rather than Hono's plain-text 404", async () => {
    const response = await api.request("/v1/nope", authed);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 404, message: "Unknown path: /v1/nope", status: "NOT_FOUND" },
    });
  });

  it("answer 401 before 404 when unauthenticated, so the surface cannot be mapped", async () => {
    const response = await api.request("/v1/nope");

    expect(response.status).toBe(401);
  });
});

describe("every documented route", () => {
  /**
   * The structural guard. Bearer enforcement depends on registration order — `api.use()` only
   * covers routes registered after it — so a future `api.openapi(...)` added above that line
   * would ship unauthenticated and every existing test would still pass. This walks the generated
   * document instead of naming paths, so it covers routes that do not exist yet.
   */
  it("requires a token, except the document itself", async () => {
    const document = (await (await api.request("/v1/openapi.json")).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };

    const routes = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => ({ path, method })),
    );

    expect(routes.length).toBeGreaterThan(0);

    for (const { path, method } of routes) {
      const response = await api.request(path, { method: method.toUpperCase() });

      expect(response.status, `${method.toUpperCase()} ${path} is not gated`).toBe(401);
    }
  });
});

describe("a custom method on a resource", () => {
  /**
   * The guard on the router choice.
   *
   * AIP-136 puts a custom method on the resource, and only PatternRouter of Hono's four can route
   * a colon straight after a path parameter — the others read `:recipe:scale` as one parameter
   * named `recipe:scale`, so the real one never binds. Swapping the router back would break this
   * and nothing else, silently.
   */
  it("binds the path parameter that precedes the colon", async () => {
    const response = await api.request("/v1/recipes/no-such-recipe:scale", {
      method: "POST",
      headers: { ...authed.headers, "content-type": "application/json" },
      body: JSON.stringify({ targetServings: 8 }),
    });

    // 404 with the id in the message proves the parameter bound and the lookup ran. A 400 would
    // mean it never arrived, which is what every other router produces.
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "NOT_FOUND", message: expect.stringContaining("no-such-recipe") },
    });
  });

  it("is advertised at its resource path", async () => {
    const document = (await (await api.request("/v1/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };

    expect(document.paths).toHaveProperty("/v1/recipes/{recipe}:scale");
  });
});

describe("the OpenAPI document", () => {
  it("is served without a token, so an agent can discover the surface first", async () => {
    const response = await api.request("/v1/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths).toHaveProperty("/v1/config");
  });
});

describe("a body that is not JSON", () => {
  it("is the caller's error, not the server's", async () => {
    const response = await api.request("/v1/units:convert", {
      method: "POST",
      headers: { ...authed.headers, "content-type": "application/json" },
      body: '{"quantity":24,"from":"tbsp","to":',
    });

    // 500 would tell the agent the server is broken and the request is worth retrying. It isn't.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });
});

describe("a content-type the endpoint does not accept", () => {
  it("is the caller's error too", async () => {
    const response = await api.request("/v1/units:convert", {
      method: "POST",
      headers: { ...authed.headers, "content-type": "text/plain" },
      body: "24 tbsp in cups",
    });

    // Hono's media-type gate raises a 415, which has no AIP-193 code of its own.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });
});

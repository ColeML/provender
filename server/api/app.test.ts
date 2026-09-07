import { describe, expect, it, vi } from "vitest";

const rows = [
  { key: "people", value: "4", updatedAt: new Date("2026-01-01") },
  { key: "default_budget", value: "120", updatedAt: new Date("2026-01-01") },
];

vi.mock("@server/db", async () => {
  const actual = await vi.importActual<typeof import("@server/db")>("@server/db");

  return { ...actual, db: { select: () => ({ from: async () => rows }) } };
});

const { db } = await import("@server/db");
const { api } = await import("./app");
const { appRouter } = await import("@server/trpc/routers");
const { createCallerFactory } = await import("@server/trpc/init");

/** The token vitest.config.mts puts in the environment. */
const authed = { headers: { Authorization: "Bearer test-token" } };

/**
 * A signed-in context, as `createContext` builds one after `auth()` resolves.
 *
 * No `user.id`: `authorize()` returns one, but Auth.js's default session callback copies only
 * name/email/image off the token, so a real session never carries it. Nothing reads it today —
 * adding it to this fixture would assert a guarantee the code does not make.
 */
const session = { user: { name: "Household" }, expires: "2099-01-01" };

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
   * This asserts they still agree; extend it as each resource lands.
   */
  it("return the same thing for the same resource", async () => {
    const caller = createCallerFactory(appRouter)({ db, session });

    const [restResponse, viaTrpc] = await Promise.all([
      api.request("/v1/config", authed),
      caller.config.get(),
    ]);
    const viaRest = await restResponse.json();

    expect(viaRest).toEqual(viaTrpc);
  });

  it("both refuse an unauthenticated caller", async () => {
    const caller = createCallerFactory(appRouter)({ db, session: null });

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

describe("the OpenAPI document", () => {
  it("is served without a token, so an agent can discover the surface first", async () => {
    const response = await api.request("/v1/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths).toHaveProperty("/v1/config");
  });
});

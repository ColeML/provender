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

/** A signed-in context, as `createContext` would build one after `auth()` resolved. */
const session = { user: { id: "household", name: "Household" }, expires: "2099-01-01" };

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

describe("the OpenAPI document", () => {
  it("is served without a token, so an agent can discover the surface first", async () => {
    const response = await api.request("/v1/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths).toHaveProperty("/v1/config");
  });
});

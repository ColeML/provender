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

describe("GET /v1/config", () => {
  it("returns the settings as a flat object", async () => {
    const response = await api.request("/v1/config");

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
    const caller = createCallerFactory(appRouter)({ db });

    const [restResponse, viaTrpc] = await Promise.all([
      api.request("/v1/config"),
      caller.config.get(),
    ]);
    const viaRest = await restResponse.json();

    expect(viaRest).toEqual(viaTrpc);
  });
});

describe("unknown paths", () => {
  it("use the AIP-193 error shape rather than Hono's plain-text 404", async () => {
    const response = await api.request("/v1/nope");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 404,
        message: "Unknown path: /v1/nope",
        status: "NOT_FOUND",
      },
    });
  });
});

describe("the OpenAPI document", () => {
  it("is served and describes the config route", async () => {
    const response = await api.request("/v1/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths).toHaveProperty("/v1/config");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { api } = await import("@server/api/app");
const { clearTokenCache } = await import("@server/services/kroger");
const { setConfigValue } = await import("@server/services/config");

const authed = { headers: { Authorization: "Bearer test-token" } };

const TOKEN = { access_token: "tok", expires_in: 1800 };

const PRODUCTS = {
  data: [
    {
      description: "Boneless Skinless Chicken Breast",
      brand: "Simple Truth",
      items: [{ size: "per lb", price: { regular: 5.49 } }],
    },
  ],
};

function mockFetch(...responses: unknown[]) {
  const fetchMock = vi.fn();

  for (const body of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
  }

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
  clearTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearTokenCache();
});

describe("GET /v1/kroger/prices", () => {
  it("returns the whole candidate list rather than one best match", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    mockFetch(TOKEN, PRODUCTS);

    const response = await api.request(
      "/v1/kroger/prices?term=chicken+breast&locationId=01400943",
      authed,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      term: "chicken breast",
      locationId: "01400943",
      candidates: [
        {
          description: "Boneless Skinless Chicken Breast",
          brand: "Simple Truth",
          size: "per lb",
          regular: 5.49,
          promo: null,
        },
      ],
    });
  });

  /** The opt-in contract: an unconfigured deployment says so, rather than failing obscurely. */
  it("answers FAILED_PRECONDITION when no credentials are set", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "");
    vi.stubEnv("KROGER_CLIENT_SECRET", "");

    const response = await api.request("/v1/kroger/prices?term=ground+beef", authed);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "FAILED_PRECONDITION", message: expect.stringContaining("not configured") },
    });
  });

  it("answers FAILED_PRECONDITION when configured but no store has been chosen", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");

    const response = await api.request("/v1/kroger/prices?term=ground+beef", authed);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        status: "FAILED_PRECONDITION",
        message: expect.stringContaining("kroger_location_id"),
      },
    });
  });

  it("uses the store saved in the household's settings", async () => {
    await setConfigValue("loewer", "kroger_location_id", "01400943", testDb);
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    mockFetch(TOKEN, PRODUCTS);

    const response = await api.request("/v1/kroger/prices?term=ground+beef", authed);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ locationId: "01400943" });
  });
});

describe("GET /v1/kroger/locations", () => {
  it("answers UNAVAILABLE when Kroger is down, so the caller retries", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );

    const response = await api.request("/v1/kroger/locations?zipCode=67206", authed);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { status: "UNAVAILABLE" } });
  });

  it("answers INVALID_ARGUMENT when Kroger rejects the request itself", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const response = await api.request("/v1/kroger/locations?zipCode=00000", authed);

    // 503 would tell the agent to retry a request that will fail the same way every time.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });

  it("requires a zip", async () => {
    const response = await api.request("/v1/kroger/locations", authed);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });
});

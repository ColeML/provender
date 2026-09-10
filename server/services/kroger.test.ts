import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { setConfigValue } from "@server/services/config";

import {
  clearTokenCache,
  findLocations,
  KrogerNotConfiguredError,
  KrogerRejectedRequestError,
  KrogerUnavailableError,
  NoStoreConfiguredError,
  parseProducts,
  searchPrices,
} from "./kroger";

const H = "loewer";

let db: Database;
let close: () => Promise<void>;

const TOKEN = { access_token: "tok", expires_in: 1800 };

const LOCATIONS = {
  data: [
    {
      locationId: "01400943",
      name: "Dillons",
      chain: "DILLONS",
      address: { addressLine1: "3rd & Woodlawn", city: "Wichita", state: "KS" },
    },
  ],
};

/** As Kroger really answers "chicken breast": deli slices first, the raw cutlets second. */
const PRODUCTS = {
  data: [
    {
      description: "Kroger Oven Roasted Chicken Breast, Sliced",
      brand: "Kroger",
      items: [{ size: "9 oz", price: { regular: 3.99, promo: 0 } }],
    },
    {
      description: "Boneless Skinless Chicken Breast",
      brand: "Simple Truth",
      items: [{ size: "per lb", price: { regular: 5.49, promo: 4.99 } }],
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

function withCredentials() {
  vi.stubEnv("KROGER_CLIENT_ID", "client");
  vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  clearTokenCache();
  withCredentials();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearTokenCache();
  await close();
});

describe("without credentials", () => {
  beforeEach(() => {
    vi.stubEnv("KROGER_CLIENT_ID", "");
    vi.stubEnv("KROGER_CLIENT_SECRET", "");
  });

  it("refuses a location lookup with a message naming the variables to set", async () => {
    const fetchMock = mockFetch();

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toThrow(
      /KROGER_CLIENT_ID and KROGER_CLIENT_SECRET/,
    );
    // Inert, not merely erroring: nothing is sent to Kroger at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a price lookup", async () => {
    await setConfigValue(H, "kroger_location_id", "01400943", db);
    mockFetch();

    await expect(searchPrices(H, { term: "ground beef" }, db)).rejects.toBeInstanceOf(
      KrogerNotConfiguredError,
    );
  });
});

describe("findLocations", () => {
  it("returns the stores near a zip, with the address joined for display", async () => {
    mockFetch(TOKEN, LOCATIONS);

    await expect(findLocations(H, { zipCode: "67206" })).resolves.toEqual([
      {
        locationId: "01400943",
        name: "Dillons",
        chain: "DILLONS",
        address: "3rd & Woodlawn, Wichita, KS",
      },
    ]);
  });

  it("filters to a chain only when one is asked for", async () => {
    const withChain = mockFetch(TOKEN, LOCATIONS);

    await findLocations(H, { zipCode: "67206", chain: "DILLONS" });
    expect(String(withChain.mock.calls[1][0])).toContain("filter.chain=DILLONS");

    vi.unstubAllGlobals();
    clearTokenCache();
    const without = mockFetch(TOKEN, LOCATIONS);

    await findLocations(H, { zipCode: "67206" });
    expect(String(without.mock.calls[1][0])).not.toContain("filter.chain");
  });

  it("asks the locations endpoint, near the zip, for the number of stores requested", async () => {
    const fetchMock = mockFetch(TOKEN, LOCATIONS);

    await findLocations(H, { zipCode: "67206", limit: 3 });

    const url = new URL(String(fetchMock.mock.calls[1][0]));

    expect(url.pathname).toBe("/v1/locations");
    expect(url.searchParams.get("filter.zipCode.near")).toBe("67206");
    expect(url.searchParams.get("filter.limit")).toBe("3");
  });
});

describe("searchPrices", () => {
  it("returns every candidate, so the caller can tell cutlets from deli slices", async () => {
    mockFetch(TOKEN, PRODUCTS);

    const lookup = await searchPrices(H, { term: "chicken breast", locationId: "01400943" }, db);

    expect(lookup.candidates).toEqual([
      {
        description: "Kroger Oven Roasted Chicken Breast, Sliced",
        brand: "Kroger",
        size: "9 oz",
        regular: 3.99,
        promo: null,
      },
      {
        description: "Boneless Skinless Chicken Breast",
        brand: "Simple Truth",
        size: "per lb",
        regular: 5.49,
        promo: 4.99,
      },
    ]);
  });

  it("falls back to the household's configured store", async () => {
    await setConfigValue(H, "kroger_location_id", "01400943", db);
    const fetchMock = mockFetch(TOKEN, PRODUCTS);

    const lookup = await searchPrices(H, { term: "ground beef" }, db);

    expect(lookup.locationId).toBe("01400943");
    expect(String(fetchMock.mock.calls[1][0])).toContain("filter.locationId=01400943");
  });

  it("prefers an explicit store over the configured one", async () => {
    await setConfigValue(H, "kroger_location_id", "01400943", db);
    const fetchMock = mockFetch(TOKEN, PRODUCTS);

    await searchPrices(H, { term: "ground beef", locationId: "09900123" }, db);

    expect(String(fetchMock.mock.calls[1][0])).toContain("filter.locationId=09900123");
  });

  it("asks the products endpoint for the search term, at the store, bearing the token", async () => {
    const fetchMock = mockFetch(TOKEN, PRODUCTS);

    await searchPrices(H, { term: "ground beef", locationId: "01400943", limit: 4 }, db);

    const [url, init] = fetchMock.mock.calls[1];
    const parsed = new URL(String(url));

    expect(parsed.pathname).toBe("/v1/products");
    expect(parsed.searchParams.get("filter.term")).toBe("ground beef");
    expect(parsed.searchParams.get("filter.locationId")).toBe("01400943");
    expect(parsed.searchParams.get("filter.limit")).toBe("4");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("says which setting to fill in when no store has been chosen", async () => {
    mockFetch(TOKEN, PRODUCTS);

    await expect(searchPrices(H, { term: "ground beef" }, db)).rejects.toBeInstanceOf(
      NoStoreConfiguredError,
    );
  });
});

describe("parseProducts", () => {
  it("reads a promo of zero as no promotion rather than free", () => {
    const [candidate] = parseProducts({
      data: [{ description: "Bread", items: [{ price: { regular: 2.49, promo: 0 } }] }],
    });

    expect(candidate.promo).toBeNull();
  });

  it("keeps a product the store does not price, rather than dropping it", () => {
    const [candidate] = parseProducts({ data: [{ description: "Bread", items: [{}] }] });

    expect(candidate).toEqual({
      description: "Bread",
      brand: null,
      size: null,
      regular: null,
      promo: null,
    });
  });

  it("rejects a response whose shape is not what the API documents", () => {
    expect(() => parseProducts({ data: [{ description: 7 }] })).toThrow(KrogerUnavailableError);
  });
});

describe("the access token", () => {
  /** Wrong scope, header or body encoding all surface only as a 401 on the next call. */
  it("is requested with Basic credentials and a form-encoded client-credentials grant", async () => {
    const fetchMock = mockFetch(TOKEN, LOCATIONS);

    await findLocations(H, { zipCode: "67206" });

    const [url, init] = fetchMock.mock.calls[0];

    expect(String(url)).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from("client:secret").toString("base64")}`,
    );
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "client_credentials",
      scope: "product.compact",
    });
  });

  it("is minted once and reused across calls", async () => {
    const fetchMock = mockFetch(TOKEN, LOCATIONS, LOCATIONS);

    await findLocations(H, { zipCode: "67206" });
    await findLocations(H, { zipCode: "67207" });

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2/token"));

    expect(tokenCalls).toHaveLength(1);
  });

  it("is re-minted when the credentials change, not served from the old ones", async () => {
    mockFetch(TOKEN, LOCATIONS);
    await findLocations(H, { zipCode: "67206" });

    vi.unstubAllGlobals();
    vi.stubEnv("KROGER_CLIENT_ID", "other-client");
    const fetchMock = mockFetch({ access_token: "other-tok", expires_in: 1800 }, LOCATIONS);

    await findLocations(H, { zipCode: "67206" });

    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer other-tok");
  });

  /** A shopping list prices many ingredients at once, all on a cold module. */
  it("is minted once for lookups that start together, not once each", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockImplementation((url: string) =>
      String(url).includes("oauth2/token")
        ? new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, status: 200, json: async () => TOKEN }), 10),
          )
        : Promise.resolve({ ok: true, status: 200, json: async () => LOCATIONS }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      findLocations(H, { zipCode: "67206" }),
      findLocations(H, { zipCode: "67207" }),
      findLocations(H, { zipCode: "67208" }),
    ]);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2/token"));

    expect(tokenCalls).toHaveLength(1);
  });

  it("reports rejected credentials as a configuration problem, not a transient one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerNotConfiguredError,
    );
  });

  /** Kroger revokes and rotates a token before its stated expiry, so a refused one is stale. */
  it("is re-minted and the call retried when Kroger refuses it mid-life", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "fresh", expires_in: 1800 }),
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => LOCATIONS });
    vi.stubGlobal("fetch", fetchMock);

    await expect(findLocations(H, { zipCode: "67206" })).resolves.toHaveLength(1);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2/token"));

    expect(tokenCalls).toHaveLength(2);
    expect(fetchMock.mock.calls[3][1].headers.authorization).toBe("Bearer fresh");
  });

  it("retries once, not in a loop, and calls a second refusal an outage", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockImplementation((url: string) =>
      String(url).includes("oauth2/token")
        ? Promise.resolve({ ok: true, status: 200, json: async () => TOKEN })
        : Promise.resolve({ ok: false, status: 401, json: async () => ({}) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerUnavailableError,
    );

    const dataCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/locations"));

    expect(dataCalls).toHaveLength(2);
  });
});

describe("when Kroger rejects the request", () => {
  /** A mistyped `kroger_location_id` gets a 400 from Kroger, and no retry will fix it. */
  it("is the caller's error, not a Kroger outage", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchPrices(H, { term: "ground beef", locationId: "nope" }, db),
    ).rejects.toBeInstanceOf(KrogerRejectedRequestError);
  });

  it("treats a spent quota as retryable, since it resets", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerUnavailableError,
    );
  });
});

describe("when Kroger is down", () => {
  it("is reported as unreachable, so the caller retries rather than changes the request", async () => {
    mockFetch(TOKEN);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerUnavailableError,
    );
  });

  it("reports a refused connection the same way", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    vi.stubGlobal("fetch", fetchMock);

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerUnavailableError,
    );
  });
});

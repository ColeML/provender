import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { setConfigValue } from "@server/services/config";

import {
  clearTokenCache,
  findLocations,
  isConfigured,
  KrogerNotConfiguredError,
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

  it("reports the feature as not configured", () => {
    expect(isConfigured()).toBe(false);
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

  it("reports rejected credentials as a configuration problem, not a transient one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerNotConfiguredError,
    );
  });

  it("is dropped when Kroger refuses it, so the next call mints a fresh one", async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => TOKEN });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => LOCATIONS });
    vi.stubGlobal("fetch", fetchMock);

    await expect(findLocations(H, { zipCode: "67206" })).rejects.toBeInstanceOf(
      KrogerNotConfiguredError,
    );
    await expect(findLocations(H, { zipCode: "67206" })).resolves.toHaveLength(1);

    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("oauth2/token"));

    expect(tokenCalls).toHaveLength(2);
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

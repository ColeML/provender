import "server-only";

import type { Database } from "@server/db";
import { db as defaultDb } from "@server/db";
import { z } from "zod";

import { getConfig } from "./config";

/**
 * Real store prices from Kroger, as a budgeting source between learned prices and an estimate.
 *
 * Opt-in: without `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` the feature is inert and every
 * call fails with a message saying so, exactly as v1 behaved without its credentials file.
 *
 * Unlike v1 this returns the candidate list only. v1 also picked a `best` with a store-brand
 * heuristic, and it mis-picks often enough to mislead — a search for "chicken breast" comes back
 * with deli slices priced per pound, and the heuristic ranks them first because they are cheap
 * and store-brand. Choosing among candidates is judgment, which belongs to the agent.
 */

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const API_URL = "https://api.kroger.com/v1";

const TIMEOUT_MS = 15_000;

/** The store the household shops, chosen with a location lookup and saved as a setting. */
export const LOCATION_SETTING = "kroger_location_id";

export interface KrogerLocation {
  locationId: string;
  name: string;
  chain: string;
  /** Street, city and state joined for display; the API returns them as separate fields. */
  address: string;
}

export interface PriceCandidate {
  description: string;
  brand: string | null;
  size: string | null;
  regular: number | null;
  promo: number | null;
}

/**
 * Kroger is not usable as configured.
 *
 * Covers both no credentials at all and credentials Kroger rejects: in each case the caller has
 * to change the deployment's configuration, and retrying the same request will never help.
 */
export class KrogerNotConfiguredError extends Error {}

/** Kroger is unreachable or erroring. The caller should retry rather than change the request. */
export class KrogerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Kroger is unreachable: ${cause instanceof Error ? cause.message : cause}`);
  }
}

/** Credentials are present but no store has been picked, so a price has nowhere to come from. */
export class NoStoreConfiguredError extends Error {
  constructor() {
    super(
      `No store given, and the household has no \`${LOCATION_SETTING}\` setting. ` +
        "Look up locations by zip and save one first.",
    );
  }
}

interface Credentials {
  clientId: string;
  clientSecret: string;
}

function credentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const clientId = env.KROGER_CLIENT_ID;
  const clientSecret = env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

/** Whether Kroger lookups are available at all — the opt-in switch. */
export function isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return credentials(env) !== null;
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
});

/**
 * The token, cached in memory for as long as it is valid.
 *
 * v1 cached to a file because a CLI is a fresh process per command. Here the process is reused,
 * and a serverless filesystem is neither writable nor shared, so the cache lives in the module.
 * It is keyed by client id so a redeployment with different credentials cannot serve a token
 * minted for the old ones.
 */
let cachedToken: { clientId: string; accessToken: string; expiresAt: number } | null = null;

/** Refresh this long before expiry, so a token cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 30_000;

/** Test seam: the cache is module state, and a test that mints a token would leak into the next. */
export function clearTokenCache() {
  cachedToken = null;
}

async function accessToken(creds: Credentials): Promise<string> {
  const now = Date.now();

  if (
    cachedToken &&
    cachedToken.clientId === creds.clientId &&
    cachedToken.expiresAt > now + EXPIRY_MARGIN_MS
  ) {
    return cachedToken.accessToken;
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  let response: Response;

  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "product.compact" }),
    });
  } catch (error) {
    throw new KrogerUnavailableError(error);
  }

  // A rejected credential is the deployment's to fix, not something a retry resolves.
  if (response.status === 401 || response.status === 403) {
    throw new KrogerNotConfiguredError(
      `Kroger rejected the configured credentials (HTTP ${response.status}). ` +
        "Check KROGER_CLIENT_ID and KROGER_CLIENT_SECRET.",
    );
  }

  if (!response.ok) {
    throw new KrogerUnavailableError(`HTTP ${response.status}`);
  }

  const parsed = TokenResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new KrogerUnavailableError("the token endpoint returned an unexpected shape");
  }

  cachedToken = {
    clientId: creds.clientId,
    accessToken: parsed.data.access_token,
    expiresAt: now + (parsed.data.expires_in ?? 1800) * 1000,
  };

  return parsed.data.access_token;
}

function requireCredentials(): Credentials {
  const creds = credentials();

  if (!creds) {
    throw new KrogerNotConfiguredError(
      "Kroger price lookups are not configured. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET " +
        "to enable them.",
    );
  }

  return creds;
}

async function get(path: string, params: Record<string, string>) {
  const token = await accessToken(requireCredentials());
  const query = new URLSearchParams(params);

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
  } catch (error) {
    throw new KrogerUnavailableError(error);
  }

  if (response.status === 401 || response.status === 403) {
    // The cached token is the likely culprit — Kroger can revoke one before it expires — so drop
    // it rather than serving the same rejected token for another half hour.
    clearTokenCache();

    throw new KrogerNotConfiguredError(
      `Kroger refused the request (HTTP ${response.status}). Check the credentials and that the ` +
        "app has the Products and Locations APIs enabled.",
    );
  }

  if (!response.ok) {
    throw new KrogerUnavailableError(`HTTP ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

/**
 * A third party's response is parsed, not cast.
 *
 * Fields are optional because Kroger omits them freely — a product with no price at the chosen
 * store has no `price` object at all — and a renamed field should surface here rather than as
 * the string "undefined" further down.
 */
const LocationsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        locationId: z.string().optional(),
        name: z.string().optional(),
        chain: z.string().optional(),
        address: z
          .object({
            addressLine1: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const ProductsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        description: z.string().optional(),
        brand: z.string().optional(),
        items: z
          .array(
            z.object({
              size: z.string().optional(),
              price: z
                .object({ regular: z.number().optional(), promo: z.number().optional() })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export function parseLocations(payload: unknown): KrogerLocation[] {
  const parsed = LocationsResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new KrogerUnavailableError("the locations endpoint returned an unexpected shape");
  }

  return (parsed.data.data ?? []).map((store) => ({
    locationId: store.locationId ?? "",
    name: store.name ?? "",
    chain: store.chain ?? "",
    address: [store.address?.addressLine1, store.address?.city, store.address?.state]
      .filter(Boolean)
      .join(", "),
  }));
}

export function parseProducts(payload: unknown): PriceCandidate[] {
  const parsed = ProductsResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new KrogerUnavailableError("the products endpoint returned an unexpected shape");
  }

  return (parsed.data.data ?? []).map((product) => {
    const item = product.items?.[0];

    return {
      description: product.description ?? "",
      brand: product.brand ?? null,
      size: item?.size ?? null,
      regular: item?.price?.regular ?? null,
      // A promo of 0 means "no promotion" in Kroger's data, not "free".
      promo: item?.price?.promo ? item.price.promo : null,
    };
  });
}

export interface LocationSearch {
  zipCode: string;
  /** A banner such as `DILLONS`, when the household shops one in particular. */
  chain?: string;
  limit?: number;
}

/**
 * Kroger-family stores near a zip.
 *
 * Takes `householdId` like every service function here even though a store search reads nothing
 * household-scoped, so that no function in this directory can be called without one.
 */
export async function findLocations(
  householdId: string,
  search: LocationSearch,
): Promise<KrogerLocation[]> {
  const params: Record<string, string> = {
    "filter.zipCode.near": search.zipCode,
    "filter.limit": String(Math.min(Math.max(search.limit ?? 5, 1), 200)),
  };

  if (search.chain) {
    params["filter.chain"] = search.chain;
  }

  return parseLocations(await get("/locations", params));
}

export interface PriceSearch {
  term: string;
  /** Defaults to the household's `kroger_location_id` setting. */
  locationId?: string;
  limit?: number;
}

export interface PriceLookup {
  term: string;
  /** Which store the prices are from, resolved from the setting when it was not given. */
  locationId: string;
  /** Every match, in the order Kroger returned them. Picking one is the caller's job. */
  candidates: PriceCandidate[];
}

export async function searchPrices(
  householdId: string,
  search: PriceSearch,
  db: Database = defaultDb,
): Promise<PriceLookup> {
  // Checked before the store, so an unconfigured deployment hears why the feature is inert
  // rather than being sent to pick a store that would not help.
  requireCredentials();

  const locationId =
    search.locationId?.trim() || (await getConfig(householdId, db))[LOCATION_SETTING];

  if (!locationId) {
    throw new NoStoreConfiguredError();
  }

  const candidates = parseProducts(
    await get("/products", {
      "filter.term": search.term,
      "filter.locationId": locationId,
      "filter.limit": String(Math.min(Math.max(search.limit ?? 10, 1), 50)),
    }),
  );

  return { term: search.term, locationId, candidates };
}

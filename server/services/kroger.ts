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
const LOCATION_SETTING = "kroger_location_id";

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

/**
 * Kroger refused the request itself — an unknown store id, a search term below its minimum length.
 *
 * Separate from `KrogerUnavailableError` because retrying changes nothing: a mistyped
 * `kroger_location_id` would otherwise be reported as Kroger being down, which sends the
 * household to check someone else's uptime instead of their own setting.
 */
export class KrogerRejectedRequestError extends Error {}

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

function credentials(): Credentials | null {
  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
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

/**
 * The mint in progress, so concurrent lookups share one.
 *
 * A shopping list prices a dozen ingredients at once, and on a cold module each of those would
 * otherwise miss the cache and post to the token endpoint, which Kroger rate-limits.
 */
let pendingToken: { clientId: string; token: Promise<string> } | null = null;

/** Refresh this long before expiry, so a token cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 30_000;

/** Test seam: the cache is module state, and a test that mints a token would leak into the next. */
export function clearTokenCache() {
  cachedToken = null;
  pendingToken = null;
}

function accessToken(creds: Credentials): Promise<string> {
  if (
    cachedToken &&
    cachedToken.clientId === creds.clientId &&
    cachedToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS
  ) {
    return Promise.resolve(cachedToken.accessToken);
  }

  if (pendingToken?.clientId === creds.clientId) {
    return pendingToken.token;
  }

  const token = mintToken(creds).finally(() => {
    if (pendingToken?.clientId === creds.clientId) {
      pendingToken = null;
    }
  });

  pendingToken = { clientId: creds.clientId, token };

  return token;
}

async function mintToken(creds: Credentials): Promise<string> {
  const now = Date.now();

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

function refusedTheToken(status: number) {
  return status === 401 || status === 403;
}

async function send(url: string, token: string): Promise<Response> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
  } catch (error) {
    throw new KrogerUnavailableError(error);
  }
}

async function get(path: string, params: Record<string, string>) {
  const creds = requireCredentials();
  const url = `${API_URL}${path}?${new URLSearchParams(params)}`;

  const token = await accessToken(creds);

  let response = await send(url, token);

  if (refusedTheToken(response.status)) {
    // Kroger revokes and rotates a token before its stated expiry, so a refused one is far more
    // likely stale than wrong — the credentials behind it were already vetted at mint time. Drop
    // only the token this request used, since a concurrent call may have minted a good one, and
    // leave `pendingToken` alone or a mint in flight is orphaned and posts again.
    if (cachedToken?.accessToken === token) {
      cachedToken = null;
    }

    response = await send(url, await accessToken(creds));

    // One retry, never a loop. A freshly minted token refused as well is Kroger misbehaving, not
    // the deployment: bad credentials fail at the token endpoint instead.
    if (refusedTheToken(response.status)) {
      throw new KrogerUnavailableError(
        `Kroger refused a freshly minted token (HTTP ${response.status})`,
      );
    }
  }

  // 429 is the daily quota, which resets, so it stays a retry-later. Any other 4xx is this
  // request's own fault and will fail identically however many times it is sent.
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new KrogerRejectedRequestError(
      `Kroger rejected the request (HTTP ${response.status}). Check the store id and search term.`,
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

function parseLocations(payload: unknown): KrogerLocation[] {
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
    "filter.limit": String(search.limit ?? 5),
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
      "filter.limit": String(search.limit ?? 10),
    }),
  );

  return { term: search.term, locationId, candidates };
}

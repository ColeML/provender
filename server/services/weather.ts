import "server-only";

import type { Database } from "@server/db";
import { db as defaultDb } from "@server/db";
import { US_STATES, WMO_CONDITIONS } from "@server/lib/weather-codes";

import { getConfig } from "./config";

/**
 * The forecast, from Open-Meteo.
 *
 * Free and keyless, which is why it was chosen in v1 and why nothing here needs a secret. The
 * planner uses it to bias the menu — cold and wet toward soups and braises, hot toward the grill
 * and no oven — so the shape it returns is what a menu decision needs, not what the API sends.
 */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const TIMEOUT_MS = 15_000;

export interface DayForecast {
  date: string;
  high: number | null;
  low: number | null;
  precipChance: number | null;
  /** Plain language, from the WMO code — `"63"` tells a planner nothing. */
  conditions: string;
}

export interface Forecast {
  /** What the geocoder actually resolved to, so a wrong match is visible rather than silent. */
  location: string;
  days: DayForecast[];
}

export class LocationNotFoundError extends Error {
  constructor(readonly location: string) {
    super(`Could not find a place called ${location}`);
  }
}

/** Open-Meteo is unreachable or erroring. The caller should retry rather than change the request. */
export class WeatherUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The weather service is unreachable: ${cause instanceof Error ? cause.message : cause}`);
  }
}

export class NoLocationConfiguredError extends Error {
  constructor() {
    super("No location given, and the household has no `location` setting");
  }
}

async function fetchJson(url: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);

  let response: Response;

  try {
    response = await fetch(`${url}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (error) {
    // A refused connection, a DNS failure or the timeout above. All of them mean "try later",
    // which is a different answer from "your request was wrong".
    throw new WeatherUnavailableError(error);
  }

  if (!response.ok) {
    throw new WeatherUnavailableError(`HTTP ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

interface GeocodeResult {
  name?: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
}

/**
 * Whether a candidate matches a trailing hint like `OK` or `United Kingdom`.
 *
 * The geocoder returns `admin1` spelled out, so an abbreviation has to be expanded before it can
 * be compared — without this, "Edmond, OK" picks whichever Edmond the geocoder ranked first.
 */
function matchesHint(result: GeocodeResult, hint: string) {
  const candidates = [result.admin1, result.country, result.country_code]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  const wanted = [hint.toLowerCase(), (US_STATES[hint.toUpperCase()] ?? "").toLowerCase()].filter(
    Boolean,
  );

  return candidates.some((candidate) => wanted.some((want) => candidate.includes(want)));
}

export async function geocode(location: string) {
  // `"Edmond, OK"` is searched as `Edmond`, and `OK` picks from the candidates: the geocoder
  // matches on city name only and returns nothing for the full string.
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const city = parts[0] ?? location;
  const hints = parts.slice(1);

  const body = await fetchJson(GEOCODE_URL, { name: city, count: "10", format: "json" });
  const results = (body.results ?? []) as GeocodeResult[];

  if (results.length === 0) {
    throw new LocationNotFoundError(location);
  }

  let best = results[0];

  for (const hint of hints) {
    const match = results.find((result) => matchesHint(result, hint));

    if (match) {
      best = match;
      break;
    }
  }

  return {
    latitude: best.latitude,
    longitude: best.longitude,
    name: [best.name, best.admin1, best.country_code].filter(Boolean).join(", "),
  };
}

export interface ForecastOptions {
  /** Defaults to the household's `location` setting. */
  location?: string;
  /** 1–16. Seven covers a week's planning, which is what this is for. */
  days?: number;
  fahrenheit?: boolean;
}

export async function getForecast(
  householdId: string,
  options: ForecastOptions = {},
  db: Database = defaultDb,
): Promise<Forecast> {
  const location = options.location?.trim() || (await getConfig(householdId, db)).location;

  if (!location) {
    throw new NoLocationConfiguredError();
  }

  const days = Math.min(Math.max(options.days ?? 7, 1), 16);
  const place = await geocode(location);

  const body = await fetchJson(FORECAST_URL, {
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    temperature_unit: options.fahrenheit === false ? "celsius" : "fahrenheit",
    timezone: "auto",
    forecast_days: String(days),
  });

  const daily = (body.daily ?? {}) as Record<string, (number | null)[] | string[]>;
  const dates = (daily.time ?? []) as string[];

  return {
    location: place.name,
    days: dates.map((date, index) => {
      const code = (daily.weather_code as (number | null)[] | undefined)?.[index];

      return {
        date,
        high: (daily.temperature_2m_max as (number | null)[] | undefined)?.[index] ?? null,
        low: (daily.temperature_2m_min as (number | null)[] | undefined)?.[index] ?? null,
        precipChance:
          (daily.precipitation_probability_max as (number | null)[] | undefined)?.[index] ?? null,
        // An unmapped code is reported as unknown rather than dropped: the planner can still see
        // the temperature, and a missing day would look like a shorter forecast.
        conditions:
          code === null || code === undefined ? "unknown" : (WMO_CONDITIONS[code] ?? "unknown"),
      };
    }),
  };
}

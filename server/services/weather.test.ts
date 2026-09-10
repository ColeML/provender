import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";

import {
  geocode,
  getForecast,
  LocationNotFoundError,
  NoLocationConfiguredError,
  WeatherUnavailableError,
} from "./weather";

const H = "loewer";

let db: Database;
let close: () => Promise<void>;

/** Two Edmonds, as the geocoder really returns them: Oklahoma is not the first. */
const EDMONDS = {
  results: [
    { name: "Edmond", admin1: "Alberta", country_code: "CA", latitude: 53.5, longitude: -113.5 },
    { name: "Edmond", admin1: "Oklahoma", country_code: "US", latitude: 35.65, longitude: -97.48 },
  ],
};

const FORECAST = {
  daily: {
    time: ["2026-09-07", "2026-09-08"],
    temperature_2m_max: [101.4, 88],
    temperature_2m_min: [75.3, 70],
    precipitation_probability_max: [1, 40],
    weather_code: [0, 63],
  },
};

function mockFetch(...responses: unknown[]) {
  const fetchMock = vi.fn();

  for (const body of responses) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body });
  }

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await setConfigValue(H, "location", "Edmond, OK", db);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

describe("geocode", () => {
  it("uses the state hint to pick the right city, not the first result", async () => {
    mockFetch(EDMONDS);

    await expect(geocode("Edmond, OK")).resolves.toMatchObject({
      latitude: 35.65,
      name: "Edmond, Oklahoma, US",
    });
  });

  it("searches the city alone, since the geocoder does not match the full string", async () => {
    const fetchMock = mockFetch(EDMONDS);

    await geocode("Edmond, OK");

    expect(String(fetchMock.mock.calls[0][0])).toContain("name=Edmond");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("OK");
  });

  it("takes the first result when there is no hint to go on", async () => {
    mockFetch(EDMONDS);

    await expect(geocode("Edmond")).resolves.toMatchObject({ latitude: 53.5 });
  });

  it("reports a place that does not exist", async () => {
    mockFetch({ results: [] });

    await expect(geocode("Nowhereville")).rejects.toBeInstanceOf(LocationNotFoundError);
  });
});

describe("getForecast", () => {
  it("returns a day per date, with conditions in plain language", async () => {
    mockFetch(EDMONDS, FORECAST);

    const forecast = await getForecast(H, {}, db);

    expect(forecast.location).toBe("Edmond, Oklahoma, US");
    expect(forecast.days).toEqual([
      { date: "2026-09-07", high: 101.4, low: 75.3, precipChance: 1, conditions: "clear" },
      { date: "2026-09-08", high: 88, low: 70, precipChance: 40, conditions: "rain" },
    ]);
  });

  it("falls back to the household's configured location", async () => {
    const fetchMock = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, {}, db);

    expect(String(fetchMock.mock.calls[0][0])).toContain("name=Edmond");
  });

  it("prefers an explicit location over the configured one", async () => {
    const fetchMock = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, { location: "Tulsa, OK" }, db);

    expect(String(fetchMock.mock.calls[0][0])).toContain("name=Tulsa");
  });

  it("asks for the number of days requested", async () => {
    const fetchMock = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, { days: 3 }, db);

    expect(String(fetchMock.mock.calls[1][0])).toContain("forecast_days=3");
  });

  it.each([
    [0, "forecast_days=1"],
    [99, "forecast_days=16"],
  ])("clamps a request for %i days", async (days, expected) => {
    const fetchMock = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, { days }, db);

    expect(String(fetchMock.mock.calls[1][0])).toContain(expected);
  });

  it("asks for Fahrenheit by default and Celsius on request", async () => {
    const first = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, {}, db);
    expect(String(first.mock.calls[1][0])).toContain("temperature_unit=fahrenheit");

    vi.unstubAllGlobals();
    const second = mockFetch(EDMONDS, FORECAST);

    await getForecast(H, { fahrenheit: false }, db);
    expect(String(second.mock.calls[1][0])).toContain("temperature_unit=celsius");
  });

  it("reports an unmapped weather code as unknown rather than dropping the day", async () => {
    mockFetch(EDMONDS, {
      daily: {
        time: ["2026-09-07"],
        temperature_2m_max: [80],
        temperature_2m_min: [60],
        precipitation_probability_max: [0],
        weather_code: [7777],
      },
    });

    const forecast = await getForecast(H, {}, db);

    expect(forecast.days).toHaveLength(1);
    expect(forecast.days[0].conditions).toBe("unknown");
    expect(forecast.days[0].high).toBe(80);
  });

  it("survives a day with missing measurements", async () => {
    mockFetch(EDMONDS, {
      daily: { time: ["2026-09-07"], weather_code: [0] },
    });

    await expect(getForecast(H, {}, db)).resolves.toMatchObject({
      days: [
        { date: "2026-09-07", high: null, low: null, precipChance: null, conditions: "clear" },
      ],
    });
  });

  it("says the service is unavailable when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(getForecast(H, {}, db)).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it("says the service is unavailable on an upstream error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));

    await expect(getForecast(H, {}, db)).rejects.toBeInstanceOf(WeatherUnavailableError);
  });

  it("reports having no location rather than guessing one", async () => {
    const { db: empty, close: closeEmpty } = await createTestDb();

    await expect(getForecast(H, {}, empty)).rejects.toBeInstanceOf(NoLocationConfiguredError);

    await closeEmpty();
  });
});

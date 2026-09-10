// @vitest-environment jsdom
import { PlanNotFoundError } from "@server/services/plans";
import type { Forecast, ForecastOptions } from "@server/services/weather";
import type { WeekPlan } from "@server/services/week-plan";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plan = vi.fn<(householdId: string, planId: string) => Promise<WeekPlan>>();
const forecast = vi.fn<(householdId: string, options: ForecastOptions) => Promise<Forecast>>();

// Passed through rather than swallowed: the household filter is the argument whose absence looks
// entirely normal in review, so the mocks have to be able to see it.
vi.mock("@server/services/week-plan", () => ({
  weekPlan: (householdId: string, planId: string) => plan(householdId, planId),
}));
vi.mock("@server/services/weather", () => ({
  getForecast: (householdId: string, options: ForecastOptions) => forecast(householdId, options),
}));
vi.mock("@server/auth/household", () => ({ householdForSession: () => "loewer" }));
vi.mock("../../../../../auth", () => ({ auth: async () => ({ user: { name: "loewer" } }) }));

const { default: Day, generateMetadata } = await import("./page");

function week(date: string): WeekPlan {
  return {
    planId: "2026-W37",
    budgetTarget: null,
    estimatedCost: 0,
    days: [
      {
        date,
        planned: true,
        servings: 8,
        status: "planned",
        notes: null,
        main: { recipeId: "chili", title: "Chili", costEstimate: 12, totalMin: 60 },
        side: null,
        extras: [],
      },
    ],
  };
}

/** What `weekPlan` returns for a date whose only row is a lunch: dinners are all it reports. */
function weekWithoutDinner(date: string): WeekPlan {
  return {
    planId: "2026-W37",
    budgetTarget: null,
    estimatedCost: 0,
    days: [
      {
        date,
        planned: false,
        servings: null,
        status: "unplanned",
        notes: null,
        main: null,
        side: null,
        extras: [],
      },
    ],
  };
}

async function renderDay(date: string) {
  plan.mockResolvedValue(week(date));

  render(await Day({ params: Promise.resolve({ date }) }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  plan.mockReset();
  forecast.mockReset();
  forecast.mockResolvedValue({
    location: "Edmond, Oklahoma, US",
    days: [{ date: "2026-09-10", high: 88, low: 61, precipChance: 20, conditions: "Mainly clear" }],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("the day page", () => {
  it("shows the day's forecast alongside its meal", async () => {
    await renderDay("2026-09-10");

    expect(screen.getByRole("link", { name: /Chili/ })).toHaveAttribute("href", "/recipes/chili");
    expect(screen.getByText("88° / 61° · Mainly clear · 20% rain")).toBeInTheDocument();
  });

  it("asks both services for this household's data", async () => {
    await renderDay("2026-09-10");

    expect(plan).toHaveBeenCalledWith("loewer", "2026-W37");
    expect(forecast).toHaveBeenCalledWith("loewer", { days: 16 });
  });

  it("still asks for tonight's forecast after UTC has rolled over to tomorrow", async () => {
    // 21:00 in Oklahoma on the 9th. Open-Meteo answers in the household's local days, so the 9th
    // is still today to it — and this screen is read at exactly this hour.
    vi.setSystemTime(new Date("2026-09-10T02:00:00Z"));
    forecast.mockResolvedValue({
      location: "Edmond, Oklahoma, US",
      days: [{ date: "2026-09-09", high: 91, low: 66, precipChance: 5, conditions: "Clear sky" }],
    });

    await renderDay("2026-09-09");

    expect(forecast).toHaveBeenCalled();
    expect(screen.getByText("91° / 66° · Clear sky · 5% rain")).toBeInTheDocument();
  });

  it("does not ask for a forecast of a date the forecast cannot cover", async () => {
    await renderDay("2026-09-08");

    expect(forecast).not.toHaveBeenCalled();
    expect(screen.getByText("Forecast")).toBeInTheDocument();
  });

  it("does not ask for a forecast beyond the sixteen-day horizon", async () => {
    await renderDay("2026-09-26");

    expect(forecast).not.toHaveBeenCalled();
  });

  it("asks for a forecast on the last day the horizon reaches", async () => {
    await renderDay("2026-09-25");

    expect(forecast).toHaveBeenCalled();
  });

  it("renders the day without a forecast when the weather service fails", async () => {
    forecast.mockRejectedValue(new Error("Open-Meteo is down"));

    await renderDay("2026-09-10");

    expect(screen.getByRole("link", { name: /Chili/ })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("reads a date whose week nobody has planned as an unplanned day", async () => {
    plan.mockRejectedValue(new PlanNotFoundError("2026-W37"));

    render(await Day({ params: Promise.resolve({ date: "2026-09-10" }) }));

    expect(screen.getByText(/Nothing is planned for this day/)).toBeInTheDocument();
  });

  it("reads a date whose only meal is a lunch as an unplanned day", async () => {
    plan.mockResolvedValue(weekWithoutDinner("2026-09-10"));

    render(await Day({ params: Promise.resolve({ date: "2026-09-10" }) }));

    expect(screen.getByText(/Nothing is planned for this day/)).toBeInTheDocument();
  });

  it("answers 404 for a date that is not a real day", async () => {
    await expect(Day({ params: Promise.resolve({ date: "2026-02-30" }) })).rejects.toThrow();
    expect(plan).not.toHaveBeenCalled();
  });

  it("titles each day for the day it is, so two tabs are distinguishable", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ date: "2026-09-10" }) })).toEqual({
      title: "Thursday, Sep 10 — Provender",
    });
  });
});

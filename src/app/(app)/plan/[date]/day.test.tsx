// @vitest-environment jsdom
import type { Forecast } from "@server/services/weather";
import type { WeekPlan } from "@server/services/week-plan";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plan = vi.fn<() => Promise<WeekPlan>>();
const forecast = vi.fn<() => Promise<Forecast>>();

vi.mock("@server/services/week-plan", () => ({ weekPlan: () => plan() }));
vi.mock("@server/services/weather", () => ({ getForecast: () => forecast() }));
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

  it("titles each day for the day it is, so two tabs are distinguishable", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ date: "2026-09-10" }) })).toEqual({
      title: "Thursday, Sep 10 — Provender",
    });
  });
});

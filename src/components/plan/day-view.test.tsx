// @vitest-environment jsdom

import type { WeekPlanDay } from "@server/services/week-plan";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DayView, type DayWeather } from "./day-view";

const recipe = (recipeId: string, title: string, totalMin: number | null = 30) => ({
  recipeId,
  title,
  costEstimate: 10,
  totalMin,
});

function day(overrides: Partial<WeekPlanDay> = {}): WeekPlanDay {
  return {
    date: "2026-09-10",
    planned: true,
    servings: 8,
    status: "planned",
    notes: null,
    main: null,
    side: null,
    extras: [],
    ...overrides,
  };
}

const weather: DayWeather = {
  high: 88,
  low: 61,
  precipChance: 20,
  conditions: "Mainly clear",
};

function renderDay(overrides: Partial<WeekPlanDay> = {}, forecast: DayWeather | null = null) {
  render(<DayView planId="2026-W37" day={day(overrides)} weather={forecast} />);
}

describe("the day view", () => {
  it("names the day and links back to its week", () => {
    renderDay();

    expect(screen.getByRole("heading", { level: 1, name: "Thursday" })).toBeInTheDocument();
    expect(screen.getByText("September 10, 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-W37" })).toHaveAttribute(
      "href",
      "/plan?week=2026-W37",
    );
  });

  it("links the main, the side and every extra into its cook view", () => {
    renderDay({
      main: recipe("chicken-fajitas", "Chicken fajitas"),
      side: recipe("cilantro-rice", "Cilantro rice"),
      extras: [recipe("key-lime-pie", "Key lime pie")],
    });

    const menu = screen.getByRole("list");

    expect(within(menu).getByRole("link", { name: /Chicken fajitas/ })).toHaveAttribute(
      "href",
      "/recipes/chicken-fajitas",
    );
    expect(within(menu).getByRole("link", { name: /Cilantro rice/ })).toHaveAttribute(
      "href",
      "/recipes/cilantro-rice",
    );
    expect(within(menu).getByRole("link", { name: /Key lime pie/ })).toHaveAttribute(
      "href",
      "/recipes/key-lime-pie",
    );
    expect(within(menu).getByText("Main")).toBeInTheDocument();
    expect(within(menu).getByText("Side")).toBeInTheDocument();
    expect(within(menu).getByText("Extra")).toBeInTheDocument();
  });

  it("shows the servings, the status and the notes that explain the day", () => {
    renderDay({
      servings: 27,
      status: "cooked",
      notes: "Potluck at the Harts. 100° out, so nothing goes in the oven.",
      main: recipe("chicken-fajitas", "Chicken fajitas"),
    });

    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("cooked")).toBeInTheDocument();
    expect(
      screen.getByText("Potluck at the Harts. 100° out, so nothing goes in the oven."),
    ).toBeInTheDocument();
  });

  it("shows the forecast, since it is why the menu is what it is", () => {
    renderDay({ main: recipe("grilled-chicken", "Grilled chicken") }, weather);

    expect(screen.getByText("88° / 61° · Mainly clear · 20% rain")).toBeInTheDocument();
  });

  it("falls back to a dash when no forecast reached the page", () => {
    renderDay({ main: recipe("chili", "Chili") }, null);

    expect(screen.getByText("Forecast")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("totals the time across every dish", () => {
    renderDay({
      main: recipe("chicken-fajitas", "Chicken fajitas", 45),
      side: recipe("cilantro-rice", "Cilantro rice", 20),
    });

    expect(screen.getByText("Total time")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
  });

  it("says how many dishes have no time rather than under-reporting the total", () => {
    renderDay({
      main: recipe("chicken-fajitas", "Chicken fajitas", 45),
      side: recipe("cilantro-rice", "Cilantro rice", null),
    });

    expect(screen.getByText("1 of 2 dishes have no time recorded.")).toBeInTheDocument();
  });

  it("reads a day with extras but no main as a potluck", () => {
    renderDay({
      main: null,
      extras: [recipe("baked-beans", "Baked beans"), recipe("key-lime-pie", "Key lime pie")],
    });

    expect(screen.getByRole("heading", { level: 2, name: "Potluck" })).toBeInTheDocument();
    expect(screen.getByText(/the meal is what you are bringing/)).toBeInTheDocument();
    expect(screen.getAllByText("Bringing")).toHaveLength(2);
    expect(screen.queryByText(/no dishes are chosen yet/)).not.toBeInTheDocument();
  });

  it("calls a potluck's side a dish you are bringing, not a side to a main there is none of", () => {
    renderDay({
      main: null,
      side: recipe("baked-beans", "Baked beans"),
      extras: [recipe("key-lime-pie", "Key lime pie")],
    });

    expect(screen.getByRole("heading", { level: 2, name: "Potluck" })).toBeInTheDocument();
    expect(screen.getAllByText("Bringing")).toHaveLength(2);
    expect(screen.queryByText("Side")).not.toBeInTheDocument();
  });

  it("lists a dish brought twice once per role, without colliding keys", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    renderDay({
      main: null,
      side: recipe("baked-beans", "Baked beans"),
      extras: [recipe("baked-beans", "Baked beans")],
    });

    expect(screen.getAllByRole("link", { name: /Baked beans/ })).toHaveLength(2);
    expect(errors).not.toHaveBeenCalled();

    errors.mockRestore();
  });

  it("reads a day whose only dish is a side as a potluck too", () => {
    renderDay({ main: null, side: recipe("baked-beans", "Baked beans") });

    expect(screen.getByRole("heading", { level: 2, name: "Potluck" })).toBeInTheDocument();
    expect(screen.getByText("Bringing")).toBeInTheDocument();
    expect(screen.queryByText("Side")).not.toBeInTheDocument();
  });

  it("says there is no main without claiming the day is tonight", () => {
    renderDay({ main: null, extras: [recipe("baked-beans", "Baked beans")] });

    expect(screen.queryByText(/tonight/)).not.toBeInTheDocument();
    expect(screen.getByText(/the meal is what you are bringing/)).toBeInTheDocument();
  });

  it("says no dish has a time rather than leaving the dash unexplained", () => {
    renderDay({
      main: recipe("chicken-fajitas", "Chicken fajitas", null),
      side: recipe("cilantro-rice", "Cilantro rice", null),
    });

    expect(screen.getByText("2 of 2 dishes have no time recorded.")).toBeInTheDocument();
  });

  it("still shows the forecast on an unplanned day, since it is the input for planning it", () => {
    renderDay({ planned: false, servings: null, status: "unplanned" }, weather);

    expect(screen.getByText("88° / 61° · Mainly clear · 20% rain")).toBeInTheDocument();
  });

  it("distinguishes a planned day with nothing chosen from an unplanned one", () => {
    renderDay({ planned: true });

    expect(screen.getByText(/no dishes are chosen yet/)).toBeInTheDocument();
  });

  it("offers the way out on an unplanned day", () => {
    renderDay({ planned: false, servings: null, status: "unplanned" });

    expect(screen.getByText(/Nothing is planned for this day/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan the week" })).toHaveAttribute(
      "href",
      "/plan?week=2026-W37",
    );
    expect(screen.queryByText("Servings")).not.toBeInTheDocument();
  });
});

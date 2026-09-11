// @vitest-environment jsdom

import type { WeekPlan, WeekPlanDay } from "@server/services/week-plan";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WeekGrid } from "./week-grid";

const setDay = vi.fn();
const clearDay = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    plans: {
      setDay: { mutationOptions: () => ({ mutationFn: setDay }) },
      clearDay: { mutationOptions: () => ({ mutationFn: clearDay }) },
    },
  }),
}));

const recipe = (recipeId: string, title: string, costEstimate = 10) => ({
  recipeId,
  title,
  costEstimate,
  totalMin: 30,
});

function day(date: string, overrides: Partial<WeekPlanDay> = {}): WeekPlanDay {
  return {
    date,
    mealSlot: "dinner",
    planned: false,
    servings: null,
    status: "unplanned",
    notes: null,
    main: null,
    side: null,
    extras: [],
    ...overrides,
  };
}

const DATES = [
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
];

function renderGrid(week: Partial<WeekPlan> = {}) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <WeekGrid
        week={{
          planId: "2026-W36",
          budgetTarget: 120,
          estimatedCost: 0,
          days: DATES.map((date) => day(date)),
          ...week,
        }}
        recipes={[
          { recipeId: "fajitas", title: "Chicken Fajitas" },
          { recipeId: "ziti", title: "Baked Ziti" },
        ]}
        forecast={[{ date: "2026-08-31", high: 91.4, low: 70, conditions: "sunny" }]}
        defaultServings={8}
      />
    </QueryClientProvider>,
  );

  return user;
}

beforeEach(() => {
  setDay.mockReset();
  clearDay.mockReset();
  refresh.mockReset();
});

afterEach(cleanup);

describe("the week grid", () => {
  it("gives every date a column, planned or not", () => {
    renderGrid();

    expect(screen.getAllByRole("combobox", { name: "Main" })).toHaveLength(7);
  });

  it("shows the day's current main as the selected option", () => {
    renderGrid({
      days: [
        day("2026-08-31", {
          planned: true,
          servings: 8,
          main: recipe("fajitas", "Chicken Fajitas"),
          side: recipe("ziti", "Baked Ziti"),
        }),
        ...DATES.slice(1).map((date) => day(date)),
      ],
    });

    expect(screen.getAllByRole("combobox", { name: "Main" })[0]).toHaveValue("fajitas");
    expect(screen.getAllByRole("combobox", { name: "Side" })[0]).toHaveValue("ziti");
  });

  it("links each day to its own day view, from both the summary and the grid", () => {
    renderGrid();

    // One in the mobile summary and one in the desktop grid, since both render at every width.
    const links = screen.getAllByRole("link", { name: /Mon 8\/31/ });

    expect(links).toHaveLength(2);

    for (const link of links) {
      expect(link).toHaveAttribute("href", "/plan/2026-08-31");
    }
  });

  it("shows the forecast against the day it belongs to", () => {
    renderGrid();

    expect(screen.getByText("91° sunny")).toBeInTheDocument();
  });

  it("writes the swap through, keeping the rest of the day", async () => {
    const user = renderGrid({
      days: [
        day("2026-08-31", {
          planned: true,
          servings: 8,
          status: "planned",
          main: recipe("ziti", "Baked Ziti"),
          side: recipe("rice", "Rice"),
          extras: [recipe("cake", "Cake")],
        }),
        ...DATES.slice(1).map((date) => day(date)),
      ],
    });

    await user.selectOptions(screen.getAllByRole("combobox", { name: "Main" })[0], "fajitas");

    // TanStack passes its own context as a second argument, so assert on the payload alone.
    expect(setDay.mock.calls[0][0]).toEqual({
      planId: "2026-W36",
      date: "2026-08-31",
      servings: 8,
      status: "planned",
      notes: null,
      main: "fajitas",
      side: "rice",
      extras: ["cake"],
    });
  });

  it("gives an unplanned day the household's servings when it is first filled in", async () => {
    const user = renderGrid();

    await user.selectOptions(screen.getAllByRole("combobox", { name: "Main" })[0], "fajitas");

    expect(setDay.mock.calls[0][0]).toMatchObject({
      date: "2026-08-31",
      servings: 8,
      status: "planned",
    });
  });

  it("clears a day only where there is one to clear", async () => {
    const user = renderGrid({
      days: [
        day("2026-08-31", { planned: true, servings: 8, status: "planned" }),
        ...DATES.slice(1).map((date) => day(date)),
      ],
    });

    const clears = screen.getAllByRole("button", { name: "Clear" });

    expect(clears).toHaveLength(1);

    await user.click(clears[0]);

    expect(clearDay.mock.calls[0][0]).toEqual({ planId: "2026-W36", date: "2026-08-31" });
  });

  it("holds the new choice while it saves, rather than snapping back", async () => {
    // The mutation never settles, so this is what the planner looks at mid-save.
    setDay.mockImplementation(() => new Promise(() => {}));

    const user = renderGrid({
      days: [
        day("2026-08-31", { planned: true, servings: 8, main: recipe("ziti", "Baked Ziti") }),
        ...DATES.slice(1).map((date) => day(date)),
      ],
    });

    await user.selectOptions(screen.getAllByRole("combobox", { name: "Main" })[0], "fajitas");

    expect(screen.getAllByRole("combobox", { name: "Main" })[0]).toHaveValue("fajitas");
  });

  it("disables only the day being saved", async () => {
    setDay.mockImplementation(() => new Promise(() => {}));

    const user = renderGrid();

    await user.selectOptions(screen.getAllByRole("combobox", { name: "Main" })[0], "fajitas");

    const mains = screen.getAllByRole("combobox", { name: "Main" });

    expect(mains[0]).toBeDisabled();
    expect(mains[1]).toBeEnabled();
  });

  it("flags going over the budget the week was planned with", () => {
    renderGrid({ estimatedCost: 133.5, budgetTarget: 120 });

    expect(screen.getByText("$133.50")).toHaveClass("text-destructive");
  });

  it("does not flag a week that is inside its budget", () => {
    renderGrid({ estimatedCost: 90, budgetTarget: 120 });

    expect(screen.getByText("$90.00")).not.toHaveClass("text-destructive");
  });

  it("links each recipe from the read-only summary", () => {
    renderGrid({
      days: [
        day("2026-08-31", {
          planned: true,
          servings: 8,
          main: recipe("fajitas", "Chicken Fajitas"),
        }),
        ...DATES.slice(1).map((date) => day(date)),
      ],
    });

    const summary = screen.getByRole("list", { name: "Week summary" });

    expect(within(summary).getByRole("link", { name: "Chicken Fajitas" })).toHaveAttribute(
      "href",
      "/recipes/fajitas",
    );
  });
});

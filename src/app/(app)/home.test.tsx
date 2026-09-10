// @vitest-environment jsdom
import type { WeekOverview } from "@server/services/overview";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const overview = vi.fn<() => Promise<WeekOverview>>();

vi.mock("@server/services/overview", () => ({ weekOverview: () => overview() }));
vi.mock("@server/auth/household", () => ({ householdForSession: () => "loewer" }));
vi.mock("../../../auth", () => ({ auth: async () => ({ user: { name: "loewer" } }) }));

const { default: Home } = await import("./page");

type Day = WeekOverview["days"][number];

const day = (o: Partial<Day> & { date: string }): Day => ({
  mealSlot: "dinner",
  status: "planned",
  mainRecipeId: null,
  mainTitle: null,
  ...o,
});

/** A Server Component is an async function returning JSX, so awaiting it gives something to render. */
async function renderHome(week: Partial<WeekOverview>) {
  overview.mockResolvedValue({
    planId: null,
    isCurrentWeek: false,
    days: [],
    outstandingItems: 0,
    ...week,
  });

  render(await Home());
}

beforeEach(() => {
  overview.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the home screen", () => {
  it("treats an unplanned week as normal, and offers the way out", async () => {
    await renderHome({ planId: null });

    expect(screen.getByText(/No week is planned yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan one" })).toHaveAttribute("href", "/plan");
  });

  it("lists each day's main, linked to the recipe", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mainRecipeId: "fajitas", mainTitle: "Chicken Fajitas" }),
        day({ date: "2026-09-08", mainRecipeId: "ziti", mainTitle: "Baked Ziti" }),
      ],
    });

    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chicken Fajitas" })).toHaveAttribute(
      "href",
      "/recipes/fajitas",
    );
    expect(screen.getByRole("link", { name: "Baked Ziti" })).toBeInTheDocument();
  });

  it("counts what is left to buy, and links to the list", async () => {
    await renderHome({ planId: "2026-W37", isCurrentWeek: true, outstandingItems: 12 });

    expect(screen.getByRole("link", { name: "12 items to buy" })).toHaveAttribute("href", "/shop");
  });

  it("does not pluralize a single item", async () => {
    await renderHome({ planId: "2026-W37", isCurrentWeek: true, outstandingItems: 1 });

    expect(screen.getByRole("link", { name: "1 item to buy" })).toBeInTheDocument();
  });

  it("says so when the shopping is done", async () => {
    await renderHome({ planId: "2026-W37", isCurrentWeek: true, outstandingItems: 0 });

    expect(screen.getByText(/nothing left to buy/)).toBeInTheDocument();
  });

  it("says which week it is when the current one is not planned", async () => {
    await renderHome({ planId: "2026-W36", isCurrentWeek: false });

    expect(screen.getByText(/the most recent week planned/)).toBeInTheDocument();
  });

  it("names the status for a day with no main, so a potluck reads as one", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", status: "potluck" })],
    });

    expect(screen.getByText("potluck")).toBeInTheDocument();
  });

  it("falls back to the recipe id when a title is missing", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", mainRecipeId: "mystery", mainTitle: null })],
    });

    expect(screen.getByRole("link", { name: "mystery" })).toBeInTheDocument();
  });
});

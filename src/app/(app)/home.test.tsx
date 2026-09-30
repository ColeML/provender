// @vitest-environment jsdom
import type { WeekOverview } from "@server/services/overview";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const W37 = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
];

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
    dates: W37,
    days: [],
    outstandingItems: 0,
    ...week,
  });

  render(await Home());
}

function dayRow(linkName: string) {
  const row = screen.getByRole("link", { name: linkName }).closest("li");

  if (!row) {
    throw new Error(`"${linkName}" is not inside a row`);
  }

  return row;
}

beforeEach(() => {
  overview.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the home screen", () => {
  it("names every meal by its slot, dinner included", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mealSlot: "breakfast", mainRecipeId: "oats", mainTitle: "Oats" }),
        day({ date: "2026-09-07", mealSlot: "lunch", mainRecipeId: "soup", mainTitle: "Soup" }),
        day({ date: "2026-09-07", mealSlot: "dinner", mainRecipeId: "ziti", mainTitle: "Ziti" }),
      ],
    });

    expect(screen.getByText("breakfast")).toBeInTheDocument();
    expect(screen.getByText("lunch")).toBeInTheDocument();
    expect(screen.getByText("dinner")).toBeInTheDocument();
  });

  it("lists only the meals that are planned, not every slot", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", mainRecipeId: "ziti", mainTitle: "Ziti" })],
    });

    const monday = dayRow("Monday");

    expect(within(monday).getByText("dinner")).toBeInTheDocument();
    expect(within(monday).queryByText("breakfast")).toBeNull();
    expect(within(monday).queryByText("lunch")).toBeNull();
  });

  it("links every meal to its day, not only the dinner", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mealSlot: "lunch", mainRecipeId: "soup", mainTitle: "Soup" }),
      ],
    });

    expect(screen.getByRole("link", { name: "Monday" })).toHaveAttribute(
      "href",
      "/plan/2026-09-07",
    );
  });

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

    expect(within(dayRow("Monday")).getByText("Sep 7")).toBeInTheDocument();
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

  it("shows the week as a date range", async () => {
    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    expect(screen.getByText(/Sep 7 – Sep 13/)).toBeInTheDocument();
  });

  it("writes a week that crosses the year with each end's own month", async () => {
    await renderHome({
      planId: "2026-W53",
      isCurrentWeek: true,
      dates: [
        "2026-12-28",
        "2026-12-29",
        "2026-12-30",
        "2026-12-31",
        "2027-01-01",
        "2027-01-02",
        "2027-01-03",
      ],
    });

    expect(screen.getByText(/Dec 28 – Jan 3/)).toBeInTheDocument();
  });

  it("draws all seven days, and offers to plan the empty ones", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [day({ date: "2026-09-07", mainRecipeId: "ziti", mainTitle: "Ziti" })],
    });

    const empty = screen.getAllByRole("link", { name: "Nothing planned" });

    expect(empty).toHaveLength(6);
    expect(empty[0]).toHaveAttribute("href", "/plan/2026-09-08");
    expect(screen.getByRole("link", { name: "Sunday" })).toBeInTheDocument();
  });

  it("does not call a day with only a lunch unplanned", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mealSlot: "lunch", mainRecipeId: "soup", mainTitle: "Soup" }),
      ],
    });

    const monday = dayRow("Monday");

    expect(within(monday).getByRole("link", { name: "Soup" })).toBeInTheDocument();
    expect(within(monday).queryByText("Nothing planned")).toBeNull();
  });

  it("puts a date's meals in one row", async () => {
    await renderHome({
      planId: "2026-W37",
      isCurrentWeek: true,
      days: [
        day({ date: "2026-09-07", mealSlot: "breakfast", mainRecipeId: "oats", mainTitle: "Oats" }),
        day({ date: "2026-09-07", mealSlot: "dinner", mainRecipeId: "ziti", mainTitle: "Ziti" }),
      ],
    });

    const monday = dayRow("Monday");

    expect(within(monday).getByRole("link", { name: "Oats" })).toBeInTheDocument();
    expect(within(monday).getByRole("link", { name: "Ziti" })).toBeInTheDocument();
  });

  it("marks today, and fades the days already past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    expect(dayRow("Wednesday")).toHaveAttribute("aria-current", "date");
    expect(dayRow("Monday")).toHaveClass("text-muted-foreground");
    expect(dayRow("Thursday")).not.toHaveClass("text-muted-foreground");
  });

  it("keeps today on the local date after UTC has rolled over", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    vi.useFakeTimers({ toFake: ["Date"] });
    // 8pm Wednesday in Chicago, already Thursday in UTC.
    vi.setSystemTime(new Date("2026-09-10T01:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: true });

    expect(screen.getByRole("link", { name: "Wednesday" }).closest("li")).toHaveAttribute(
      "aria-current",
      "date",
    );
  });

  it("marks no day as today when the week shown is an earlier one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));

    await renderHome({ planId: "2026-W37", isCurrentWeek: false });

    expect(document.querySelector('[aria-current="date"]')).toBeNull();
    expect(screen.getByRole("link", { name: "Sunday" }).closest("li")).toHaveClass(
      "text-muted-foreground",
    );
  });
});

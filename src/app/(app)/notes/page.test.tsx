// @vitest-environment jsdom
import type { WeekNote } from "@server/services/week-notes";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listWeekNotes = vi.fn<(householdId: string, weekId: string) => Promise<WeekNote[]>>();
const session = vi.fn<() => Promise<{ user: { name: string } } | null>>();
const redirect = vi.fn<(url: string) => never>();

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/login-url", () => ({ loginUrl: async () => "/login?from=%2Fnotes" }));
vi.mock("../../../../auth", () => ({ auth: () => session() }));
vi.mock("@server/auth/household", () => ({ householdForSession: () => "loewer" }));
vi.mock("@server/services/week-notes", () => ({
  listWeekNotes: (householdId: string, weekId: string) => listWeekNotes(householdId, weekId),
}));
// The add row is a client component wired to tRPC; its own test covers it.
vi.mock("@/components/notes/add-note", () => ({
  AddNote: ({ weekId }: { weekId: string }) => <form aria-label={`Add a note to ${weekId}`} />,
}));

const { default: Notes } = await import("./page");

function note(o: Partial<WeekNote> & { body: string }): WeekNote {
  return {
    householdId: "loewer",
    id: o.body,
    weekId: "2026-W42",
    date: null,
    createOrder: 0,
    createTime: new Date(),
    updateTime: new Date(),
    ...o,
  };
}

async function renderNotes(week?: string) {
  render(await Notes({ searchParams: Promise.resolve(week === undefined ? {} : { week }) }));
}

beforeEach(() => {
  session.mockResolvedValue({ user: { name: "loewer" } });
  listWeekNotes.mockResolvedValue([]);
  // Monday of 2026-W41, so next week is 2026-W42: Oct 12–18.
  vi.useFakeTimers({ now: new Date("2026-10-05T15:00:00Z"), toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("notes", () => {
  it("sends a signed-out visitor to the login page", async () => {
    session.mockResolvedValue(null);

    await Notes({ searchParams: Promise.resolve({}) });

    expect(redirect).toHaveBeenCalledWith("/login?from=%2Fnotes");
  });

  it("opens on next week, headed with its dates and marked as next week", async () => {
    await renderNotes();

    expect(listWeekNotes).toHaveBeenCalledWith("loewer", "2026-W42");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Notes for Oct 12–18");
    expect(screen.getByText("Next week", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add a note to 2026-W42" })).toBeInTheDocument();
  });

  // Sunday 23:59 UTC is still W41; a minute later W42 is this week and W43 is next. Run in
  // Chicago, where that minute is Sunday evening: a page reading the local date would still be
  // in W41 there. CI runs in UTC, where local and UTC agree and the test would prove nothing.
  it("moves to the new next week when the UTC week flips", async () => {
    vi.stubEnv("TZ", "America/Chicago");

    vi.setSystemTime(new Date("2026-10-11T23:59:00Z"));
    await renderNotes();
    expect(listWeekNotes).toHaveBeenLastCalledWith("loewer", "2026-W42");
    cleanup();

    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    await renderNotes();

    expect(listWeekNotes).toHaveBeenLastCalledWith("loewer", "2026-W43");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Notes for Oct 19–25");
    expect(screen.getByRole("link", { name: "Previous week" })).toHaveAttribute(
      "href",
      "/notes?week=2026-W42",
    );
  });

  it("shows another week asked for, without the next-week marker, and a way back", async () => {
    await renderNotes("2026-W40");

    expect(listWeekNotes).toHaveBeenCalledWith("loewer", "2026-W40");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Notes for Sep 28–Oct 4");
    expect(screen.queryByText("Next week", { selector: "p" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to next week" })).toHaveAttribute(
      "href",
      "/notes",
    );
    expect(screen.getByRole("form", { name: "Add a note to 2026-W40" })).toBeInTheDocument();
  });

  it("names the year for a week in another year", async () => {
    await renderNotes("2027-W42");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Notes for Oct 18–24, 2027",
    );
  });

  it("names both years for a week that crosses into another year", async () => {
    await renderNotes("2026-W53");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Notes for Dec 28, 2026–Jan 3, 2027",
    );
  });

  it("falls back to next week for a ?week= that is not an ISO week", async () => {
    await renderNotes("not-a-week");

    expect(listWeekNotes).toHaveBeenCalledWith("loewer", "2026-W42");
    expect(screen.queryByRole("link", { name: "Back to next week" })).toBeNull();
  });

  it("says when nothing is noted for the week", async () => {
    await renderNotes();

    expect(screen.getByText("Nothing noted for this week.")).toBeInTheDocument();
  });

  it("groups notes under any day first, then each day in the order listed", async () => {
    listWeekNotes.mockResolvedValue([
      note({ body: "Mom asked for pot roast" }),
      note({ date: "2026-10-15", body: "Soccer until 7" }),
      note({ date: "2026-10-15", body: "Grandma visiting" }),
    ]);

    await renderNotes();

    const groups = screen.getAllByRole("region");

    expect(groups.map((group) => within(group).getByRole("heading").textContent)).toEqual([
      "Any day",
      "Thursday, Oct 15",
    ]);
    expect(
      within(groups[1] ?? document.body)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Soccer until 7", "Grandma visiting"]);
  });
});

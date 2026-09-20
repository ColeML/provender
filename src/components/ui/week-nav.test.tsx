// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WeekNav } from "./week-nav";

afterEach(cleanup);

describe("WeekNav", () => {
  it("links one week either side of the one on screen", () => {
    render(<WeekNav basePath="/shop" planId="2026-W39" atDefault />);

    expect(screen.getByRole("link", { name: /previous week/i })).toHaveAttribute(
      "href",
      "/shop?week=2026-W38",
    );
    expect(screen.getByRole("link", { name: /next week/i })).toHaveAttribute(
      "href",
      "/shop?week=2026-W40",
    );
  });

  it("names the week being shown", () => {
    render(<WeekNav basePath="/plan" planId="2026-W39" atDefault />);

    expect(screen.getByText("2026-W39")).toBeInTheDocument();
  });

  it("crosses a year boundary rather than running off the end", () => {
    render(<WeekNav basePath="/shop" planId="2026-W53" atDefault />);

    expect(screen.getByRole("link", { name: /next week/i })).toHaveAttribute(
      "href",
      "/shop?week=2027-W01",
    );
  });

  it("offers a way back once the reader has navigated off the default view", () => {
    render(<WeekNav basePath="/shop" planId="2026-W41" atDefault={false} />);

    expect(screen.getByRole("link", { name: /this week/i })).toHaveAttribute("href", "/shop");
  });

  it("omits that way back while already on the default view", () => {
    render(<WeekNav basePath="/shop" planId="2026-W39" atDefault />);

    expect(screen.queryByRole("link", { name: /this week/i })).toBeNull();
  });

  /**
   * `/shop` with no query string falls back to the most recent plan when the current week is
   * unplanned, so a week id that is not today's can still be what the bare path renders. Keying
   * the link on the week id would make it reload the same page.
   */
  it("omits the way back on a default view showing an older week", () => {
    render(<WeekNav basePath="/shop" planId="2026-W36" atDefault />);

    expect(screen.queryByRole("link", { name: /this week/i })).toBeNull();
  });

  it("carries the app's focus ring on every link", () => {
    render(<WeekNav basePath="/shop" planId="2026-W41" atDefault={false} />);

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("focus-visible:ring-ring", "focus-visible:ring-3");
      expect(link).toHaveClass("focus-visible:outline-none");
    }
  });

  it("keeps the week id out of the display face, which the page h1 owns", () => {
    render(<WeekNav basePath="/plan" planId="2026-W39" atDefault />);

    expect(screen.getByText("2026-W39").className).not.toContain("font-display");
  });

  // `/plan` names the week in its own h1, so repeating it between the arrows is noise.
  it("drops its own label when the page already names the week", () => {
    render(<WeekNav basePath="/plan" planId="2026-W39" atDefault showWeek={false} />);

    expect(screen.queryByText("2026-W39")).toBeNull();
    expect(screen.getByRole("link", { name: /next week/i })).toBeInTheDocument();
  });
});

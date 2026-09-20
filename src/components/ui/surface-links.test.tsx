// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const params = { current: new URLSearchParams() };

vi.mock("next/navigation", () => ({ useSearchParams: () => params.current }));

const { BareSurfaceLinks, SurfaceLinks } = await import("./surface-links");

afterEach(cleanup);

function renderAt(query: string) {
  params.current = new URLSearchParams(query);

  render(<SurfaceLinks />);
}

describe("SurfaceLinks", () => {
  it("links the surfaces bare when no week is selected", () => {
    renderAt("");

    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("href", "/shop");
  });

  // The point: pick a week on one surface and the other opens on it too.
  it("carries the selected week to the other week-shaped surface", () => {
    renderAt("week=2026-W40");

    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "href",
      "/plan?week=2026-W40",
    );
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute(
      "href",
      "/shop?week=2026-W40",
    );
  });

  it("leaves the surfaces that have no week alone", () => {
    renderAt("week=2026-W40");

    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/recipes");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  // A junk parameter must not be propagated across the app by the header.
  it("drops a week that is not an ISO week", () => {
    renderAt("week=not-a-week");

    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
  });
});

describe("BareSurfaceLinks", () => {
  // The Suspense fallback: a route that stops being dynamic should lose the week, not the nav.
  it("renders every surface with no week on it", () => {
    render(<BareSurfaceLinks />);

    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("href", "/shop");
    expect(screen.getByRole("link", { name: "Recipes" })).toHaveAttribute("href", "/recipes");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});

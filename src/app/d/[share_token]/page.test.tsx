// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.fn<(token: string) => Promise<unknown>>();

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@server/services/day-shares", () => ({ getSharedDay: (token: string) => shared(token) }));

const { default: Shared } = await import("./page");

const page = (token: string) => Shared({ params: Promise.resolve({ share_token: token }) });

beforeEach(() => {
  shared.mockReset();
});

describe("the shared day page", () => {
  it("answers an expired or unknown token with a 404", async () => {
    shared.mockResolvedValue(null);

    await expect(page("gone")).rejects.toThrow("notFound");
    expect(shared).toHaveBeenCalledWith("gone");
  });

  it("shows each dish under its role, with the day's notes", async () => {
    shared.mockResolvedValue({
      date: "2026-09-07",
      slots: [
        {
          mealSlot: "dinner",
          notes: "Bedtime at 8.",
          main: { recipeId: "fajitas" },
          side: null,
          extras: [{ recipeId: "cookies" }],
        },
      ],
      recipes: {
        fajitas: {
          title: "Chicken Fajitas",
          baseServings: 8,
          totalMin: 40,
          costEstimate: "14.50",
          instructions: [],
          ingredients: [{ id: "a", name: "bell pepper", quantity: "3", unit: "ea", notes: null }],
        },
        cookies: {
          title: "Cookies",
          baseServings: 24,
          totalMin: null,
          instructions: [],
          ingredients: [],
        },
      },
    });

    const { container } = render(await page("t"));

    expect(screen.getByText("Bedtime at 8.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Main\s*Chicken Fajitas/ })).toBeVisible();
    expect(screen.getByRole("heading", { level: 3, name: /Extra\s*Cookies/ })).toBeVisible();
    expect(container).toHaveTextContent("3 ea");
    expect(container).not.toHaveTextContent("14.5");
  });
});

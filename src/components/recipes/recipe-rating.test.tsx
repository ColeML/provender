// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeRating } from "./recipe-rating";

const mutate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    recipes: { setRating: { mutationOptions: () => ({ mutationFn: mutate }) } },
  }),
}));

function renderRating(initialRating: number | null) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <RecipeRating recipeId="fajitas" initialRating={initialRating} />
    </QueryClientProvider>,
  );

  return user;
}

function star(count: number) {
  return screen.getByRole("button", { name: count === 1 ? "1 star" : `${count} stars` });
}

beforeEach(() => {
  mutate.mockReset().mockResolvedValue({});
});

afterEach(cleanup);

describe("rating a recipe", () => {
  it("shows the stored rating as the pressed star", () => {
    renderRating(4);

    expect(star(4)).toHaveAttribute("aria-pressed", "true");
    expect(star(5)).toHaveAttribute("aria-pressed", "false");
  });

  it("applies a tapped star before the request finishes", async () => {
    mutate.mockReturnValue(new Promise(() => {}));
    const user = renderRating(null);

    await user.click(star(3));

    expect(star(3)).toHaveAttribute("aria-pressed", "true");
    expect(mutate.mock.calls[0][0]).toEqual({ recipeId: "fajitas", rating: 3 });
  });

  it("clears the rating when the current star is tapped again", async () => {
    const user = renderRating(3);

    await user.click(star(3));

    expect(star(3)).toHaveAttribute("aria-pressed", "false");
    expect(mutate.mock.calls[0][0]).toEqual({ recipeId: "fajitas", rating: null });
  });

  it("puts the old rating back and says so when the write fails", async () => {
    mutate.mockRejectedValue(new Error("offline"));
    const user = renderRating(2);

    await user.click(star(5));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that rating.");
    expect(star(2)).toHaveAttribute("aria-pressed", "true");
  });
});

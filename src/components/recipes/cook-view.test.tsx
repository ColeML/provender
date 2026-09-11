// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CookView, type CookRecipe } from "./cook-view";

const scale = vi.fn();
const request = vi.fn();
const release = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    recipes: {
      scale: {
        queryOptions: (input: { targetServings: number }) => ({
          queryKey: ["scale", input.targetServings],
          queryFn: () => scale(input),
        }),
      },
    },
  }),
}));

const RECIPE: CookRecipe = {
  recipeId: "fajitas",
  title: "Chicken Fajitas",
  baseServings: 8,
  totalMin: 30,
  sourceUrl: "https://example.com/fajitas",
  instructions: ["Slice the peppers.", "Sear the chicken.", "Warm the tortillas."],
  ingredients: [
    { id: "a", name: "chicken breast", quantity: 1.5, unit: "lb", notes: "sliced" },
    { id: "b", name: "salt", quantity: null, unit: null, notes: "to taste" },
  ],
};

function renderCook(recipe: Partial<CookRecipe> = {}) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CookView recipe={{ ...RECIPE, ...recipe }} />
    </QueryClientProvider>,
  );

  return user;
}

beforeEach(() => {
  scale.mockReset();
  request.mockReset().mockResolvedValue({ release });
  release.mockReset().mockResolvedValue(undefined);

  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe("the cook view", () => {
  it("renders quantities as fractions", () => {
    renderCook();

    expect(screen.getByText("1½ lb")).toBeInTheDocument();
  });

  it("shows every step at once, numbered in order", () => {
    renderCook();

    const method = screen.getByRole("list", { name: "Method" });

    expect(
      within(method)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["1Slice the peppers.", "2Sear the chicken.", "3Warm the tortillas."]);
  });

  it("does not call the API while the servings are the stored ones", () => {
    renderCook();

    expect(scale).not.toHaveBeenCalled();
  });

  it("scales through the API once a different count is asked for", async () => {
    scale.mockResolvedValue({
      ingredients: [{ name: "chicken breast", quantity: 1.6875, unit: "lb", notes: "sliced" }],
    });

    const user = renderCook();

    await user.click(screen.getByRole("button", { name: "More servings" }));

    await waitFor(() => {
      expect(scale).toHaveBeenCalledWith({ recipeId: "fajitas", targetServings: 9 });
    });
  });

  it("says the amounts are stale while it scales, rather than showing them as the new count", async () => {
    // Never settles, so this is the screen mid-scale.
    scale.mockImplementation(() => new Promise(() => {}));

    const user = renderCook();

    await user.click(screen.getByRole("button", { name: "More servings" }));

    expect(screen.getByText(/still for 8, scaling/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Ingredients" })).toHaveAttribute("aria-busy", "true");
  });

  it("drops the warning once the scaled amounts arrive", async () => {
    scale.mockResolvedValue({
      ingredients: [{ name: "chicken breast", quantity: 1.6875, unit: "lb", notes: null }],
    });

    const user = renderCook();

    await user.click(screen.getByRole("button", { name: "More servings" }));

    await waitFor(() => {
      expect(screen.queryByText(/still for 8, scaling/)).toBeNull();
    });

    expect(screen.getByRole("list", { name: "Ingredients" })).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the stored amounts when scaling fails, and says so", async () => {
    scale.mockRejectedValue(new Error("nope"));

    const user = renderCook();

    await user.click(screen.getByRole("button", { name: "More servings" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Could not scale/);
    });

    expect(screen.getByText("1½ lb")).toBeInTheDocument();
  });

  it("will not go below one serving", async () => {
    const user = renderCook({ baseServings: 1 });

    expect(screen.getByRole("button", { name: "Fewer servings" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "More servings" }));

    expect(screen.getByRole("button", { name: "Fewer servings" })).toBeEnabled();
  });

  it("holds a wake lock while it is open, and releases it on the way out", async () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CookView recipe={RECIPE} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("screen");
    });

    unmount();

    await waitFor(() => {
      expect(release).toHaveBeenCalled();
    });
  });

  it("renders on a browser with no wake lock support", () => {
    // Deleted, not set to undefined: the guard tests `"wakeLock" in navigator`, and an undefined
    // value still satisfies that. Safari only shipped this in 16.4.
    // @ts-expect-error -- removing an optional platform API is the point of the test.
    delete navigator.wakeLock;

    expect("wakeLock" in navigator).toBe(false);
    expect(() => renderCook()).not.toThrow();
    expect(screen.getByText("Chicken Fajitas")).toBeInTheDocument();
  });

  it("renders a recipe with no steps at all", () => {
    renderCook({ instructions: [] });

    expect(screen.queryByRole("list", { name: "Method" })).toBeNull();
    expect(screen.getByText("chicken breast")).toBeInTheDocument();
  });
});

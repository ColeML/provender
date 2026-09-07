// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShoppingList, type ShopItem } from "./shopping-list";

/**
 * The mutation is stubbed at the tRPC hook, not the network.
 *
 * What matters here is what the shopper sees when a write succeeds or fails — the endpoint itself
 * is covered by the service and route tests.
 */
const mutate = vi.fn();
type Variables = { itemId: string; purchased: boolean };

let onErrorHandler: ((error: unknown, variables: Variables) => void) | undefined;
let onSuccessHandler: ((data: unknown, variables: Variables) => void) | undefined;

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    shoppingList: {
      setPurchased: {
        mutationOptions: (options: {
          onError?: (error: unknown, variables: { itemId: string; purchased: boolean }) => void;
          onSuccess?: (data: unknown, variables: { itemId: string; purchased: boolean }) => void;
        }) => {
          onErrorHandler = options.onError;
          onSuccessHandler = options.onSuccess;

          return { mutationFn: mutate };
        },
      },
    },
  }),
}));

function item(overrides: Partial<ShopItem> & { id: string; name: string }): ShopItem {
  return {
    quantity: 1,
    unit: "ea",
    category: "produce",
    estCost: 1,
    purchased: false,
    haveAlready: false,
    feedsRecipes: [],
    ...overrides,
  };
}

function renderList(items: ShopItem[], budgetTarget: number | null = 120) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ShoppingList planId="2026-W36" budgetTarget={budgetTarget} initialItems={items} />
    </QueryClientProvider>,
  );

  return user;
}

describe("the shopping list", () => {
  it("groups items by aisle, in the order the shop is walked", () => {
    renderList([
      item({ id: "flour", name: "flour", category: "pantry" }),
      item({ id: "onion", name: "onion", category: "produce" }),
      item({ id: "beef", name: "beef", category: "meat" }),
    ]);

    const aisles = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);

    expect(aisles).toEqual(["Produce", "Meat", "Pantry"]);
  });

  it("shows the week and how much is left", () => {
    renderList([item({ id: "a", name: "a" }), item({ id: "b", name: "b", purchased: true })]);

    expect(screen.getByText(/2026-W36/)).toBeInTheDocument();
    expect(screen.getByText(/1 left of 2/)).toBeInTheDocument();
  });

  it("lists what the household already has separately, and does not count it", () => {
    renderList([
      item({ id: "onion", name: "onion", estCost: 5 }),
      item({ id: "salt", name: "salt", haveAlready: true, estCost: 99 }),
    ]);

    expect(screen.getByText(/Already have \(1\)/)).toBeInTheDocument();
    // The $99 pantry item must not reach the total.
    expect(screen.getByLabelText("Still to buy: $5.00")).toBeInTheDocument();
  });

  it("ticks an item off on tap, before the request finishes", async () => {
    const user = renderList([item({ id: "onion", name: "onion" })]);
    const row = screen.getByRole("checkbox", { name: /onion/ });

    expect(row).not.toBeChecked();

    await user.click(row);

    expect(row).toBeChecked();
    expect(mutate).toHaveBeenCalled();
  });

  it("drops a ticked item out of the remaining total", async () => {
    const user = renderList([
      item({ id: "onion", name: "onion", estCost: 4 }),
      item({ id: "beef", name: "beef", category: "meat", estCost: 6 }),
    ]);

    expect(screen.getByLabelText("Still to buy: $10.00")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /onion/ }));

    expect(screen.getByLabelText("Still to buy: $6.00")).toBeInTheDocument();
  });

  it("puts the tick back and says so when the write fails", async () => {
    const user = renderList([item({ id: "onion", name: "onion" })]);
    const row = screen.getByRole("checkbox", { name: /onion/ });

    await user.click(row);
    expect(row).toBeChecked();

    // What the mutation's onError does when the request is rejected.
    onErrorHandler?.(new Error("offline"), { itemId: "onion", purchased: true });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/One item did not save/i);
    });
    expect(screen.getByRole("checkbox", { name: /onion/ })).not.toBeChecked();
  });

  it("keeps one item's failure warning when another tick succeeds", async () => {
    const user = renderList([
      item({ id: "milk", name: "milk", category: "dairy" }),
      item({ id: "bread", name: "bread", category: "bakery" }),
    ]);

    await user.click(screen.getByRole("checkbox", { name: /milk/ }));
    onErrorHandler?.(new Error("offline"), { itemId: "milk", purchased: true });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // bread saves fine; milk is still unsaved and must still say so.
    await user.click(screen.getByRole("checkbox", { name: /bread/ }));
    onSuccessHandler?.(undefined, { itemId: "bread", purchased: true });

    expect(screen.getByRole("alert")).toHaveTextContent(/One item did not save/i);
    expect(screen.getByRole("checkbox", { name: /milk/ })).not.toBeChecked();
  });

  it("renders quantities as fractions, the way a recipe reads", () => {
    renderList([
      item({ id: "salt", name: "salt", quantity: 0.5, unit: "tsp", category: "pantry" }),
      item({ id: "flour", name: "flour", quantity: 2.25, unit: "cup", category: "pantry" }),
    ]);

    expect(screen.getByText("½ tsp")).toBeInTheDocument();
    expect(screen.getByText("2¼ cup")).toBeInTheDocument();
  });

  it("says why an item is on the list", () => {
    renderList([item({ id: "onion", name: "onion", feedsRecipes: ["fajitas", "sloppy-joes"] })]);

    expect(screen.getByText("fajitas, sloppy-joes")).toBeInTheDocument();
  });

  it("flags going over budget", () => {
    renderList([item({ id: "beef", name: "beef", estCost: 200 })], 120);

    expect(screen.getByText("of $120.00")).toHaveClass("text-red-600");
  });

  it("explains itself when no week is planned", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShoppingList planId={null} budgetTarget={null} initialItems={[]} />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/No week has been planned/)).toBeInTheDocument();
  });
});

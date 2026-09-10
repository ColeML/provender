// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("hiding what is already in the trolley", () => {
  beforeEach(() => window.localStorage.clear());

  function twoItemsOneBought() {
    return renderList([
      item({ id: "onion", name: "onion", estCost: 4 }),
      item({ id: "beef", name: "beef", category: "meat", estCost: 6, purchased: true }),
    ]);
  }

  it("offers the toggle only once something is in the trolley", () => {
    renderList([item({ id: "onion", name: "onion" })]);

    expect(screen.queryByRole("checkbox", { name: /already in the trolley/ })).toBeNull();
  });

  it("takes bought items out of the aisles", async () => {
    const user = twoItemsOneBought();

    expect(screen.getByRole("checkbox", { name: /beef/ })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /already in the trolley/ }));

    expect(screen.queryByRole("checkbox", { name: /beef/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /onion/ })).toBeInTheDocument();
  });

  it("keeps a mis-tap recoverable, without turning hiding off", async () => {
    const user = twoItemsOneBought();

    await user.click(screen.getByRole("checkbox", { name: /already in the trolley/ }));
    await user.click(screen.getByRole("button", { name: /Show the 1 in the trolley/ }));

    const beef = screen.getByRole("checkbox", { name: /beef/ });

    expect(beef).toBeChecked();

    await user.click(beef);

    // Back in its aisle, and out of the trolley list.
    expect(screen.getByRole("checkbox", { name: /beef/ })).not.toBeChecked();
  });

  it("does not change the total or the count", async () => {
    const user = twoItemsOneBought();

    expect(screen.getByLabelText("Still to buy: $4.00")).toBeInTheDocument();
    expect(screen.getByText(/1 left of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /already in the trolley/ }));

    expect(screen.getByLabelText("Still to buy: $4.00")).toBeInTheDocument();
    expect(screen.getByText(/1 left of 2/)).toBeInTheDocument();
  });

  it("remembers the choice, so it is not re-set mid-aisle", async () => {
    const user = twoItemsOneBought();

    await user.click(screen.getByRole("checkbox", { name: /already in the trolley/ }));

    expect(window.localStorage.getItem("provender.shop.hideBought")).toBe("true");

    cleanup();
    twoItemsOneBought();

    expect(screen.getByRole("checkbox", { name: /already in the trolley/ })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /beef/ })).toBeNull();
  });
});

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

  it("paints the tick in the color that sits on primary, not a fixed white", async () => {
    // Load-bearing: after the tap the item is bought, and a hide-bought preference left in
    // storage by another test would unmount the row before the assertions run.
    window.localStorage.clear();

    const user = renderList([item({ id: "onion", name: "onion" })]);
    const box = screen.getByRole("checkbox", { name: /onion/ });
    const tick = box.parentElement?.querySelector("svg");

    // The glyph inherits its color rather than carrying one, so it flips with the theme —
    // white was 1.41:1 on dark mode's pale-gold `primary`.
    expect(tick).toBeInTheDocument();
    expect(tick).toHaveClass("text-primary-foreground");
    expect(tick?.getAttribute("stroke")).toBe("currentColor");

    // Hidden until the box is ticked, and shown by the box's own checked state.
    expect(tick).toHaveClass("opacity-0", "peer-checked:opacity-100");
    expect(box).toHaveClass("peer");

    // `peer-checked:` compiles to a `~` sibling selector, so the classes above only do anything
    // while the glyph is a *later* sibling of the input under the same parent. jsdom applies no
    // CSS, so the order is what has to be asserted.
    const siblings = Array.from(box.parentElement?.children ?? []);
    expect(siblings.indexOf(box)).toBeGreaterThanOrEqual(0);
    expect(siblings.indexOf(tick as Element)).toBeGreaterThan(siblings.indexOf(box));

    await user.click(box);

    expect(screen.getByRole("checkbox", { name: /onion/ })).toBeChecked();
  });

  it("gives every checkbox a focus ring, since they all suppress the browser's outline", async () => {
    window.localStorage.clear();

    const user = renderList([
      item({ id: "onion", name: "onion" }),
      item({ id: "milk", name: "milk", purchased: true }),
    ]);

    // Reveal the bought list too, so all three call sites are on screen at once.
    await user.click(screen.getByRole("checkbox", { name: /trolley/ }));
    await user.click(screen.getByRole("button", { name: /Show the 1 in the trolley/ }));

    const boxes = screen.getAllByRole("checkbox");

    expect(boxes).toHaveLength(3);

    for (const box of boxes) {
      // Suppressing the user-agent outline without putting something back leaves a keyboard
      // shopper with no idea which box focus is on.
      expect(box).toHaveClass("focus-visible:outline-none");
      expect(box).toHaveClass("focus-visible:ring-ring", "focus-visible:ring-3");
    }

    // The ring lives on the input, so a label must not draw a second one around the whole row.
    for (const label of Array.from(document.querySelectorAll("label"))) {
      expect(label.className).not.toContain("has-[:focus-visible]:ring");
    }
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

    expect(screen.getByText("of $120.00")).toHaveClass("text-destructive");
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

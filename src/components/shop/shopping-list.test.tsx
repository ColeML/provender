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
const addItemFn = vi.fn();
const deleteItemFn = vi.fn();
const setQuantityFn = vi.fn();
type Variables = { itemId: string; purchased: boolean };

let onErrorHandler: ((error: unknown, variables: Variables) => void) | undefined;
let onSuccessHandler: ((data: unknown, variables: Variables) => void) | undefined;

/** A row as the server returns it: numerics arrive as strings from Postgres. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "dish-soap",
    name: "dish soap",
    quantity: null,
    unit: null,
    category: "other",
    estCost: null,
    purchased: false,
    haveAlready: false,
    feedsRecipes: [],
    source: "manual",
    ...overrides,
  };
}

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
      // These three run their real onSuccess, so the tests assert what the screen does with the
      // row the server sends back rather than what the component hoped it would be.
      addItem: {
        mutationOptions: (options: object) => ({ ...options, mutationFn: addItemFn }),
      },
      deleteItem: {
        mutationOptions: (options: object) => ({ ...options, mutationFn: deleteItemFn }),
      },
      setQuantity: {
        mutationOptions: (options: object) => ({ ...options, mutationFn: setQuantityFn }),
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
    source: "plan",
    ...overrides,
  };
}

function renderList(
  items: ShopItem[],
  budgetTarget: number | null = 120,
  week: { planId?: string; atDefault?: boolean; planned?: boolean } = {},
) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ShoppingList
        planId={week.planId ?? "2026-W36"}
        atDefault={week.atDefault ?? true}
        planned={week.planned ?? true}
        budgetTarget={budgetTarget}
        initialItems={items}
      />
    </QueryClientProvider>,
  );

  return user;
}

describe("hiding what is already purchased", () => {
  beforeEach(() => window.localStorage.clear());

  function twoItemsOneBought() {
    return renderList([
      item({ id: "onion", name: "onion", estCost: 4 }),
      item({ id: "beef", name: "beef", category: "meat", estCost: 6, purchased: true }),
    ]);
  }

  it("offers the toggle only once something is purchased", () => {
    renderList([item({ id: "onion", name: "onion" })]);

    expect(screen.queryByRole("checkbox", { name: /Hide the \d+ purchased/ })).toBeNull();
  });

  it("takes bought items out of the aisles", async () => {
    const user = twoItemsOneBought();

    expect(screen.getByRole("checkbox", { name: /beef/ })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Hide the \d+ purchased/ }));

    expect(screen.queryByRole("checkbox", { name: /beef/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /onion/ })).toBeInTheDocument();
  });

  it("keeps a mis-tap recoverable, without turning hiding off", async () => {
    const user = twoItemsOneBought();

    await user.click(screen.getByRole("checkbox", { name: /Hide the \d+ purchased/ }));
    await user.click(screen.getByRole("button", { name: /Show the 1 purchased/ }));

    const beef = screen.getByRole("checkbox", { name: /beef/ });

    expect(beef).toBeChecked();

    await user.click(beef);

    // Back in its aisle, and out of the purchased list.
    expect(screen.getByRole("checkbox", { name: /beef/ })).not.toBeChecked();
  });

  it("does not change the total or the count", async () => {
    const user = twoItemsOneBought();

    expect(screen.getByLabelText("Still to buy: $4.00")).toBeInTheDocument();
    expect(screen.getByText(/1 left of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Hide the \d+ purchased/ }));

    expect(screen.getByLabelText("Still to buy: $4.00")).toBeInTheDocument();
    expect(screen.getByText(/1 left of 2/)).toBeInTheDocument();
  });

  it("remembers the choice, so it is not re-set mid-aisle", async () => {
    const user = twoItemsOneBought();

    await user.click(screen.getByRole("checkbox", { name: /Hide the \d+ purchased/ }));

    expect(window.localStorage.getItem("provender.shop.hideBought")).toBe("true");

    cleanup();
    twoItemsOneBought();

    expect(screen.getByRole("checkbox", { name: /Hide the \d+ purchased/ })).toBeChecked();
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
    await user.click(screen.getByRole("checkbox", { name: /purchased/ }));
    await user.click(screen.getByRole("button", { name: /Show the 1 purchased/ }));

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

  it("explains itself when the week on screen is not planned", () => {
    renderList([], null, { planned: false });

    expect(screen.getByText(/not planned yet/i)).toBeInTheDocument();
  });
});

describe("week navigation", () => {
  it("steps to the weeks either side of the list", () => {
    renderList([], 120, { planId: "2026-W39" });

    expect(screen.getByRole("link", { name: /next week/i })).toHaveAttribute(
      "href",
      "/shop?week=2026-W40",
    );
    expect(screen.getByRole("link", { name: /previous week/i })).toHaveAttribute(
      "href",
      "/shop?week=2026-W38",
    );
  });

  // Without this the reader who steps onto an unplanned week has no way back but the URL bar.
  it("keeps the navigation on a week that has no plan", () => {
    renderList([], null, { planId: "2026-W44", atDefault: false, planned: false });

    expect(screen.getByText(/not planned yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /previous week/i })).toHaveAttribute(
      "href",
      "/shop?week=2026-W43",
    );
    expect(screen.getByRole("link", { name: /this week/i })).toHaveAttribute("href", "/shop");
  });

  // A planned week whose list is empty is a different state from an unplanned one.
  it("tells an empty list apart from an unplanned week", () => {
    renderList([], 120, { planId: "2026-W39" });

    expect(screen.queryByText(/not planned yet/i)).toBeNull();
  });
});

describe("switching weeks", () => {
  function renderWeek(planId: string, items: ShopItem[]) {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <ShoppingList
          planId={planId}
          atDefault={false}
          planned
          budgetTarget={120}
          initialItems={items}
        />
      </QueryClientProvider>,
    );
  }

  /**
   * A soft navigation between two planned weeks re-renders the same `List` instance, so state
   * seeded from props at mount goes stale. Only reproducible between two *planned* weeks: an
   * unplanned week renders the other branch and remounts the list on the way back.
   */
  it("replaces the items when the week changes", () => {
    const { rerender } = renderWeek("2026-W39", [item({ id: "a", name: "Tuna" })]);

    expect(screen.getByText("Tuna")).toBeInTheDocument();

    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <ShoppingList
          planId="2026-W40"
          atDefault={false}
          planned
          budgetTarget={120}
          initialItems={[item({ id: "b", name: "Bacon" })]}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Bacon")).toBeInTheDocument();
    expect(screen.queryByText("Tuna")).toBeNull();
  });
});

describe("adding something the plan did not call for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  async function openForm(items: ShopItem[]) {
    const user = renderList(items);

    await user.click(screen.getByRole("button", { name: "+ Add item" }));

    return user;
  }

  it("puts the item in the aisle the shopper chose, and counts it", async () => {
    addItemFn.mockResolvedValue(row({ id: "dish-soap", name: "dish soap", category: "other" }));

    const user = await openForm([item({ id: "onion", name: "onion" })]);

    await user.type(screen.getByLabelText("Item"), "dish soap");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("dish soap")).toBeInTheDocument();
    // react-query hands the mutation function a context object after the variables.
    expect(addItemFn).toHaveBeenCalledWith(
      { planId: "2026-W36", itemName: "dish soap", quantity: null, category: "other" },
      expect.anything(),
    );
    expect(screen.getByText(/2 left of 2/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Other" })).toBeInTheDocument();
  });

  it("sends the typed quantity and the chosen aisle", async () => {
    addItemFn.mockResolvedValue(row({ id: "banana", name: "banana", category: "produce" }));

    const user = await openForm([]);

    await user.type(screen.getByLabelText("Item"), "banana");
    await user.type(screen.getByLabelText("Qty"), "6");
    await user.selectOptions(screen.getByLabelText("Aisle"), "produce");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addItemFn).toHaveBeenCalledWith(
        { planId: "2026-W36", itemName: "banana", quantity: 6, category: "produce" },
        expect.anything(),
      ),
    );
  });

  it("refuses a name already on the list and says how much is there", async () => {
    const user = await openForm([
      item({ id: "butter_lb", name: "butter", quantity: 2, unit: "lb", category: "dairy" }),
    ]);

    await user.type(screen.getByLabelText("Item"), "Butter");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Already on your list: 2 lb");
    expect(addItemFn).not.toHaveBeenCalled();
  });

  it("offers to buy more of it, in the unit the list is using", async () => {
    setQuantityFn.mockResolvedValue(
      row({ id: "butter_lb", name: "butter", quantity: "3", unit: "lb", source: "plan" }),
    );

    const user = await openForm([
      item({ id: "butter_lb", name: "butter", quantity: 2, unit: "lb", category: "dairy" }),
    ]);

    await user.type(screen.getByLabelText("Item"), "butter");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Add 1 lb" }));

    await waitFor(() =>
      expect(setQuantityFn).toHaveBeenCalledWith(
        { planId: "2026-W36", itemId: "butter_lb", quantity: 3 },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("3 lb")).toBeInTheDocument();
  });

  it("says where a match is when it is not among the rows still to buy", async () => {
    const user = await openForm([
      item({ id: "butter_lb", name: "butter", quantity: 2, unit: "lb", haveAlready: true }),
    ]);

    await user.type(screen.getByLabelText("Item"), "butter");
    await user.click(screen.getByRole("button", { name: "Add" }));

    // Raising its quantity would move a number the shopper cannot see, so no bump is offered.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Already on your list: 2 lb, under Already have",
    );
    expect(screen.queryByRole("button", { name: /^Add \d/ })).toBeNull();
  });

  it("does not read a unit as the amount when the match has no quantity", async () => {
    const user = await openForm([
      item({ id: "salt_tsp", name: "salt", quantity: null, unit: "tsp", category: "pantry" }),
    ]);

    await user.type(screen.getByLabelText("Item"), "salt");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/^Already on your list$/);
  });

  it("replaces the row when the server upserts one another phone already added", async () => {
    addItemFn.mockResolvedValue(row({ id: "onion", name: "onion", category: "produce" }));

    const user = await openForm([]);

    // The list loaded empty, so the name check passes; the household's other phone added it
    // first, and `addItem` upserts and returns the row that is already there.
    await user.type(screen.getByLabelText("Item"), "onion");
    await user.selectOptions(screen.getByLabelText("Aisle"), "produce");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Item"), "onion");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getAllByText("onion")).toHaveLength(1);
  });

  it("marks the bin rather than telling the shopper to tap a row that does not delete", async () => {
    deleteItemFn.mockRejectedValueOnce(new Error("offline"));

    const user = renderList([item({ id: "dish-soap", name: "dish soap", source: "manual" })]);

    await user.click(screen.getByRole("button", { name: "Delete dish soap" }));

    expect(
      await screen.findByRole("button", { name: "Delete dish soap — not deleted, try again" }),
    ).toBeInTheDocument();
    // The tick's banner is for ticks: tapping the row toggles purchased, it does not retry.
    expect(screen.queryByText(/did not save/i)).toBeNull();

    deleteItemFn.mockResolvedValue(undefined);

    await user.click(screen.getByRole("button", { name: /^Delete dish soap/ }));

    await waitFor(() => expect(screen.queryByText("dish soap")).toBeNull());
  });

  it("offers no bump for something bought by feel", async () => {
    const user = await openForm([
      item({ id: "salt", name: "salt", quantity: null, unit: null, category: "pantry" }),
    ]);

    await user.type(screen.getByLabelText("Item"), "salt");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Already on your list");
    expect(screen.queryByRole("button", { name: /^Add \d/ })).toBeNull();
  });

  it("deletes a manual item, and offers no bin for one the plan called for", async () => {
    deleteItemFn.mockResolvedValue(undefined);

    const user = renderList([
      item({ id: "onion", name: "onion", feedsRecipes: ["chili"] }),
      item({ id: "dish-soap", name: "dish soap", category: "other", source: "manual" }),
    ]);

    expect(screen.queryByRole("button", { name: "Delete onion" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Delete dish soap" }));

    await waitFor(() => expect(screen.queryByText("dish soap")).toBeNull());
    expect(deleteItemFn).toHaveBeenCalledWith(
      { planId: "2026-W36", itemId: "dish-soap" },
      expect.anything(),
    );
  });

  it("is not offered on a week nobody has planned", () => {
    renderList([], 120, { planned: false });

    expect(screen.queryByRole("button", { name: "+ Add item" })).toBeNull();
  });
});

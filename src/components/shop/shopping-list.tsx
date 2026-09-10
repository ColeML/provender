"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useStoredFlag } from "@/hooks/use-stored-flag";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/** Only what the screen renders — a Server Component should not ship whole database rows. */
export interface ShopItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  estCost: number | null;
  purchased: boolean;
  haveAlready: boolean;
  feedsRecipes: string[];
}

interface Props {
  planId: string | null;
  budgetTarget: number | null;
  initialItems: ShopItem[];
}

/** The order the aisles are walked, matching the database enum. */
const AISLES = ["produce", "meat", "dairy", "bakery", "frozen", "pantry", "other"] as const;

const AISLE_LABELS: Record<string, string> = {
  produce: "Produce",
  meat: "Meat",
  dairy: "Dairy",
  bakery: "Bakery",
  frozen: "Frozen",
  pantry: "Pantry",
  other: "Other",
};

/** Quantities read as fractions, because that is how a recipe is written. */
const FRACTIONS: Record<string, string> = {
  "0.125": "⅛",
  "0.25": "¼",
  "0.33": "⅓",
  "0.375": "⅜",
  "0.5": "½",
  "0.625": "⅝",
  "0.66": "⅔",
  "0.67": "⅔",
  "0.75": "¾",
  "0.875": "⅞",
};

function formatQuantity(quantity: number | null, unit: string | null) {
  if (quantity === null) {
    return unit ?? "";
  }

  const whole = Math.floor(quantity);
  const remainder = Number((quantity - whole).toFixed(3));
  const fraction = FRACTIONS[String(remainder)];

  const amount = fraction
    ? `${whole > 0 ? whole : ""}${fraction}`
    : String(Number(quantity.toFixed(2)));

  return unit ? `${amount} ${unit}` : amount;
}

/** Why the item is on the list, or that its last tick did not save. */
function ItemSubtitle({ item, failed }: { item: ShopItem; failed: boolean }) {
  if (failed) {
    return (
      <span id={`${item.id}-failed`} className="block text-xs text-red-600">
        Not saved — tap again
      </span>
    );
  }

  if (item.feedsRecipes.length === 0) {
    return null;
  }

  return (
    <span className="text-muted-foreground block truncate text-xs">
      {item.feedsRecipes.join(", ")}
    </span>
  );
}

export function ShoppingList(props: Props) {
  // Narrowed before the interactive component, so the tap handler has a plan id without a guard
  // for a state that cannot happen.
  if (!props.planId) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Shopping list</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          No week has been planned yet, so there is nothing to buy.
        </p>
      </main>
    );
  }

  return <List {...props} planId={props.planId} />;
}

/** Where the hide-bought preference lives, so it is not re-set mid-aisle after a reload. */
const HIDE_BOUGHT_KEY = "provender.shop.hideBought";

function List({ planId, budgetTarget, initialItems }: Props & { planId: string }) {
  const trpc = useTRPC();
  const [items, setItems] = useState(initialItems);
  const [hideBought, setHideBought] = useStoredFlag(HIDE_BOUGHT_KEY);
  const [showBought, setShowBought] = useState(false);

  function onHideBoughtChange(next: boolean) {
    setHideBought(next);
    // Collapse the bought list when hiding is turned off, so the two controls cannot end up
    // saying contradictory things.
    setShowBought(false);
  }

  // Per item, not one value: a successful tick must not clear a warning that belongs to a
  // different item which is still unsaved.
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const toggle = useMutation(
    trpc.shoppingList.setPurchased.mutationOptions({
      onError: (_error, variables) => {
        // Put it back. A tick that silently fails is worse than no optimism at all: you would
        // walk out of the shop believing you had bought it.
        setItems((current) =>
          current.map((item) =>
            item.id === variables.itemId ? { ...item, purchased: !variables.purchased } : item,
          ),
        );
        setFailed((current) => new Set(current).add(variables.itemId));
      },
      onSuccess: (_data, variables) =>
        setFailed((current) => {
          const next = new Set(current);

          next.delete(variables.itemId);

          return next;
        }),
    }),
  );

  function onToggle(item: ShopItem) {
    const purchased = !item.purchased;

    // Applied before the request, so the row responds to the tap rather than to the network.
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, purchased } : row)));

    toggle.mutate({ planId, itemId: item.id, purchased });
  }

  // Derived during render rather than memoised: the React Compiler handles this, and
  // coding-standards.md says not to hand-roll it without a measurement saying otherwise.
  const toBuy = items.filter((item) => !item.haveAlready);
  const alreadyHave = items.filter((item) => item.haveAlready);
  const outstanding = toBuy.filter((item) => !item.purchased);
  const bought = toBuy.filter((item) => item.purchased);
  // Counted from every item the plan calls for, never from what is on screen — hiding a row must
  // not change what the shop costs.
  const remaining = outstanding.reduce((total, item) => total + (item.estCost ?? 0), 0);
  const left = outstanding.length;
  // A hidden row is still recoverable: it moves into the "Bought" list rather than disappearing.
  const visible = hideBought ? outstanding : toBuy;

  return (
    // Padded at the bottom so the sticky total never covers the last row.
    <main className="mx-auto max-w-2xl pb-28">
      <header className="border-border border-b px-4 py-4">
        <h1 className="text-xl font-semibold">Shopping list</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Week of {planId} · {left} left of {toBuy.length}
        </p>

        {bought.length > 0 ? (
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideBought}
              onChange={(event) => onHideBoughtChange(event.target.checked)}
              className="border-muted-foreground/40 checked:border-primary checked:bg-primary size-5 appearance-none rounded border-2"
            />
            Hide the {bought.length} already in the trolley
          </label>
        ) : null}
      </header>

      {failed.size > 0 ? (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {failed.size === 1 ? "One item did not save" : `${failed.size} items did not save`} —
          check your signal and tap {failed.size === 1 ? "it" : "them"} again.
        </p>
      ) : null}

      {AISLES.map((aisle) => {
        const rows = visible.filter((item) => item.category === aisle);

        if (rows.length === 0) {
          return null;
        }

        return (
          <section key={aisle}>
            <h2 className="bg-muted text-muted-foreground sticky top-0 px-4 py-1.5 text-xs font-semibold tracking-wide uppercase">
              {AISLE_LABELS[aisle] ?? aisle}
            </h2>
            <ul>
              {rows.map((item) => (
                <li key={item.id}>
                  {/*
                    The whole row is the target, not a checkbox inside it: this is used one-handed
                    while pushing a trolley. Minimum 56px tall, well over the 44px floor.
                  */}
                  {/*
                    A real checkbox in a label, not a button with role="checkbox": the input
                    carries the semantics for free, and the label makes the whole row the target
                    rather than a small box inside it. Used one-handed while pushing a trolley, so
                    it is 56px tall — well over the 44px floor.
                  */}
                  <label
                    className={cn(
                      "border-border flex min-h-14 w-full items-center gap-3 border-b px-4 py-3",
                      "has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-3",
                      "active:bg-muted",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={item.purchased}
                      onChange={() => onToggle(item)}
                      aria-describedby={failed.has(item.id) ? `${item.id}-failed` : undefined}
                      className={cn(
                        "size-6 shrink-0 appearance-none rounded-md border-2 bg-no-repeat",
                        "border-muted-foreground/40",
                        "checked:border-primary checked:bg-primary",
                        "checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%2220 6 9 17 4 12%22/></svg>')] checked:bg-center",
                        "focus-visible:outline-none",
                      )}
                    />

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-base",
                          item.purchased && "text-muted-foreground line-through",
                        )}
                      >
                        {item.name}
                      </span>
                      <ItemSubtitle item={item} failed={failed.has(item.id)} />
                    </span>

                    <span
                      className={cn(
                        "shrink-0 text-right text-sm",
                        item.purchased ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      <span className="block font-mono">
                        {formatQuantity(item.quantity, item.unit)}
                      </span>
                      {item.estCost === null ? null : (
                        <span className="text-muted-foreground block font-mono text-xs">
                          ${item.estCost.toFixed(2)}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {hideBought && bought.length > 0 ? (
        <section className="border-border border-t px-4 py-4">
          <button
            type="button"
            onClick={() => setShowBought((current) => !current)}
            aria-expanded={showBought}
            className="focus-visible:ring-ring text-muted-foreground min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            {showBought ? "Hide" : "Show"} the {bought.length} in the trolley
          </button>

          {showBought ? (
            <ul className="mt-2">
              {bought.map((item) => (
                <li key={item.id}>
                  {/* Still a checkbox, so a mis-tap can be undone without turning hiding off. */}
                  <label className="flex min-h-11 items-center gap-3 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => onToggle(item)}
                      className="border-primary bg-primary size-5 shrink-0 appearance-none rounded border-2"
                    />
                    <span className="text-muted-foreground line-through">{item.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {alreadyHave.length > 0 ? (
        <section className="px-4 py-5">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Already have ({alreadyHave.length})
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {alreadyHave.map((item) => item.name).join(", ")}
          </p>
        </section>
      ) : null}

      <footer className="border-border bg-background fixed inset-x-0 bottom-0 border-t">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between px-4 py-3">
          <span className="text-sm">
            <span className="text-muted-foreground">Still to buy</span>{" "}
            {/* Labelled, because a bare "$6.00" read aloud says nothing about what it is. */}
            <span
              aria-label={`Still to buy: $${remaining.toFixed(2)}`}
              className="font-mono text-lg font-semibold"
            >
              ${remaining.toFixed(2)}
            </span>
          </span>
          {budgetTarget === null ? null : (
            <span
              className={cn(
                "font-mono text-sm",
                remaining > budgetTarget ? "text-red-600" : "text-muted-foreground",
              )}
            >
              of ${budgetTarget.toFixed(2)}
            </span>
          )}
        </div>
      </footer>
    </main>
  );
}

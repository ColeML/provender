"use client";

import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";

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

export function ShoppingList({ planId, budgetTarget, initialItems }: Props) {
  const trpc = useTRPC();
  const [items, setItems] = useState(initialItems);
  const [failed, setFailed] = useState<string | null>(null);

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
        setFailed(variables.itemId);
      },
      onSuccess: () => setFailed(null),
    }),
  );

  function onToggle(item: ShopItem) {
    const purchased = !item.purchased;

    // Applied before the request, so the row responds to the tap rather than to the network.
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, purchased } : row)));

    if (planId) {
      toggle.mutate({ planId, itemId: item.id, purchased });
    }
  }

  const { toBuy, alreadyHave, remaining, left } = useMemo(() => {
    const buying = items.filter((item) => !item.haveAlready);

    return {
      toBuy: buying,
      alreadyHave: items.filter((item) => item.haveAlready),
      remaining: buying
        .filter((item) => !item.purchased)
        .reduce((total, item) => total + (item.estCost ?? 0), 0),
      left: buying.filter((item) => !item.purchased).length,
    };
  }, [items]);

  if (!planId) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Shopping list</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          No week has been planned yet, so there is nothing to buy.
        </p>
      </main>
    );
  }

  return (
    // Padded at the bottom so the sticky total never covers the last row.
    <main className="mx-auto max-w-2xl pb-28">
      <header className="border-border border-b px-4 py-4">
        <h1 className="text-xl font-semibold">Shopping list</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Week of {planId} · {left} left of {toBuy.length}
        </p>
      </header>

      {failed ? (
        <p
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          That did not save — check your signal and tap it again.
        </p>
      ) : null}

      {AISLES.map((aisle) => {
        const rows = toBuy.filter((item) => item.category === aisle);

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
                  <button
                    type="button"
                    onClick={() => onToggle(item)}
                    aria-pressed={item.purchased}
                    className="border-border focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 border-b px-4 py-3 text-left focus-visible:ring-3 focus-visible:outline-none active:bg-muted"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
                        item.purchased
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {item.purchased ? <Check className="size-4" strokeWidth={3} /> : null}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-base",
                          item.purchased && "text-muted-foreground line-through",
                        )}
                      >
                        {item.name}
                      </span>
                      {item.feedsRecipes.length > 0 ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.feedsRecipes.join(", ")}
                        </span>
                      ) : null}
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
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

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

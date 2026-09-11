"use client";

import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";

import { useStoredFlag } from "@/hooks/use-stored-flag";
import { formatQuantity } from "@/lib/quantity";
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

/** How big the box is, and the glyph inside it. */
const TICK_SIZES = {
  sm: { box: "size-5", radius: "rounded", tick: "size-3.5" },
  lg: { box: "size-6", radius: "rounded-md", tick: "size-4" },
} as const;

interface TickBoxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size: keyof typeof TICK_SIZES;
  describedBy?: string;
}

/**
 * A checkbox whose tick moves with the theme.
 *
 * The box fills with `primary`, and one element cannot also paint a glyph in
 * `primary-foreground`, so the tick is a sibling drawn over it. Baking the glyph into a
 * background image fixes its color instead, and dark mode's `primary` is a pale gold that a
 * white tick disappears against.
 *
 * The focus ring belongs on the input here rather than on each call site's label: the input
 * suppresses the user-agent outline, so a call site that forgot a ring rule would have no
 * focus indicator at all.
 */
function TickBox({ checked, onChange, size, describedBy }: TickBoxProps) {
  const sizing = TICK_SIZES[size];

  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", sizing.box)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={describedBy}
        className={cn(
          "peer appearance-none border-2 focus-visible:outline-none",
          "focus-visible:ring-ring focus-visible:ring-3",
          "border-muted-foreground checked:border-primary checked:bg-primary",
          sizing.box,
          sizing.radius,
        )}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className={cn(
          "text-primary-foreground pointer-events-none absolute opacity-0 peer-checked:opacity-100",
          sizing.tick,
        )}
      />
    </span>
  );
}

/** Why the item is on the list, or that its last tick did not save. */
function ItemSubtitle({ item, failed }: { item: ShopItem; failed: boolean }) {
  if (failed) {
    return (
      <span id={`${item.id}-failed`} className="text-destructive block text-xs">
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
    // Collapsed on both transitions: turning hiding on should reveal a closed list rather than
    // whatever it was left at, and turning it off unmounts the section anyway.
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
            <TickBox size="sm" checked={hideBought} onChange={onHideBoughtChange} />
            Hide the {bought.length} purchased
          </label>
        ) : null}
      </header>

      {failed.size > 0 ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive border-b px-4 py-3 text-sm"
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
                    A real checkbox in a label, not a button with role="checkbox": the input
                    carries the semantics for free, and the label makes the whole row the target
                    rather than a small box inside it. Used one-handed while shopping, so
                    it is 56px tall — well over the 44px floor.
                  */}
                  <label
                    className={cn(
                      "border-border flex min-h-14 w-full items-center gap-3 border-b px-4 py-3",
                      "active:bg-muted",
                    )}
                  >
                    <TickBox
                      size="lg"
                      checked={item.purchased}
                      onChange={() => onToggle(item)}
                      describedBy={failed.has(item.id) ? `${item.id}-failed` : undefined}
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
            {showBought ? "Hide" : "Show"} the {bought.length} purchased
          </button>

          {showBought ? (
            <ul className="mt-2">
              {bought.map((item) => (
                <li key={item.id}>
                  {/* Still a checkbox, so a mis-tap can be undone without turning hiding off. */}
                  <label className="flex min-h-11 items-center gap-3 py-1.5 text-sm">
                    <TickBox size="sm" checked onChange={() => onToggle(item)} />
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
                remaining > budgetTarget ? "text-destructive" : "text-muted-foreground",
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

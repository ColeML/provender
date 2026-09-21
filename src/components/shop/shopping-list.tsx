"use client";

import { useMutation } from "@tanstack/react-query";
import { slug } from "@server/lib/slug";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { WeekNav } from "@/components/ui/week-nav";
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
  /** `manual` is something the shopper added themselves, and the only kind they can delete. */
  source: "plan" | "manual";
}

interface Props {
  /** The week on screen, which may be one nobody has planned. */
  planId: string;
  /** True when `/shop` with no query string already shows this week. */
  atDefault: boolean;
  /** False for a week with no plan row — a different state from a plan whose list is empty. */
  planned: boolean;
  budgetTarget: number | null;
  initialItems: ShopItem[];
}

/** The order the aisles are walked, matching the database enum. */
const AISLES = ["produce", "meat", "dairy", "bakery", "frozen", "pantry", "other"] as const;

type Aisle = (typeof AISLES)[number];

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
  sm: { box: "size-5", tick: "size-3.5" },
  lg: { box: "size-6", tick: "size-4" },
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
          "peer appearance-none rounded-md border-2 focus-visible:outline-none",
          "focus-visible:ring-ring focus-visible:ring-3",
          "border-muted-foreground checked:border-primary checked:bg-primary",
          sizing.box,
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

/** The row the server sends back, as the screen holds it. */
function toShopItem(row: {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string;
  estCost: string | null;
  purchased: boolean;
  haveAlready: boolean;
  feedsRecipes: string[];
  source: "plan" | "manual";
}): ShopItem {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    category: row.category,
    estCost: row.estCost === null ? null : Number(row.estCost),
    purchased: row.purchased,
    haveAlready: row.haveAlready,
    feedsRecipes: row.feedsRecipes,
    source: row.source,
  };
}

const FIELD =
  "border-border focus-visible:ring-ring min-h-11 rounded-md border px-3 text-base focus-visible:ring-3 focus-visible:outline-none";

interface AddItemProps {
  planId: string;
  /** Every item on the list, so a name already there is caught before it is sent. */
  items: ShopItem[];
  onAdded: (item: ShopItem) => void;
  onBumped: (itemId: string, quantity: number) => void;
}

/**
 * Add something no recipe called for.
 *
 * Not optimistic, unlike the tick: this runs two or three times a shop rather than fifty, and the
 * server owns the row's id, so waiting is cheaper than inventing one and reconciling it.
 */
function AddItem({ planId, items, onAdded, onBumped }: AddItemProps) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [aisle, setAisle] = useState<Aisle>("other");
  // Set on submit rather than derived while typing: a half-typed "but" should not accuse you of
  // already having butter.
  const [match, setMatch] = useState<ShopItem | null>(null);

  function reset() {
    setName("");
    setAmount("");
    setMatch(null);
  }

  const add = useMutation(
    trpc.shoppingList.addItem.mutationOptions({
      onSuccess: (item) => {
        onAdded(toShopItem(item));
        reset();
      },
    }),
  );

  const bump = useMutation(
    trpc.shoppingList.setQuantity.mutationOptions({
      onSuccess: (item) => {
        onBumped(item.id, Number(item.quantity));
        reset();
      },
    }),
  );

  const busy = add.isPending || bump.isPending;
  // Blank means one of whatever the thing is measured in.
  const typedAmount = amount.trim() === "" ? 1 : Number(amount);
  const validAmount = Number.isFinite(typedAmount) && typedAmount > 0;

  if (!open) {
    return (
      <div className="px-4 py-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-visible:ring-ring text-muted-foreground min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          + Add item
        </button>
      </div>
    );
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const typedName = name.trim();

    if (typedName === "" || !validAmount) {
      return;
    }

    // Matched on the name alone. A hand-added item carries no unit, so its id would never collide
    // with the plan's `butter_lb` even though they are plainly the same butter.
    const existing = items.find((item) => slug(item.name) === slug(typedName));

    if (existing) {
      setMatch(existing);

      return;
    }

    add.mutate({
      planId,
      itemName: typedName,
      quantity: amount.trim() === "" ? null : typedAmount,
      category: aisle,
    });
  }

  return (
    <form onSubmit={onSubmit} className="border-border border-t px-4 py-4">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-xs">Item</span>
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMatch(null);
            }}
            className={cn(FIELD, "mt-1 w-full")}
          />
        </label>

        <label className="w-20">
          <span className="text-muted-foreground block text-xs">Qty</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className={cn(FIELD, "mt-1 w-full")}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-muted-foreground block text-xs">Aisle</span>
        <select
          value={aisle}
          onChange={(event) =>
            setAisle(AISLES.find((option) => option === event.target.value) ?? "other")
          }
          className={cn(FIELD, "mt-1 w-full")}
        >
          {AISLES.map((option) => (
            <option key={option} value={option}>
              {AISLE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      {match === null ? null : (
        <AlreadyListed match={match} amount={typedAmount} busy={busy} bump={bump} planId={planId} />
      )}

      {add.isError || bump.isError ? (
        <p role="alert" className="text-destructive mt-3 text-sm">
          That did not save — try again.
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy || name.trim() === "" || !validAmount}
          className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-md px-4 text-sm font-semibold focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setAmount("");
            setMatch(null);
          }}
          className="focus-visible:ring-ring text-muted-foreground min-h-11 px-2 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Where a match sits, when it is not among the rows still to buy.
 *
 * Raising the quantity of one of these would move a number the shopper cannot see, so the notice
 * says where the thing went and offers no bump.
 */
function whereItSits(match: ShopItem) {
  if (match.haveAlready) {
    return "under Already have";
  }

  if (match.purchased) {
    return "and already ticked off";
  }

  return null;
}

interface AlreadyListedProps {
  match: ShopItem;
  amount: number;
  planId: string;
  busy: boolean;
  bump: { mutate: (input: { planId: string; itemId: string; quantity: number }) => void };
}

/**
 * What the list already says about a name you just typed, and the offer to buy more of it.
 *
 * The button names the unit rather than a bare number, because the amount is being added to a
 * quantity the recipes measured — "Add 1" beside "2 lb" reads as one butter.
 */
function AlreadyListed({ match, amount, planId, busy, bump }: AlreadyListedProps) {
  // Read out of the item so the handler below closes over a number, not a nullable property.
  const onList = match.quantity;
  // `formatQuantity` answers a null quantity with the bare unit, which would read as
  // "Already on your list: tsp".
  const listed = onList === null ? "" : formatQuantity(onList, match.unit);

  const elsewhere = whereItSits(match);

  return (
    <p role="alert" className="bg-muted mt-3 flex items-center gap-3 rounded-md px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        Already on your list{listed === "" ? "" : `: ${listed}`}
        {elsewhere === null ? "" : `, ${elsewhere}`}
      </span>

      {onList === null || elsewhere !== null ? null : (
        <button
          type="button"
          disabled={busy}
          onClick={() => bump.mutate({ planId, itemId: match.id, quantity: onList + amount })}
          className="focus-visible:ring-ring text-primary min-h-11 shrink-0 font-semibold focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
        >
          Add {formatQuantity(amount, match.unit)}
        </button>
      )}
    </p>
  );
}

export function ShoppingList(props: Props) {
  // Narrowed before the interactive component, so the tap handler acts on a week that exists.
  if (!props.planned) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="font-display text-2xl font-semibold">Shopping list</h1>
        <WeekNav basePath="/shop" planId={props.planId} atDefault={props.atDefault} />
        <EmptyState>That week is not planned yet, so there is nothing to buy.</EmptyState>
      </main>
    );
  }

  // Keyed on the week: `List` seeds its state from props at mount, and a soft navigation between
  // two planned weeks would otherwise reuse the instance and keep the previous week's rows.
  return <List key={props.planId} {...props} />;
}

/** Where the hide-bought preference lives, so it is not re-set mid-aisle after a reload. */
const HIDE_BOUGHT_KEY = "provender.shop.hideBought";

function List({ planId, atDefault, budgetTarget, initialItems }: Props) {
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

  // Its own state, not the tick's `failed`: that one tells the shopper to tap the row again,
  // which toggles `purchased` and then clears the warning without anything having been deleted.
  const [notDeleted, setNotDeleted] = useState<Set<string>>(new Set());

  const remove = useMutation(
    trpc.shoppingList.deleteItem.mutationOptions({
      onError: (_error, variables) =>
        setNotDeleted((current) => new Set(current).add(variables.itemId)),
      onSuccess: (_data, variables) => {
        setItems((current) => current.filter((item) => item.id !== variables.itemId));
        setNotDeleted((current) => {
          const next = new Set(current);

          next.delete(variables.itemId);

          return next;
        });
      },
    }),
  );

  function onToggle(item: ShopItem) {
    const purchased = !item.purchased;

    // Applied before the request, so the row responds to the tap rather than to the network.
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, purchased } : row)));

    toggle.mutate({ planId, itemId: item.id, purchased });
  }

  function onAdded(item: ShopItem) {
    // Replaced rather than appended. `addItem` is an upsert, and the form's name check reads a
    // local snapshot — a second phone in the same household can have added it since this one
    // loaded, in which case the server returns the row that is already on screen.
    setItems((current) =>
      current.some((row) => row.id === item.id)
        ? current.map((row) => (row.id === item.id ? item : row))
        : [...current, item],
    );
  }

  function onBumped(itemId: string, quantity: number) {
    setItems((current) => current.map((row) => (row.id === itemId ? { ...row, quantity } : row)));
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
        <h1 className="font-display text-xl font-semibold">Shopping list</h1>
        <WeekNav basePath="/shop" planId={planId} atDefault={atDefault} />
        <p className="text-muted-foreground mt-0.5 text-sm">
          {left} left of {toBuy.length}
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
                <li key={item.id} className="border-border flex items-center border-b">
                  {/*
                    A real checkbox in a label, not a button with role="checkbox": the input
                    carries the semantics for free, and the label makes the whole row the target
                    rather than a small box inside it. Used one-handed while shopping, so
                    it is 56px tall — well over the 44px floor.
                  */}
                  <label
                    className={cn(
                      "flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3",
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

                  {/*
                    Outside the label on purpose: inside it, tapping the bin would also tick the
                    row. Only manual items have one — the service refuses to delete a plan item.
                  */}
                  {item.source === "manual" ? (
                    <button
                      type="button"
                      onClick={() => remove.mutate({ planId, itemId: item.id })}
                      aria-label={
                        notDeleted.has(item.id)
                          ? `Delete ${item.name} — not deleted, try again`
                          : `Delete ${item.name}`
                      }
                      className={cn(
                        "focus-visible:ring-ring flex min-h-11 min-w-11 shrink-0 items-center justify-center focus-visible:ring-3 focus-visible:outline-none",
                        notDeleted.has(item.id) ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  ) : null}
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

      <AddItem planId={planId} items={items} onAdded={onAdded} onBumped={onBumped} />

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

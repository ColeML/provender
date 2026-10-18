"use client";

import { useMutation } from "@tanstack/react-query";
import { slug } from "@server/lib/slug";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { FIELD } from "@/components/ui/field";
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
  /** Null when the household has set up no stores, or the item's store was deleted. */
  storeId: string | null;
}

/** A store the list can be split by, in the order the household walks them: primary first. */
export interface ShopStore {
  id: string;
  name: string;
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
  stores: ShopStore[];
}

/** The order the aisles are walked, matching the database enum. */
const AISLES = ["produce", "meat", "dairy", "bakery", "frozen", "pantry", "other"] as const;

type Aisle = (typeof AISLES)[number];

function toAisle(value: string): Aisle {
  return AISLES.find((option) => option === value) ?? "other";
}

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
 * background image fixes its color instead, and dark mode's `primary` is a pale teal that a
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
  storeId: string | null;
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
    storeId: row.storeId,
  };
}

interface AddItemProps {
  planId: string;
  stores: ShopStore[];
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
function AddItem({ planId, stores, items, onAdded, onBumped }: AddItemProps) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [aisle, setAisle] = useState<Aisle>("other");
  // Blank leaves it to the household's rules, which is right far more often than a guess here.
  const [store, setStore] = useState("");
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

  // A rebuild rewrites a plan row's quantity, so buying more of one lands on its own manual
  // "butter, extra" row. A manual row is the shopper's already and is raised in place.
  function buyMore(match: ShopItem, more: number) {
    if (match.source === "manual") {
      bump.mutate({ planId, itemId: match.id, quantity: (match.quantity ?? 0) + more });

      return;
    }

    const extraName = `${match.name}, extra`;
    const extra = items.find(
      (item) =>
        item.source === "manual" && slug(item.name) === slug(extraName) && item.unit === match.unit,
    );

    const quantity = (extra?.quantity ?? 0) + more;
    // Priced at the plan row's rate, so the footer's total counts what the extra row adds.
    const unitCost =
      match.estCost === null || match.quantity === null ? null : match.estCost / match.quantity;

    add.mutate({
      planId,
      itemName: extraName,
      quantity,
      unit: match.unit,
      category: toAisle(match.category),
      estCost: unitCost === null ? null : Math.round(unitCost * quantity * 100) / 100,
      // Bought alongside the row it tops up, not wherever a new "butter, extra" would be routed.
      storeId: match.storeId,
    });
  }
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
      storeId: store === "" ? null : store,
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
          onChange={(event) => setAisle(toAisle(event.target.value))}
          className={cn(FIELD, "mt-1 w-full")}
        >
          {AISLES.map((option) => (
            <option key={option} value={option}>
              {AISLE_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      {stores.length === 0 ? null : (
        <label className="mt-3 block">
          <span className="text-muted-foreground block text-xs">Store</span>
          <select
            value={store}
            onChange={(event) => setStore(event.target.value)}
            className={cn(FIELD, "mt-1 w-full")}
          >
            <option value="">Usual store</option>
            {stores.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {match === null ? null : (
        <AlreadyListed
          match={match}
          amount={typedAmount}
          busy={busy}
          onBuyMore={() => buyMore(match, typedAmount)}
        />
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
  busy: boolean;
  onBuyMore: () => void;
}

/**
 * What the list already says about a name you just typed, and the offer to buy more of it.
 *
 * The button names the unit rather than a bare number, because the amount is being added to a
 * quantity the recipes measured — "Add 1" beside "2 lb" reads as one butter.
 */
function AlreadyListed({ match, amount, busy, onBuyMore }: AlreadyListedProps) {
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
          onClick={onBuyMore}
          className="focus-visible:ring-ring text-primary min-h-11 shrink-0 font-semibold focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
        >
          Add {formatQuantity(amount, match.unit)}
        </button>
      )}
    </p>
  );
}

interface RowsProps {
  /** Ids whose last tick did not save. */
  failed: Set<string>;
  /** Ids whose delete did not go through. */
  notDeleted: Set<string>;
  onToggle: (item: ShopItem) => void;
  onDelete: (item: ShopItem) => void;
}

interface ItemRowProps {
  item: ShopItem;
  failed: boolean;
  notDeleted: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function ItemRow({ item, failed, notDeleted, onToggle, onDelete }: ItemRowProps) {
  return (
    <li className="border-border flex items-center border-b">
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
          onChange={onToggle}
          describedBy={failed ? `${item.id}-failed` : undefined}
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
          <ItemSubtitle item={item} failed={failed} />
        </span>

        <span
          className={cn(
            "shrink-0 text-right text-sm",
            item.purchased ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <span className="block font-mono">{formatQuantity(item.quantity, item.unit)}</span>
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
          onClick={onDelete}
          aria-label={
            notDeleted ? `Delete ${item.name} — not deleted, try again` : `Delete ${item.name}`
          }
          className={cn(
            "focus-visible:ring-ring flex min-h-11 min-w-11 shrink-0 items-center justify-center focus-visible:ring-3 focus-visible:outline-none",
            notDeleted ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

interface AislesProps {
  items: ShopItem[];
  /** 2 on a list read aisle by aisle, 3 when the aisles sit under a store. */
  level: 2 | 3;
  rows: RowsProps;
}

function Aisles({ items, level, rows }: AislesProps) {
  const Heading = level === 2 ? "h2" : "h3";

  return AISLES.map((aisle) => {
    const inAisle = items.filter((item) => item.category === aisle);

    if (inAisle.length === 0) {
      return null;
    }

    return (
      <section key={aisle}>
        <Heading className="bg-muted text-muted-foreground sticky top-0 px-4 py-1.5 text-xs font-semibold tracking-wide uppercase">
          {AISLE_LABELS[aisle] ?? aisle}
        </Heading>
        <ul>
          {inAisle.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              failed={rows.failed.has(item.id)}
              notDeleted={rows.notDeleted.has(item.id)}
              onToggle={() => rows.onToggle(item)}
              onDelete={() => rows.onDelete(item)}
            />
          ))}
        </ul>
      </section>
    );
  });
}

interface StoreGroup {
  id: string;
  name: string;
  items: ShopItem[];
  /** Not yet ticked off at this store. */
  left: number;
}

/**
 * The list split by store, or null to read it aisle by aisle as one shop.
 *
 * Null when no item on screen is bound for a store the household has, which covers a household
 * with no stores and a week built before it set any up. An item whose store was deleted gathers
 * under "Any store" with the rest of the unrouted ones.
 */
function storeGroups(stores: ShopStore[], items: ShopItem[]): StoreGroup[] | null {
  const known = new Set(stores.map((store) => store.id));
  const routed = (item: ShopItem) => item.storeId !== null && known.has(item.storeId);

  if (!items.some(routed)) {
    return null;
  }

  const groups = [
    ...stores.map((store) => ({
      id: store.id,
      name: store.name,
      items: items.filter((item) => item.storeId === store.id),
    })),
    // Underscores never come out of `slug`, so no store's id can collide with this one.
    { id: "__any", name: "Any store", items: items.filter((item) => !routed(item)) },
  ];

  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({ ...group, left: group.items.filter((item) => !item.purchased).length }));
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

function List({ planId, atDefault, budgetTarget, initialItems, stores }: Props) {
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
  const groups = storeGroups(stores, visible);
  const rows: RowsProps = {
    failed,
    notDeleted,
    onToggle,
    onDelete: (item) => remove.mutate({ planId, itemId: item.id }),
  };

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

      {groups === null ? (
        <Aisles items={visible} level={2} rows={rows} />
      ) : (
        groups.map((group) => (
          <section key={group.id} aria-labelledby={`store-${group.id}`}>
            <h2
              id={`store-${group.id}`}
              className="border-border flex items-baseline justify-between border-b px-4 pt-6 pb-2"
            >
              <span className="text-base font-semibold">{group.name}</span>
              <span className="text-muted-foreground text-sm font-normal">{group.left} left</span>
            </h2>
            <Aisles items={group.items} level={3} rows={rows} />
          </section>
        ))
      )}

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

      <AddItem
        planId={planId}
        stores={stores}
        items={items}
        onAdded={onAdded}
        onBumped={onBumped}
      />

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

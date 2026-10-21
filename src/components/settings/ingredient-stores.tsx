"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { CHECKBOX, FIELD } from "@/components/ui/field";
import { useTRPC } from "@/lib/trpc/client";

export interface SettingsRule {
  id: string;
  name: string;
  storeId: string;
  only: boolean;
}

export interface RuleDraft {
  names: string[];
  storeId: string;
  only: boolean;
}

/** "milk, buttermilk, hamburger buns" is three ingredients. */
export function splitNames(text: string) {
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

interface RuleFormProps {
  stores: { id: string; name: string }[];
  /** Rejects when nothing was saved, so the form keeps what was typed. */
  onAdd: (draft: RuleDraft) => Promise<void>;
  /** Called in the same commit that lists the new rules, so the form never closes on stale data. */
  onSaved: () => void;
  onCancel: () => void;
}

function RuleForm({ stores, onAdd, onSaved, onCancel }: RuleFormProps) {
  const [text, setText] = useState("");
  // Defaults to the first store, which is the main one when there is one.
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [only, setOnly] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const namesId = useId();
  const storeFieldId = useId();

  const names = splitNames(text);
  // The store picked may have been deleted since; fall back rather than send an id that is gone.
  const chosen = stores.some((store) => store.id === storeId) ? storeId : (stores[0]?.id ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (names.length === 0 || chosen === "" || pending) {
      return;
    }

    const submitted = text;

    setFailed(false);
    startTransition(async () => {
      try {
        await onAdd({ names, storeId: chosen, only });
        // The field stays editable while saving, so if it now holds the next ingredients, they
        // stay. State set after an `await` leaves the transition unless it is wrapped again.
        startTransition(() => {
          setText((current) => (current === submitted ? "" : current));
          onSaved();
        });
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={namesId} className="text-muted-foreground text-xs">
          Ingredients
        </label>
        <input
          id={namesId}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="milk, buttermilk, hamburger buns"
          autoComplete="off"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={storeFieldId} className="text-muted-foreground text-xs">
          From
        </label>
        <select
          id={storeFieldId}
          value={chosen}
          onChange={(event) => setStoreId(event.target.value)}
          className={FIELD}
        >
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={only}
          onChange={(event) => setOnly(event.target.checked)}
          className={CHECKBOX}
        />
        <span>
          Only buy {names.length > 1 ? "these" : "it"} here
          <span className="text-muted-foreground block text-xs">
            Otherwise it is the usual store, and the planner may pick another
          </span>
        </span>
      </label>

      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          Could not save that. Try again.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={names.length === 0 || pending}
          className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="focus-visible:ring-ring text-muted-foreground min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ruleKind(rule: SettingsRule) {
  return rule.only ? "Only here" : "Usually here";
}

interface RuleRowProps {
  rule: SettingsRule;
  onDelete: () => Promise<void>;
}

function RuleRow({ rule, onDelete }: RuleRowProps) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    setFailed(false);
    startTransition(async () => {
      try {
        await onDelete();
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block text-base">{rule.name}</span>
        {failed ? (
          <span role="alert" className="text-destructive block text-xs">
            Not deleted — try again
          </span>
        ) : (
          <span className="text-muted-foreground block text-xs">{ruleKind(rule)}</span>
        )}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Stop setting a store for ${rule.name}`}
        className="focus-visible:ring-ring text-muted-foreground flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40"
      >
        <Trash2 aria-hidden className="size-4" />
      </button>
    </li>
  );
}

interface RuleListProps {
  rules: SettingsRule[];
  stores: { id: string; name: string }[];
  onAdd: (draft: RuleDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Which ingredients come from which store, grouped by store, with no data layer so its behavior
 * is testable without tRPC.
 */
export function RuleList({ rules, stores, onAdd, onDelete }: RuleListProps) {
  const [adding, setAdding] = useState(false);

  if (stores.length === 0) {
    return <p className="mt-4 text-sm">Add a store first.</p>;
  }

  const groups = stores
    .map((store) => ({ store, rules: rules.filter((rule) => rule.storeId === store.id) }))
    .filter((group) => group.rules.length > 0);

  return (
    <>
      {groups.length === 0 ? (
        <p className="mt-4 text-sm">Nothing set yet — the planner picks for every ingredient.</p>
      ) : (
        groups.map((group) => (
          <section key={group.store.id} className="mt-4">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {group.store.name}
            </h3>
            <ul className="divide-border border-border mt-1 divide-y border-y">
              {group.rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} onDelete={() => onDelete(rule.id)} />
              ))}
            </ul>
          </section>
        ))
      )}

      {adding ? (
        <RuleForm
          stores={stores}
          onAdd={onAdd}
          onSaved={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        // Folded away, like "+ Add store": these are set up once and rarely touched.
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="focus-visible:ring-ring text-muted-foreground mt-2 min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          + Add ingredient
        </button>
      )}
    </>
  );
}

interface Props {
  rules: SettingsRule[];
  stores: { id: string; name: string }[];
}

/** Wires the list to tRPC. The page reads the rules, so a save refreshes it. */
export function IngredientStores({ rules, stores }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const set = useMutation(trpc.ingredientStores.set.mutationOptions());
  const remove = useMutation(trpc.ingredientStores.remove.mutationOptions());

  return (
    <RuleList
      rules={rules}
      stores={stores}
      onAdd={async ({ names, storeId, only }) => {
        // One rule per ingredient. Refreshed even when one fails, so the ones that saved show,
        // and trying again only re-sends what is already true of them.
        try {
          await Promise.all(names.map((name) => set.mutateAsync({ name, storeId, only })));
        } finally {
          router.refresh();
        }
      }}
      onDelete={async (ingredientId) => {
        await remove.mutateAsync({ ingredientId });
        router.refresh();
      }}
    />
  );
}

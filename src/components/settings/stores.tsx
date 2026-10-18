"use client";

import { slug } from "@server/lib/slug";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { CHECKBOX, FIELD } from "@/components/ui/field";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export interface SettingsStore {
  id: string;
  name: string;
  notes: string | null;
  primary: boolean;
}

export interface StoreDraft {
  name: string;
  notes: string | null;
  primary: boolean;
}

const BUTTON =
  "focus-visible:ring-ring min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40";

const ICON_BUTTON =
  "focus-visible:ring-ring text-muted-foreground flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none";

interface StoreFormProps {
  initial: StoreDraft;
  /** The ids already taken, so a duplicate name is caught before it is sent. */
  taken: string[];
  submitLabel: string;
  /** Rejects when nothing was saved, so the form keeps what was typed. */
  onSubmit: (draft: StoreDraft) => Promise<void>;
  /** Called in the same commit that shows the saved store, so the form never flashes stale. */
  onSaved?: () => void;
  onCancel?: () => void;
}

function StoreForm({ initial, taken, submitLabel, onSubmit, onSaved, onCancel }: StoreFormProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // A transition, as in the notes form: it stays pending through the page refresh, so the store
  // is never on screen nowhere between the save and the new list.
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const notesId = useId();

  const name = draft.name.trim();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name === "" || pending) {
      return;
    }

    if (taken.includes(slug(name))) {
      setError(`${name} is already one of your stores.`);
      return;
    }

    const submitted = draft;

    setError(null);
    startTransition(async () => {
      try {
        // Blank notes are trimmed to none by the service, so the form sends them as typed.
        await onSubmit({ ...submitted, name });
        // State set after an `await` leaves the transition unless it is wrapped again. The fields
        // stay editable while saving, so a next store typed in the meantime is kept.
        startTransition(() => {
          setDraft((current) => (current === submitted ? initial : current));
          onSaved?.();
        });
      } catch {
        setError("Could not save that store. Try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-muted-foreground text-xs">
          Store
        </label>
        <input
          id={nameId}
          type="text"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          placeholder="Aldi"
          autoComplete="off"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={notesId} className="text-muted-foreground text-xs">
          Notes for the planner
        </label>
        <textarea
          id={notesId}
          value={draft.notes ?? ""}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          placeholder="Cheapest for produce and staples. Skip it for meat."
          rows={2}
          className={cn(FIELD, "h-auto py-2")}
        />
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={draft.primary}
          onChange={(event) => setDraft({ ...draft, primary: event.target.checked })}
          className={CHECKBOX}
        />
        <span>
          Main store
          <span className="text-muted-foreground block text-xs">
            Anything without a better home goes here
          </span>
        </span>
      </label>

      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={name === "" || pending}
          className={cn(BUTTON, "bg-primary text-primary-foreground")}
        >
          {submitLabel}
        </button>
        {onCancel === undefined ? null : (
          <button type="button" onClick={onCancel} className={cn(BUTTON, "text-muted-foreground")}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

interface StoreRowProps {
  store: SettingsStore;
  taken: string[];
  onUpdate: (draft: StoreDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}

function StoreRow({ store, taken, onUpdate, onDelete }: StoreRowProps) {
  const [editing, setEditing] = useState(false);
  // Deleting takes the store's ingredient settings with it, so it asks once before doing it.
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (editing) {
    return (
      <li className="py-3">
        <StoreForm
          initial={{ name: store.name, notes: store.notes, primary: store.primary }}
          // Its own id is not taken from itself, so saving notes without a rename goes through.
          taken={taken.filter((id) => id !== store.id)}
          submitLabel="Save"
          onSubmit={onUpdate}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

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
    <li className="py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 py-2.5">
          <p className="text-base">
            {store.name}
            {store.primary ? (
              <span className="text-muted-foreground ml-2 text-xs">Main store</span>
            ) : null}
          </p>
          {store.notes === null ? null : (
            <p className="text-muted-foreground mt-0.5 text-sm">{store.notes}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${store.name}`}
          className={ICON_BUTTON}
        >
          <Pencil aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${store.name}`}
          className={ICON_BUTTON}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>

      {confirming ? (
        <div className="bg-muted mt-1 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Delete {store.name}? Ingredients set to it go back to the planner&apos;s choice.
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={cn(BUTTON, "text-destructive px-2")}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={cn(BUTTON, "text-muted-foreground px-2")}
          >
            Keep
          </button>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="text-destructive mt-1 text-sm">
          Could not delete {store.name}. Try again.
        </p>
      ) : null}
    </li>
  );
}

interface StoreListProps {
  stores: SettingsStore[];
  onCreate: (draft: StoreDraft) => Promise<void>;
  onUpdate: (id: string, draft: StoreDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EMPTY_DRAFT: StoreDraft = { name: "", notes: null, primary: false };

/** The household's stores, with no data layer so its behavior is testable without tRPC. */
export function StoreList({ stores, onCreate, onUpdate, onDelete }: StoreListProps) {
  const taken = stores.map((store) => store.id);

  return (
    <>
      {stores.length === 0 ? (
        <p className="mt-4 text-sm">No stores yet.</p>
      ) : (
        <ul className="divide-border border-border mt-4 divide-y border-y">
          {stores.map((store) => (
            <StoreRow
              key={store.id}
              store={store}
              taken={taken}
              onUpdate={(draft) => onUpdate(store.id, draft)}
              onDelete={() => onDelete(store.id)}
            />
          ))}
        </ul>
      )}

      <div className="mt-4">
        <StoreForm
          // Remounted when the first store arrives or the last one goes, so "Main store" is
          // ticked for the first store and only for it; a reset alone would keep the old default.
          key={stores.length === 0 ? "first" : "more"}
          initial={{ ...EMPTY_DRAFT, primary: stores.length === 0 }}
          taken={taken}
          submitLabel="Add store"
          onSubmit={onCreate}
        />
      </div>
    </>
  );
}

/** Wires the list to tRPC. The page reads the stores, so a save refreshes it. */
export function Stores({ stores }: { stores: SettingsStore[] }) {
  const trpc = useTRPC();
  const router = useRouter();
  const create = useMutation(trpc.stores.create.mutationOptions());
  const update = useMutation(trpc.stores.update.mutationOptions());
  const remove = useMutation(trpc.stores.remove.mutationOptions());

  return (
    <StoreList
      stores={stores}
      onCreate={async (draft) => {
        await create.mutateAsync(draft);
        router.refresh();
      }}
      onUpdate={async (storeId, draft) => {
        await update.mutateAsync({ storeId, ...draft });
        router.refresh();
      }}
      onDelete={async (storeId) => {
        await remove.mutateAsync({ storeId });
        router.refresh();
      }}
    />
  );
}

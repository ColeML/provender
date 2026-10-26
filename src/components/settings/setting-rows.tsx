"use client";

import type { Setting, SettingKind } from "@server/lib/settings";
import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type Ref, useEffect, useId, useRef, useState, useTransition } from "react";

import { splitNames } from "@/components/settings/ingredient-stores";
import { FIELD } from "@/components/ui/field";
import { useLongPress } from "@/hooks/use-long-press";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export type RowSetting = Pick<
  Setting,
  "key" | "label" | "kind" | "hint" | "placeholder" | "fallback"
>;

export interface SettingRowData {
  setting: RowSetting;
  value: string | undefined;
  /** A key the app does not know, labeled by its stored name. */
  raw?: boolean;
}

export const BUTTON =
  "focus-visible:ring-ring min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40";

export const PENCIL =
  "focus-visible:ring-ring text-muted-foreground flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none";

const INPUT_MODE: Partial<Record<SettingKind, "numeric" | "decimal">> = {
  count: "numeric",
  money: "decimal",
};

function shown(setting: RowSetting, value: string) {
  // Values written before the money check could already carry the sign.
  return setting.kind === "money" && !value.startsWith("$") ? `$${value}` : value;
}

interface SettingFormProps {
  setting: RowSetting;
  initial: string;
  /**
   * An empty value clears the setting. Rejects with the message to show when nothing was saved,
   * so the form keeps what was typed.
   */
  onSave: (value: string) => Promise<void>;
  /** Called in the same commit that shows the saved value, so the form never flashes stale. */
  onSaved: () => void;
  onCancel: () => void;
}

function SettingForm({ setting, initial, onSave, onSaved, onCancel }: SettingFormProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // A transition, as in the store form: it stays pending through the page refresh, so the old
  // value never shows between the save and the new page.
  const [pending, startTransition] = useTransition();
  const fieldId = useId();
  const hintId = useId();

  const value = draft.trim();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await onSave(value);
        startTransition(onSaved);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that. Try again.");
      }
    });
  }

  const fieldProps = {
    id: fieldId,
    value: draft,
    placeholder: setting.placeholder,
    "aria-describedby": setting.hint === undefined ? undefined : hintId,
    autoComplete: "off",
    // The pencil that opened the form is gone, so focus would otherwise fall back to the page.
    autoFocus: true,
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-muted-foreground text-xs">
          {setting.label}
        </label>
        {setting.kind === "longText" ? (
          <textarea
            {...fieldProps}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            className={cn(FIELD, "h-auto py-2")}
          />
        ) : (
          <input
            {...fieldProps}
            type="text"
            inputMode={INPUT_MODE[setting.kind]}
            onChange={(event) => setDraft(event.target.value)}
            className={FIELD}
          />
        )}
        {setting.hint === undefined ? null : (
          <p id={hintId} className="text-muted-foreground text-xs">
            {setting.hint}
          </p>
        )}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(BUTTON, "bg-primary text-primary-foreground")}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={cn(BUTTON, "text-muted-foreground")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface SettingRowProps extends SettingRowData {
  onSave: (value: string) => Promise<void>;
}

/** One setting, a ledger line until its pencil opens a one-field form in its place. */
export function SettingRow({ setting, value, raw = false, onSave }: SettingRowProps) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  // Set only by closing the form, so the page's first render never takes focus.
  const closedForm = useRef(false);

  useEffect(() => {
    if (!editing && closedForm.current) {
      closedForm.current = false;
      pencil.current?.focus();
    }
  }, [editing]);

  function close() {
    closedForm.current = true;
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <SettingForm
          setting={setting}
          initial={value ?? ""}
          onSave={onSave}
          onSaved={close}
          onCancel={close}
        />
      </li>
    );
  }

  const hasValue = value !== undefined && value !== "";
  // Unknown keys usually hold prose, which reads badly right-aligned in a narrow column.
  const stacked = setting.kind === "longText" || raw;
  const display = hasValue ? shown(setting, value) : (setting.fallback ?? "Not set");

  return (
    <li className="flex items-start gap-2 py-2">
      <div
        className={cn(
          "flex min-w-0 flex-1 gap-x-4 gap-y-0.5 py-2.5",
          stacked ? "flex-col" : "flex-wrap justify-between",
        )}
      >
        <span className={raw ? "text-muted-foreground font-mono text-sm" : "text-base"}>
          {setting.label}
        </span>
        <span
          className={cn(
            "min-w-0 break-words",
            stacked ? "whitespace-pre-line" : "ml-auto text-right",
            hasValue ? "text-base" : "text-muted-foreground text-sm",
          )}
        >
          {display}
        </span>
      </div>

      <button
        ref={pencil}
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${setting.label}`}
        className={PENCIL}
      >
        <Pencil aria-hidden className="size-4" />
      </button>
    </li>
  );
}

type Open = { kind: "add" } | { kind: "edit"; index: number } | null;

/** The names not already in `taken`, ignoring case, which it then holds too. */
function unseen(names: string[], taken: Set<string>) {
  return names.filter((name) => {
    const folded = name.toLowerCase();
    const fresh = !taken.has(folded);

    taken.add(folded);

    return fresh;
  });
}

interface ListItemButtonProps {
  item: string;
  hintId: string;
  onEdit: () => void;
  ref: Ref<HTMLButtonElement>;
}

/** One item's text. A component of its own because each row needs its own hook. */
function ListItemButton({ item, hintId, onEdit, ref }: ListItemButtonProps) {
  const press = useLongPress(onEdit);

  return (
    <button
      ref={ref}
      type="button"
      aria-describedby={hintId}
      {...press}
      className={cn(
        press.className,
        "focus-visible:ring-ring min-h-11 w-full py-2.5 text-left text-base break-words focus-visible:ring-3 focus-visible:outline-none",
      )}
    >
      {item}
    </button>
  );
}

/** A comma-separated setting, one ruled line per item, like the Where to buy list. */
export function ListSettingRow({ setting, value, onSave }: SettingRowProps) {
  const [open, setOpen] = useState<Open>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failedDelete, setFailedDelete] = useState<number | null>(null);
  // Shared by every change, so a second change never builds on the list the first replaces.
  const [pending, startTransition] = useTransition();
  const labelId = useId();
  const fieldId = useId();
  const hintId = useId();
  const editHintId = useId();
  const itemButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const removeButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // Set only by closing a form, so the page's first render never takes focus.
  const closedForm = useRef<Open>(null);
  const deleted = useRef<number | null>(null);

  const items = splitNames(value ?? "");
  const noun = setting.label.toLowerCase();

  useEffect(() => {
    const index = deleted.current;

    deleted.current = null;

    if (index === null) {
      return;
    }

    (
      removeButtons.current[index] ??
      removeButtons.current[index - 1] ??
      addButton.current
    )?.focus();
  }, [value]);

  useEffect(() => {
    // The control that opened the form is gone, so focus would otherwise fall back to the page.
    if (open !== null) {
      const length = field.current?.value.length ?? 0;

      field.current?.focus();
      field.current?.setSelectionRange(length, length);

      return;
    }

    const closed = closedForm.current;

    closedForm.current = null;

    if (closed?.kind === "add") {
      addButton.current?.focus();
    } else if (closed?.kind === "edit") {
      // An edit that only repeats another item removes its row.
      (
        itemButtons.current[closed.index] ??
        itemButtons.current[closed.index - 1] ??
        addButton.current
      )?.focus();
    }
  }, [open]);

  function show(next: Open, text: string) {
    setOpen(next);
    setDraft(text);
    setError(null);
    setFailedDelete(null);
  }

  function close() {
    closedForm.current = open;
    show(null, "");
  }

  function save(next: string[]) {
    setError(null);
    startTransition(async () => {
      try {
        await onSave(next.join(", "));
        startTransition(close);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that. Try again.");
      }
    });
  }

  function remove(index: number) {
    if (pending) {
      return;
    }

    // An open edit names its item by position, which this delete is about to shift.
    if (open?.kind === "edit") {
      show(null, "");
    }

    setFailedDelete(null);
    deleted.current = index;
    startTransition(async () => {
      try {
        await onSave(items.filter((_, at) => at !== index).join(", "));
      } catch {
        deleted.current = null;
        setFailedDelete(index);
      }
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending || open === null) {
      return;
    }

    const typed = splitNames(draft);

    if (open.kind === "add") {
      const added = unseen(typed, new Set(items.map((item) => item.toLowerCase())));

      if (added.length === 0) {
        close();
      } else {
        save([...items, ...added]);
      }

      return;
    }

    const { index } = open;

    // A blank edit keeps the item; deleting is the trash button's job.
    if (typed.length === 0 || (typed.length === 1 && typed[0] === items[index])) {
      close();
      return;
    }

    const others = items.filter((_, at) => at !== index);
    const replacement = unseen(typed, new Set(others.map((item) => item.toLowerCase())));

    save([...items.slice(0, index), ...replacement, ...items.slice(index + 1)]);
  }

  const form = (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-3", open?.kind === "add" ? "mt-3" : "py-3")}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-muted-foreground text-xs">
          {open?.kind === "edit" ? `Edit ${setting.label}` : setting.label}
        </label>
        <input
          id={fieldId}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              close();
            }
          }}
          placeholder={setting.placeholder}
          aria-describedby={setting.hint === undefined ? undefined : hintId}
          autoComplete="off"
          ref={field}
          className={FIELD}
        />
        {setting.hint === undefined ? null : (
          <p id={hintId} className="text-muted-foreground text-xs">
            {setting.hint}
          </p>
        )}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={cn(BUTTON, "bg-primary text-primary-foreground")}
        >
          Save
        </button>
        <button type="button" onClick={close} className={cn(BUTTON, "text-muted-foreground")}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <li className="py-2">
      {/* The padding is a pencil's width plus its gap, so None lines up with the other values. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 pr-13">
        <span id={labelId} className="text-base">
          {setting.label}
        </span>
        {items.length === 0 ? <span className="text-muted-foreground text-sm">None</span> : null}
      </div>

      {items.length === 0 ? null : (
        <>
          <p id={editHintId} className="sr-only">
            Long press or press Enter to edit.
          </p>
          <ul aria-labelledby={labelId} className="divide-border border-border divide-y border-y">
            {items.map((item, index) => (
              // Index keys: a stored list can name the same item twice, and a position is the
              // identity an edit or delete acts on.
              <li key={index} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {open?.kind === "edit" && open.index === index ? (
                    form
                  ) : (
                    <ListItemButton
                      item={item}
                      hintId={editHintId}
                      onEdit={() => show({ kind: "edit", index }, item)}
                      ref={(element) => {
                        itemButtons.current[index] = element;
                      }}
                    />
                  )}
                  {failedDelete === index ? (
                    <p role="alert" className="text-destructive pb-2 text-xs">
                      Not deleted — try again
                    </p>
                  ) : null}
                </div>
                <button
                  ref={(element) => {
                    removeButtons.current[index] = element;
                  }}
                  type="button"
                  onClick={() => remove(index)}
                  aria-disabled={pending}
                  aria-label={`Remove ${item} from ${noun}`}
                  className={cn(PENCIL, "aria-disabled:opacity-40")}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open?.kind === "add" ? (
        form
      ) : (
        <button
          ref={addButton}
          type="button"
          onClick={() => show({ kind: "add" }, "")}
          aria-label={`Add to ${noun}`}
          className="focus-visible:ring-ring text-muted-foreground mt-1 min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          + Add
        </button>
      )}
    </li>
  );
}

interface SettingRowsProps {
  rows: SettingRowData[];
  /** The id to focus when clearing the last row takes this list off the page. */
  focusWhenEmpty?: string;
}

/** Wires each row to tRPC. The page reads the settings, so a save refreshes it. */
export function SettingRows({ rows, focusWhenEmpty }: SettingRowsProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const set = useMutation(trpc.config.set.mutationOptions());
  const clear = useMutation(trpc.config.delete.mutationOptions());
  const list = useRef<HTMLUListElement>(null);
  // An unknown key's row disappears once it is cleared, taking the focused form with it.
  const cleared = useRef<{ key: string; index: number } | null>(null);

  useEffect(() => {
    const gone = cleared.current;

    cleared.current = null;

    if (gone === null || rows.some((row) => row.setting.key === gone.key)) {
      return;
    }

    const items = list.current?.children;

    (items?.[gone.index] ?? items?.[gone.index - 1])?.querySelector("button")?.focus();
  }, [rows]);

  useEffect(
    () => () => {
      if (cleared.current !== null && focusWhenEmpty !== undefined) {
        document.getElementById(focusWhenEmpty)?.focus();
      }
    },
    [focusWhenEmpty],
  );

  return (
    <ul ref={list} className="divide-border border-border mt-2 divide-y border-y">
      {rows.map((row, index) => {
        const Row = row.setting.kind === "list" ? ListSettingRow : SettingRow;

        return (
          <Row
            key={row.setting.key}
            {...row}
            onSave={async (value) => {
              const key = row.setting.key;

              try {
                await (value === "" ? clear.mutateAsync({ key }) : set.mutateAsync({ key, value }));
              } catch (error) {
                // The service's message names the setting and what it accepts; anything else is
                // not the household's to fix.
                if (isTRPCClientError(error) && error.data?.code === "BAD_REQUEST") {
                  throw new Error(error.message);
                }

                throw new Error(`Could not save ${row.setting.label}. Try again.`);
              }

              if (value === "") {
                cleared.current = { key, index };
              }

              router.refresh();
            }}
          />
        );
      })}
    </ul>
  );
}

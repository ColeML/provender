"use client";

import type { Setting } from "@server/lib/settings";
import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { FIELD } from "@/components/ui/field";
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

const BUTTON =
  "focus-visible:ring-ring min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:ring-3 focus-visible:outline-none disabled:opacity-40";

const INPUT_MODE = { count: "numeric", money: "decimal" } as const;

function shown(setting: RowSetting, value: string) {
  // Values written before the money check could already carry the sign.
  return setting.kind === "money" && !value.startsWith("$") ? `$${value}` : value;
}

interface SettingFormProps {
  setting: RowSetting;
  initial: string;
  /** Rejects with the message to show when nothing was saved, so the form keeps what was typed. */
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

    if (value === "" || pending) {
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
            inputMode={setting.kind === "text" ? undefined : INPUT_MODE[setting.kind]}
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
          disabled={value === "" || pending}
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
        className="focus-visible:ring-ring text-muted-foreground flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
      >
        <Pencil aria-hidden className="size-4" />
      </button>
    </li>
  );
}

/** Wires each row to tRPC. The page reads the settings, so a save refreshes it. */
export function SettingRows({ rows }: { rows: SettingRowData[] }) {
  const trpc = useTRPC();
  const router = useRouter();
  const set = useMutation(trpc.config.set.mutationOptions());

  return (
    <ul className="divide-border border-border mt-2 divide-y border-y">
      {rows.map((row) => (
        <SettingRow
          key={row.setting.key}
          {...row}
          onSave={async (value) => {
            try {
              await set.mutateAsync({ key: row.setting.key, value });
            } catch (error) {
              // The service's message names the setting and what it accepts; anything else is
              // not the household's to fix.
              if (isTRPCClientError(error) && error.data?.code === "BAD_REQUEST") {
                throw new Error(error.message);
              }

              throw new Error(`Could not save ${row.setting.label}. Try again.`);
            }

            router.refresh();
          }}
        />
      ))}
    </ul>
  );
}

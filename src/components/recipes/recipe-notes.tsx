"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type Ref, useEffect, useId, useRef, useState, useTransition } from "react";

import { BUTTON, PENCIL } from "@/components/settings/setting-rows";
import { FIELD } from "@/components/ui/field";
import { useLongPress } from "@/hooks/use-long-press";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

type Open = { kind: "add" } | { kind: "edit"; index: number } | null;

const SAVE_FAILED = "Could not save that note. Try again.";

function short(note: string) {
  return note.length > 40 ? `${note.slice(0, 40)}…` : note;
}

interface NoteButtonProps {
  note: string;
  hintId: string;
  onEdit: () => void;
  ref: Ref<HTMLButtonElement>;
}

/** One note's text. A component of its own because each row needs its own hook. */
function NoteButton({ note, hintId, onEdit, ref }: NoteButtonProps) {
  const press = useLongPress(onEdit);

  return (
    <button
      ref={ref}
      type="button"
      aria-describedby={hintId}
      {...press}
      className={cn(
        press.className,
        "focus-visible:ring-ring min-h-11 w-full py-2.5 text-left text-base break-words whitespace-pre-line focus-visible:ring-3 focus-visible:outline-none",
      )}
    >
      {note}
    </button>
  );
}

interface NoteFormProps {
  label: string;
  draft: string;
  error: string | null;
  pending: boolean;
  field: Ref<HTMLTextAreaElement>;
  onDraft: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function NoteForm({
  label,
  draft,
  error,
  pending,
  field,
  onDraft,
  onSubmit,
  onCancel,
}: NoteFormProps) {
  const fieldId = useId();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 py-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-muted-foreground text-xs">
          {label}
        </label>
        <textarea
          id={fieldId}
          ref={field}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onCancel();
            }
          }}
          rows={3}
          className={cn(FIELD, "h-auto py-2")}
        />
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

interface NoteListProps {
  notes: string[];
  /** Saves the whole list. Rejects when nothing was saved, so the form keeps what was typed. */
  onSave: (next: string[]) => Promise<void>;
}

/** The household's notes on a recipe, one ruled row each, with no data layer of its own. */
export function NoteList({ notes, onSave }: NoteListProps) {
  const [open, setOpen] = useState<Open>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failedDelete, setFailedDelete] = useState<number | null>(null);
  // Shared by every change, so a second change never builds on the list the first replaces.
  const [pending, startTransition] = useTransition();
  const hintId = useId();
  const noteButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Set only by closing a form, so the page's first render never takes focus.
  const closedForm = useRef<Open>(null);
  const deleted = useRef<number | null>(null);

  useEffect(() => {
    const index = deleted.current;

    deleted.current = null;

    if (index === null) {
      return;
    }

    (noteButtons.current[index] ?? noteButtons.current[index - 1] ?? addButton.current)?.focus();
  }, [notes]);

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
      noteButtons.current[closed.index]?.focus();
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
        await onSave(next);
        startTransition(close);
      } catch {
        setError(SAVE_FAILED);
      }
    });
  }

  function submit() {
    if (pending || open === null) {
      return;
    }

    const text = draft.trim();

    if (open.kind === "add") {
      if (text === "") {
        close();
      } else {
        save([...notes, text]);
      }

      return;
    }

    if (text === "" || text === notes[open.index]) {
      close();
    } else {
      save(notes.map((note, at) => (at === open.index ? text : note)));
    }
  }

  function remove(index: number) {
    if (pending) {
      return;
    }

    // An open edit names its note by position, which this delete is about to shift.
    if (open?.kind === "edit") {
      show(null, "");
    }

    setFailedDelete(null);
    deleted.current = index;
    startTransition(async () => {
      try {
        await onSave(notes.filter((_, at) => at !== index));
      } catch {
        deleted.current = null;
        setFailedDelete(index);
      }
    });
  }

  const form = (label: string) => (
    <NoteForm
      label={label}
      draft={draft}
      error={error}
      pending={pending}
      field={field}
      onDraft={setDraft}
      onSubmit={submit}
      onCancel={close}
    />
  );

  return (
    <section aria-labelledby="notes" className="mt-6">
      <h2 id="notes" className="text-muted-foreground text-xs">
        Notes
      </h2>

      {notes.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-sm">No notes</p>
      ) : (
        <>
          <p id={hintId} className="sr-only">
            Long press or press Enter to edit.
          </p>
          <ul
            aria-labelledby="notes"
            className="divide-border border-border mt-1 divide-y border-y"
          >
            {notes.map((note, index) => (
              // Index keys: a position is the identity an edit or delete acts on.
              <li key={index} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {open?.kind === "edit" && open.index === index ? (
                    form("Edit note")
                  ) : (
                    <NoteButton
                      note={note}
                      hintId={hintId}
                      onEdit={() => show({ kind: "edit", index }, note)}
                      ref={(element) => {
                        noteButtons.current[index] = element;
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
                  type="button"
                  onClick={() => remove(index)}
                  aria-disabled={pending}
                  aria-label={`Remove note: ${short(note)}`}
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
        form("New note")
      ) : (
        <button
          ref={addButton}
          type="button"
          onClick={() => show({ kind: "add" }, "")}
          aria-label="Add a note"
          className="focus-visible:ring-ring text-muted-foreground mt-1 min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"
        >
          + Add
        </button>
      )}
    </section>
  );
}

export function RecipeNotes({ recipeId, notes }: { recipeId: string; notes: string[] }) {
  const trpc = useTRPC();
  const router = useRouter();
  const save = useMutation(
    trpc.recipes.setNotes.mutationOptions({ scope: { id: `notes-${recipeId}` } }),
  );

  return (
    <NoteList
      notes={notes}
      onSave={async (next) => {
        await save.mutateAsync({ recipeId, notes: next });
        router.refresh();
      }}
    />
  );
}

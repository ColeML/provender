"use client";

import type { WeekNote } from "@server/services/week-notes";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useTRPC } from "@/lib/trpc/client";

import { DayOptions, FIELD } from "./add-note";

/** Only the fields that changed. */
export interface NoteChange {
  date?: string | null;
  body?: string;
}

/**
 * The note whose edit field was removed while it had focus, so its edit button takes focus when it
 * mounts in the same commit. Module-level rather than state, since a note moved to another day
 * remounts under that day's heading and this instance does not survive.
 */
let focusOnMount: string | null = null;

interface NoteItemProps {
  id: string;
  body: string;
  date: string | null;
  dates: string[];
  /** Rejects when the change was not saved, so the editor keeps what was typed. */
  onSave: (change: NoteChange) => Promise<void>;
  onDelete: () => Promise<void>;
}

/** One note, edited in place, with no data layer so its behavior is testable without tRPC. */
export function NoteItem({ id, body, date, dates, onSave, onDelete }: NoteItemProps) {
  const [draft, setDraft] = useState<{ body: string; date: string } | null>(null);
  const [failed, setFailed] = useState<"save" | "delete" | null>(null);
  // A transition for the same reason as the add row: it stays pending through the page refresh,
  // so the old text is not shown again in the moment between the save and the new list.
  const [pending, startTransition] = useTransition();

  function save() {
    if (draft === null || pending) {
      return;
    }

    const change: NoteChange = {};
    const text = draft.body.trim();
    const day = draft.date === "" ? null : draft.date;

    // A blank edit keeps the old text, so clearing the field cannot store an empty note.
    if (text !== "" && text !== body) {
      change.body = text;
    }

    if (day !== date) {
      change.date = day;
    }

    if (change.body === undefined && change.date === undefined) {
      setDraft(null);
      return;
    }

    setFailed(null);
    startTransition(async () => {
      try {
        await onSave(change);
        startTransition(() => setDraft(null));
      } catch {
        setFailed("save");
      }
    });
  }

  function remove() {
    setFailed(null);
    startTransition(async () => {
      try {
        await onDelete();
      } catch {
        setFailed("delete");
      }
    });
  }

  function cancelOnEscape(event: React.KeyboardEvent) {
    if (event.key === "Escape" && !pending) {
      setFailed(null);
      setDraft(null);
    }
  }

  // Moving between the text and the day stays inside the form, so only leaving it saves.
  function saveOnLeave(event: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.form?.contains(event.relatedTarget)
    ) {
      return;
    }

    save();
  }

  if (draft !== null) {
    return (
      <form
        aria-label="Edit note"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-2 py-2"
      >
        <input
          // Enter and Escape close the editor with focus still here. Leaving the field, or moving
          // on while a save was in flight, does not, so focus stays where the household put it.
          ref={(input) => () => {
            if (document.activeElement === input) {
              focusOnMount = id;
              // Only the commit that removed the field may use it.
              queueMicrotask(() => {
                focusOnMount = null;
              });
            }
          }}
          aria-label="Note"
          type="text"
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          onKeyDown={cancelOnEscape}
          onBlur={saveOnLeave}
          readOnly={pending}
          // The household just tapped this note to edit it.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          className={FIELD}
        />
        <select
          aria-label="Day"
          value={draft.date}
          onChange={(event) => setDraft({ ...draft, date: event.target.value })}
          onKeyDown={cancelOnEscape}
          onBlur={saveOnLeave}
          disabled={pending}
          className={FIELD}
        >
          <DayOptions dates={dates} />
        </select>

        {failed === "save" ? (
          <p role="alert" className="text-destructive text-sm">
            Could not save that note. Try again.
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className={pending ? "opacity-60" : undefined}>
      <div className="flex items-start gap-2">
        <button
          ref={(button) => {
            if (button !== null && focusOnMount === id) {
              focusOnMount = null;
              button.focus();
            }
          }}
          type="button"
          aria-label={`Edit note: ${body}`}
          onClick={() => {
            setFailed(null);
            setDraft({ body, date: date ?? "" });
          }}
          disabled={pending}
          className="focus-visible:ring-ring min-h-11 min-w-0 flex-1 rounded-lg py-3 text-left text-base break-words focus-visible:ring-3 focus-visible:outline-none"
        >
          {body}
        </button>
        <button
          type="button"
          aria-label={`Delete note: ${body}`}
          onClick={remove}
          disabled={pending}
          className="text-muted-foreground hover:text-destructive focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>

      {failed === "delete" ? (
        <p role="alert" className="text-destructive pb-3 text-sm">
          Could not delete that note. Try again.
        </p>
      ) : null}
    </div>
  );
}

interface Props {
  weekId: string;
  dates: string[];
  note: Pick<WeekNote, "id" | "date" | "body">;
}

/** Wires one note to tRPC. The page lists the notes, so a change refreshes it. */
export function WeekNoteItem({ weekId, dates, note }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const update = useMutation(trpc.weekNotes.update.mutationOptions());
  const remove = useMutation(trpc.weekNotes.remove.mutationOptions());

  return (
    <NoteItem
      id={note.id}
      body={note.body}
      date={note.date}
      dates={dates}
      onSave={async (change) => {
        await update.mutateAsync({ weekId, noteId: note.id, ...change });
        router.refresh();
      }}
      onDelete={async () => {
        await remove.mutateAsync({ weekId, noteId: note.id });
        router.refresh();
      }}
    />
  );
}

"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { useTRPC } from "@/lib/trpc/client";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

const FIELD =
  "border-muted-foreground bg-background focus-visible:ring-ring placeholder:text-muted-foreground h-11 rounded-lg border px-3 text-base focus-visible:ring-3 focus-visible:outline-none";

/** `Mon 12`. en-US puts the day number first when asked for both parts at once. */
function dayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);

  return `${WEEKDAY.format(parsed)} ${parsed.getUTCDate()}`;
}

interface NoteFormProps {
  /** The week's seven dates, which are the only days a note can name. */
  dates: string[];
  /** Rejects when the note was not saved, so the form keeps what was typed. */
  onAdd: (note: { date: string | null; body: string }) => Promise<void>;
}

/** The add row, with no data layer, so its behavior is testable without tRPC. */
export function NoteForm({ dates, onAdd }: NoteFormProps) {
  const [body, setBody] = useState("");
  const [date, setDate] = useState("");
  const [failed, setFailed] = useState(false);
  // A transition rather than a flag, so the form stays pending through the page refresh `onAdd`
  // starts and clears in the same commit that lists the note. Cleared earlier, the note is on
  // screen nowhere for a moment, and the household types it again.
  const [pending, startTransition] = useTransition();
  const noteId = useId();
  const dayId = useId();

  const blank = body.trim() === "";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (blank || pending) {
      return;
    }

    const submitted = { body, date };

    setFailed(false);
    startTransition(async () => {
      try {
        await onAdd({ date: date === "" ? null : date, body });
        // State set after an `await` leaves the transition unless it is wrapped again. Only what
        // was saved is cleared: the field stays editable while saving, so it may hold the next note.
        startTransition(() => {
          setBody((current) => (current === submitted.body ? "" : current));
          setDate((current) => (current === submitted.date ? "" : current));
        });
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-[1fr_auto] gap-x-2 gap-y-3">
      <div className="col-span-2 flex flex-col gap-1">
        <label htmlFor={noteId} className="text-muted-foreground text-xs">
          Note
        </label>
        <input
          id={noteId}
          type="text"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Soccer until 7 Thursday"
          autoComplete="off"
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={dayId} className="text-muted-foreground text-xs">
          Day
        </label>
        <select
          id={dayId}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={FIELD}
        >
          <option value="">Any day</option>
          {dates.map((day) => (
            <option key={day} value={day}>
              {dayLabel(day)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={blank || pending}
        className="bg-primary text-primary-foreground h-11 self-end rounded-lg px-5 text-sm font-medium disabled:opacity-40"
      >
        Add
      </button>

      {failed ? (
        <p role="alert" className="text-destructive col-span-2 text-sm">
          Could not save that note. Try again.
        </p>
      ) : null}
    </form>
  );
}

interface Props {
  weekId: string;
  dates: string[];
}

/** Wires the add row to tRPC. The page lists the notes, so a save refreshes it. */
export function AddNote({ weekId, dates }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const add = useMutation(trpc.weekNotes.add.mutationOptions());

  return (
    <NoteForm
      dates={dates}
      onAdd={async (note) => {
        await add.mutateAsync({ weekId, ...note });
        router.refresh();
      }}
    />
  );
}

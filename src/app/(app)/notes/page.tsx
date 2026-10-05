import { householdForSession } from "@server/auth/household";
import { isoWeekFor, parseIsoWeek, shiftIsoWeek, weekDates } from "@server/lib/iso-week";
import { listWeekNotes, type WeekNote } from "@server/services/week-notes";
import { redirect } from "next/navigation";

import { AddNote } from "@/components/notes/add-note";
import { EmptyState } from "@/components/ui/empty-state";
import { WeekNav } from "@/components/ui/week-nav";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Notes — Provender" };

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

function utcDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * `Oct 12–18`, or `Sep 28–Oct 4` when the week spans two months. A week outside `currentYear`
 * names its year, `Oct 18–24, 2027`, and one spanning two years names both.
 */
function weekRange(dates: string[], currentYear: number) {
  const first = dates.at(0);
  const last = dates.at(-1);

  if (first === undefined || last === undefined) {
    return "";
  }

  const start = utcDate(first);
  const end = utcDate(last);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const endLabel =
    start.getUTCMonth() === end.getUTCMonth() ? String(end.getUTCDate()) : MONTH_DAY.format(end);

  if (startYear !== endYear) {
    return `${MONTH_DAY.format(start)}, ${startYear}–${endLabel}, ${endYear}`;
  }

  if (startYear !== currentYear) {
    return `${MONTH_DAY.format(start)}–${endLabel}, ${endYear}`;
  }

  return `${MONTH_DAY.format(start)}–${endLabel}`;
}

export default async function Notes({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const { week } = await searchParams;
  // The same UTC clock `/plan` reads, so the two tabs move to a new week at the same moment.
  const today = new Date();
  const currentWeek = isoWeekFor(today.toISOString().slice(0, 10));
  const nextWeek = shiftIsoWeek(currentWeek, 1) ?? currentWeek;
  // `?week=` is user-editable, so a typo falls back to the default view rather than an error.
  const weekId = week !== undefined && parseIsoWeek(week) !== undefined ? week : nextWeek;
  const parsedWeek = parseIsoWeek(weekId);
  const dates = parsedWeek === undefined ? [] : weekDates(parsedWeek);
  const isNextWeek = weekId === nextWeek;

  const notes = await listWeekNotes(householdId, weekId);

  return (
    <main className="mx-auto max-w-2xl p-4">
      {isNextWeek ? <p className="text-accent text-sm font-medium">Next week</p> : null}

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold">
          Notes for {weekRange(dates, today.getUTCFullYear())}
        </h1>
        <WeekNav
          basePath="/notes"
          planId={weekId}
          atDefault={isNextWeek}
          showWeek={false}
          resetLabel="Next week"
        />
      </div>

      {/* Keyed on the week so a day picked on one week is not carried to the next. */}
      <AddNote key={weekId} weekId={weekId} dates={dates} />

      {notes.length === 0 ? (
        <EmptyState>Nothing noted for this week.</EmptyState>
      ) : (
        <NoteGroups notes={notes} dates={dates} />
      )}
    </main>
  );
}

function NoteGroups({ notes, dates }: { notes: WeekNote[]; dates: string[] }) {
  const groups = [null, ...dates]
    .map((date) => ({ date, notes: notes.filter((note) => note.date === date) }))
    .filter((group) => group.notes.length > 0);

  return (
    <div className="mt-6 space-y-6">
      {groups.map((group) => {
        const headingId = `notes-${group.date ?? "any"}`;

        return (
          <section key={headingId} aria-labelledby={headingId}>
            <h2 id={headingId} className="text-muted-foreground text-xs">
              {group.date === null
                ? "Any day"
                : `${WEEKDAY.format(utcDate(group.date))}, ${MONTH_DAY.format(utcDate(group.date))}`}
            </h2>

            <ul className="divide-border border-border mt-1 divide-y border-t">
              {group.notes.map((note) => (
                <li key={note.id} className="py-3 text-base break-words">
                  {note.body}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

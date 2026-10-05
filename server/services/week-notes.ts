import "server-only";

import { randomUUID } from "node:crypto";

import { db as defaultDb, schema, type Database } from "@server/db";
import { parseIsoWeek, weekDates } from "@server/lib/iso-week";
import { and, asc, eq, sql } from "drizzle-orm";

/** Notes the household writes about a week, usually before it is planned. */

export type WeekNote = typeof schema.weekNotes.$inferSelect;

export interface WeekNoteInput {
  date?: string | null;
  body: string;
}

export class InvalidWeekIdError extends Error {
  constructor(readonly weekId: string) {
    super(`${weekId} is not an ISO week id, e.g. 2026-W42`);
  }
}

export class DateOutsideWeekError extends Error {
  constructor(
    readonly date: string,
    readonly weekId: string,
  ) {
    super(`${date} is not a day of ${weekId}`);
  }
}

export class BlankNoteError extends Error {
  constructor() {
    super("A note needs some text");
  }
}

function datesOf(weekId: string) {
  const week = parseIsoWeek(weekId);

  if (!week) {
    throw new InvalidWeekIdError(weekId);
  }

  return weekDates(week);
}

/** Any-day notes first, then Monday to Sunday, oldest first within a day. */
export async function listWeekNotes(
  householdId: string,
  weekId: string,
  db: Database = defaultDb,
): Promise<WeekNote[]> {
  datesOf(weekId);

  return db
    .select()
    .from(schema.weekNotes)
    .where(and(eq(schema.weekNotes.householdId, householdId), eq(schema.weekNotes.weekId, weekId)))
    .orderBy(
      // Postgres sorts nulls last in ascending order, and a null date is "any day", which leads.
      sql`${schema.weekNotes.date} asc nulls first`,
      asc(schema.weekNotes.createOrder),
    );
}

export async function addWeekNote(
  householdId: string,
  weekId: string,
  input: WeekNoteInput,
  db: Database = defaultDb,
): Promise<WeekNote> {
  const dates = datesOf(weekId);
  const body = input.body.trim();
  const date = input.date ?? null;

  if (body === "") {
    throw new BlankNoteError();
  }

  // Membership in the week's own dates also refuses a string that is not a calendar date.
  if (date !== null && !dates.includes(date)) {
    throw new DateOutsideWeekError(date, weekId);
  }

  const [note] = await db
    .insert(schema.weekNotes)
    .values({ householdId, id: randomUUID(), weekId, date, body })
    .returning();

  if (!note) {
    throw new Error("Inserting a week note returned no row");
  }

  return note;
}

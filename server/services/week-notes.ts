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

/** A field left out is kept as it is. A note's week is fixed, so it is not a field. */
export interface WeekNoteUpdate {
  date?: string | null;
  body?: string;
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

export class WeekNoteNotFoundError extends Error {
  constructor(
    readonly weekId: string,
    readonly noteId: string,
  ) {
    super(`No note ${noteId} in ${weekId}`);
  }
}

function datesOf(weekId: string) {
  const week = parseIsoWeek(weekId);

  if (!week) {
    throw new InvalidWeekIdError(weekId);
  }

  return weekDates(week);
}

function checkedBody(body: string) {
  const trimmed = body.trim();

  if (trimmed === "") {
    throw new BlankNoteError();
  }

  return trimmed;
}

function checkedDate(date: string | null, weekId: string, dates: string[]) {
  // Membership in the week's own dates also refuses a string that is not a calendar date.
  if (date !== null && !dates.includes(date)) {
    throw new DateOutsideWeekError(date, weekId);
  }

  return date;
}

function noteKey(householdId: string, weekId: string, noteId: string) {
  return and(
    eq(schema.weekNotes.householdId, householdId),
    eq(schema.weekNotes.weekId, weekId),
    eq(schema.weekNotes.id, noteId),
  );
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
  const body = checkedBody(input.body);
  const date = checkedDate(input.date ?? null, weekId, dates);

  const [note] = await db
    .insert(schema.weekNotes)
    .values({ householdId, id: randomUUID(), weekId, date, body })
    .returning();

  if (!note) {
    throw new Error("Inserting a week note returned no row");
  }

  return note;
}

export async function updateWeekNote(
  householdId: string,
  weekId: string,
  noteId: string,
  update: WeekNoteUpdate,
  db: Database = defaultDb,
): Promise<WeekNote> {
  const dates = datesOf(weekId);
  const body = update.body === undefined ? undefined : checkedBody(update.body);
  const date = update.date === undefined ? undefined : checkedDate(update.date, weekId, dates);

  const [note] = await db
    .update(schema.weekNotes)
    .set({ body, date, updateTime: new Date() })
    .where(noteKey(householdId, weekId, noteId))
    .returning();

  if (!note) {
    throw new WeekNoteNotFoundError(weekId, noteId);
  }

  return note;
}

export async function deleteWeekNote(
  householdId: string,
  weekId: string,
  noteId: string,
  db: Database = defaultDb,
): Promise<void> {
  datesOf(weekId);

  const deleted = await db
    .delete(schema.weekNotes)
    .where(noteKey(householdId, weekId, noteId))
    .returning({ id: schema.weekNotes.id });

  if (deleted.length === 0) {
    throw new WeekNoteNotFoundError(weekId, noteId);
  }
}

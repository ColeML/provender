import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import {
  addWeekNote,
  BlankNoteError,
  DateOutsideWeekError,
  deleteWeekNote,
  InvalidWeekIdError,
  listWeekNotes,
  updateWeekNote,
  WeekNoteNotFoundError,
} from "@server/services/week-notes";

const A = "loewer";
const W42 = "2026-W42";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("addWeekNote", () => {
  it("saves a note with no day", async () => {
    const note = await addWeekNote(A, W42, { body: "Mom asked for pot roast" }, db);

    expect(note).toMatchObject({ weekId: W42, date: null, body: "Mom asked for pot roast" });
    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ id: note.id }]);
  });

  it("saves a note on a day of the week", async () => {
    const note = await addWeekNote(A, W42, { date: "2026-10-15", body: "Soccer until 7" }, db);

    expect(note).toMatchObject({ date: "2026-10-15" });
  });

  it("trims the note before saving it", async () => {
    const note = await addWeekNote(A, W42, { body: "  pot roast \n" }, db);

    expect(note.body).toBe("pot roast");
  });

  it("refuses a blank note", async () => {
    await expect(addWeekNote(A, W42, { body: " \n\t " }, db)).rejects.toBeInstanceOf(
      BlankNoteError,
    );
    await expect(listWeekNotes(A, W42, db)).resolves.toEqual([]);
  });

  it("refuses a date outside the week", async () => {
    await expect(
      addWeekNote(A, W42, { date: "2026-10-19", body: "Next Monday" }, db),
    ).rejects.toBeInstanceOf(DateOutsideWeekError);
    await expect(listWeekNotes(A, W42, db)).resolves.toEqual([]);
  });

  it("refuses a date that is not a calendar date", async () => {
    await expect(
      addWeekNote(A, W42, { date: "2026-02-30", body: "Nope" }, db),
    ).rejects.toBeInstanceOf(DateOutsideWeekError);
  });

  it("refuses a week that is not an ISO week", async () => {
    await expect(addWeekNote(A, "2026-W99", { body: "Nope" }, db)).rejects.toBeInstanceOf(
      InvalidWeekIdError,
    );
  });
});

describe("listWeekNotes", () => {
  it("lists any-day notes first, then Monday to Sunday, oldest first within a day", async () => {
    await addWeekNote(A, W42, { date: "2026-10-18", body: "Sunday" }, db);
    await addWeekNote(A, W42, { date: "2026-10-15", body: "Thursday, first" }, db);
    await addWeekNote(A, W42, { body: "Any day, first" }, db);
    await addWeekNote(A, W42, { date: "2026-10-12", body: "Monday" }, db);
    await addWeekNote(A, W42, { date: "2026-10-15", body: "Thursday, second" }, db);
    await addWeekNote(A, W42, { body: "Any day, second" }, db);

    const notes = await listWeekNotes(A, W42, db);

    expect(notes.map((note) => note.body)).toEqual([
      "Any day, first",
      "Any day, second",
      "Monday",
      "Thursday, first",
      "Thursday, second",
      "Sunday",
    ]);
  });

  // Rows usually come back in the order they were stored, which is also insert order, so a test
  // of ordinary inserts passes with no sort at all. Storing them against `create_order` does not.
  it("sorts on insert order rather than on how the rows are stored", async () => {
    await db.execute(sql`
      insert into week_notes (household_id, id, week_id, body, create_order)
      overriding system value
      values (${A}, 'second', ${W42}, 'Second', 2), (${A}, 'first', ${W42}, 'First', 1)
    `);

    const notes = await listWeekNotes(A, W42, db);

    expect(notes.map((note) => note.body)).toEqual(["First", "Second"]);
  });

  it("lists only the week asked for", async () => {
    await addWeekNote(A, W42, { body: "This one" }, db);
    await addWeekNote(A, "2026-W43", { body: "Not this one" }, db);

    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ body: "This one" }]);
  });

  it("refuses a week that is not an ISO week", async () => {
    await expect(listWeekNotes(A, "not-a-week", db)).rejects.toBeInstanceOf(InvalidWeekIdError);
  });
});

describe("updateWeekNote", () => {
  it("changes the text, trimmed, and keeps the day", async () => {
    const note = await addWeekNote(A, W42, { date: "2026-10-15", body: "Socer" }, db);

    const updated = await updateWeekNote(A, W42, note.id, { body: " Soccer until 7 " }, db);

    expect(updated).toMatchObject({ id: note.id, date: "2026-10-15", body: "Soccer until 7" });
    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ body: "Soccer until 7" }]);
  });

  it("moves the note to another day of the week and keeps the text", async () => {
    const note = await addWeekNote(A, W42, { date: "2026-10-15", body: "Soccer" }, db);

    const updated = await updateWeekNote(A, W42, note.id, { date: "2026-10-16" }, db);

    expect(updated).toMatchObject({ date: "2026-10-16", body: "Soccer" });
  });

  it("moves the note to any day", async () => {
    const note = await addWeekNote(A, W42, { date: "2026-10-15", body: "Soccer" }, db);

    await expect(updateWeekNote(A, W42, note.id, { date: null }, db)).resolves.toMatchObject({
      date: null,
    });
  });

  it("records when the note was changed", async () => {
    const note = await addWeekNote(A, W42, { body: "Pot roast" }, db);

    await db.execute(sql`update week_notes set update_time = '2026-01-01T00:00:00Z'`);

    const updated = await updateWeekNote(A, W42, note.id, { body: "Pot roast, Sunday" }, db);

    expect(updated.updateTime.getTime()).toBeGreaterThan(Date.parse("2026-01-02T00:00:00Z"));
  });

  it("refuses a blank text and keeps the note as it was", async () => {
    const note = await addWeekNote(A, W42, { body: "Pot roast" }, db);

    await expect(updateWeekNote(A, W42, note.id, { body: "  " }, db)).rejects.toBeInstanceOf(
      BlankNoteError,
    );
    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ body: "Pot roast" }]);
  });

  it("refuses a day outside the week", async () => {
    const note = await addWeekNote(A, W42, { body: "Pot roast" }, db);

    await expect(
      updateWeekNote(A, W42, note.id, { date: "2026-10-19" }, db),
    ).rejects.toBeInstanceOf(DateOutsideWeekError);
    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ date: null }]);
  });

  it("refuses a week that is not an ISO week", async () => {
    await expect(updateWeekNote(A, "2026-W99", "any", { body: "Nope" }, db)).rejects.toBeInstanceOf(
      InvalidWeekIdError,
    );
  });

  it("does not find a note that does not exist", async () => {
    await expect(updateWeekNote(A, W42, "missing", { body: "Nope" }, db)).rejects.toBeInstanceOf(
      WeekNoteNotFoundError,
    );
  });

  // The week is part of the note's name, so a note reached through the wrong week is not found.
  it("does not find a note through another week", async () => {
    const note = await addWeekNote(A, "2026-W43", { body: "Next week's" }, db);

    await expect(updateWeekNote(A, W42, note.id, { body: "Changed" }, db)).rejects.toBeInstanceOf(
      WeekNoteNotFoundError,
    );
    await expect(listWeekNotes(A, "2026-W43", db)).resolves.toMatchObject([
      { body: "Next week's" },
    ]);
  });
});

describe("deleteWeekNote", () => {
  it("deletes the note and leaves the rest", async () => {
    const note = await addWeekNote(A, W42, { body: "Canceled" }, db);

    await addWeekNote(A, W42, { body: "Still on" }, db);
    await deleteWeekNote(A, W42, note.id, db);

    await expect(listWeekNotes(A, W42, db)).resolves.toMatchObject([{ body: "Still on" }]);
  });

  it("does not find a note that does not exist", async () => {
    await expect(deleteWeekNote(A, W42, "missing", db)).rejects.toBeInstanceOf(
      WeekNoteNotFoundError,
    );
  });

  it("does not find a note through another week", async () => {
    const note = await addWeekNote(A, "2026-W43", { body: "Next week's" }, db);

    await expect(deleteWeekNote(A, W42, note.id, db)).rejects.toBeInstanceOf(WeekNoteNotFoundError);
    await expect(listWeekNotes(A, "2026-W43", db)).resolves.toHaveLength(1);
  });

  it("refuses a week that is not an ISO week", async () => {
    await expect(deleteWeekNote(A, "2026-W99", "any", db)).rejects.toBeInstanceOf(
      InvalidWeekIdError,
    );
  });
});

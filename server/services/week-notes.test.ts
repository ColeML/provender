import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import {
  addWeekNote,
  BlankNoteError,
  DateOutsideWeekError,
  InvalidWeekIdError,
  listWeekNotes,
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

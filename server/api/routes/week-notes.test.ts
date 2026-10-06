import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import { schema, type Database } from "@server/db";

let testDb: Database;

// A getter, not a value — see the note in `recipes.test.ts`.
vi.mock("@server/db", async () => {
  const actual = await vi.importActual<typeof import("@server/db")>("@server/db");

  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

const { api } = await import("@server/api/app");
const { addWeekNote, listWeekNotes } = await import("@server/services/week-notes");

const authed = { Authorization: "Bearer test-token" };

function request(method: string, path: string, body?: unknown) {
  return api.request(path, {
    method,
    headers: { ...authed, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface NoteResource {
  name: string;
  noteId: string;
  weekId: string;
  date: string | null;
  body: string;
}

async function addNote(body: unknown, week = "2026-W42") {
  const response = await request("POST", `/v1/weeks/${week}/notes`, body);

  expect(response.status).toBe(200);

  return (await response.json()) as NoteResource;
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("POST /v1/weeks/{week}/notes", () => {
  it("adds a note and returns it as a resource", async () => {
    const note = await addNote({ date: "2026-10-15", body: "Soccer until 7" });

    expect(note).toMatchObject({
      weekId: "2026-W42",
      date: "2026-10-15",
      body: "Soccer until 7",
      name: `weeks/2026-W42/notes/${note.noteId}`,
    });
  });

  it("adds a note for any day when the date is left out", async () => {
    await expect(addNote({ body: "Mom asked for pot roast" })).resolves.toMatchObject({
      date: null,
    });
  });

  it.each([
    ["an invalid week id", "/v1/weeks/2026-W99/notes", { body: "x" }],
    ["a date outside the week", "/v1/weeks/2026-W42/notes", { date: "2026-10-19", body: "x" }],
    ["a blank body", "/v1/weeks/2026-W42/notes", { body: "  \n " }],
  ])("refuses %s with 400", async (_, path, body) => {
    const response = await request("POST", path, body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT" },
    });
  });
});

describe("GET /v1/weeks/{week}/notes", () => {
  it("lists the week's notes, any day first", async () => {
    await addNote({ date: "2026-10-15", body: "Thursday" });
    await addNote({ body: "Any day" });
    await addNote({ body: "Another week" }, "2026-W43");

    const response = await request("GET", "/v1/weeks/2026-W42/notes");

    expect(response.status).toBe(200);

    const { notes } = (await response.json()) as { notes: NoteResource[] };

    expect(notes.map((note) => note.body)).toEqual(["Any day", "Thursday"]);
  });

  it("answers an empty list for a week with no notes", async () => {
    const response = await request("GET", "/v1/weeks/2026-W42/notes");

    await expect(response.json()).resolves.toEqual({ notes: [] });
  });

  it("refuses an invalid week id with 400", async () => {
    const response = await request("GET", "/v1/weeks/next-week/notes");

    expect(response.status).toBe(400);
  });
});

describe("PATCH /v1/weeks/{week}/notes/{note}", () => {
  it("changes only the fields the mask names", async () => {
    const note = await addNote({ date: "2026-10-15", body: "Soccer until 7" });

    const response = await request(
      "PATCH",
      `/v1/weeks/2026-W42/notes/${note.noteId}?updateMask=body`,
      { body: "Soccer until 8", date: "2026-10-16" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      body: "Soccer until 8",
      date: "2026-10-15",
    });
  });

  it("clears the day when the mask names date and the body leaves it out", async () => {
    const note = await addNote({ date: "2026-10-15", body: "Soccer" });

    const response = await request(
      "PATCH",
      `/v1/weeks/2026-W42/notes/${note.noteId}?updateMask=date`,
      {},
    );

    await expect(response.json()).resolves.toMatchObject({ date: null, body: "Soccer" });
  });

  it("has no week field, so a note cannot move weeks", async () => {
    const note = await addNote({ body: "Pot roast" });

    const maskResponse = await request(
      "PATCH",
      `/v1/weeks/2026-W42/notes/${note.noteId}?updateMask=weekId`,
      { weekId: "2026-W43" },
    );

    expect(maskResponse.status).toBe(400);

    await request("PATCH", `/v1/weeks/2026-W42/notes/${note.noteId}?updateMask=body`, {
      body: "Pot roast",
      weekId: "2026-W43",
    });

    await expect(listWeekNotes("loewer", "2026-W42", testDb)).resolves.toMatchObject([
      { id: note.noteId },
    ]);
    await expect(listWeekNotes("loewer", "2026-W43", testDb)).resolves.toEqual([]);
  });

  it.each([
    ["a date outside the week", "date", { date: "2026-10-19" }],
    ["a blank body", "body", { body: " " }],
    ["an empty mask", ",", { body: "x" }],
  ])("refuses %s with 400", async (_, mask, body) => {
    const note = await addNote({ body: "Pot roast" });

    const response = await request(
      "PATCH",
      `/v1/weeks/2026-W42/notes/${note.noteId}?updateMask=${mask}`,
      body,
    );

    expect(response.status).toBe(400);
  });
});

describe("DELETE /v1/weeks/{week}/notes/{note}", () => {
  it("deletes the note", async () => {
    const note = await addNote({ body: "Pot roast" });

    const response = await request("DELETE", `/v1/weeks/2026-W42/notes/${note.noteId}`);

    expect(response.status).toBe(200);
    await expect(listWeekNotes("loewer", "2026-W42", testDb)).resolves.toEqual([]);
  });
});

describe("a note the caller cannot reach", () => {
  async function unreachable() {
    const inOtherWeek = await addNote({ body: "W43" }, "2026-W43");

    await testDb.insert(schema.households).values({ id: "other", name: "Other" });
    const otherHouseholds = await addWeekNote("other", "2026-W42", { body: "Theirs" }, testDb);

    return [
      ["an unknown note", "no-such-note"],
      ["a note in a different week", inOtherWeek.noteId],
      ["another household's note", otherHouseholds.id],
    ] as const;
  }

  it("is a 404 to PATCH", async () => {
    for (const [label, noteId] of await unreachable()) {
      const response = await request(
        "PATCH",
        `/v1/weeks/2026-W42/notes/${noteId}?updateMask=body`,
        { body: "Mine now" },
      );

      expect(response.status, label).toBe(404);
    }
  });

  it("is a 404 to DELETE, and stays where it was", async () => {
    for (const [label, noteId] of await unreachable()) {
      const response = await request("DELETE", `/v1/weeks/2026-W42/notes/${noteId}`);

      expect(response.status, label).toBe(404);
    }

    await expect(listWeekNotes("other", "2026-W42", testDb)).resolves.toHaveLength(1);
    await expect(listWeekNotes("loewer", "2026-W43", testDb)).resolves.toHaveLength(1);
  });
});

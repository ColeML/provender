import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";

import { createCallerFactory } from "../init";
import { appRouter } from "./index";

let db: Database;
let close: () => Promise<void>;

function caller() {
  return createCallerFactory(appRouter)({
    db,
    session: { user: { name: "loewer" }, expires: "2099-01-01T00:00:00.000Z" },
    householdId: "loewer",
  });
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("weekNotes", () => {
  it("adds a note and lists it back", async () => {
    await caller().weekNotes.add({ weekId: "2026-W42", date: "2026-10-15", body: "Soccer" });

    await expect(caller().weekNotes.list({ weekId: "2026-W42" })).resolves.toMatchObject([
      { date: "2026-10-15", body: "Soccer" },
    ]);
  });

  // A thrown service error is a 500 by default, which would log a caller's typo as an outage.
  it.each([
    { weekId: "2026-W42", body: "   " },
    { weekId: "2026-W42", date: "2026-10-19", body: "Outside the week" },
    { weekId: "2026-W99", body: "No such week" },
  ])("answers a bad note with BAD_REQUEST: %o", async (input) => {
    await expect(caller().weekNotes.add(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers a list for a week that is not an ISO week with BAD_REQUEST", async () => {
    await expect(caller().weekNotes.list({ weekId: "2026-W99" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

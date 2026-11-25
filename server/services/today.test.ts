import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schema } from "@server/db";

import { setConfigValue } from "./config";
import { householdTimeZone, householdToday } from "./today";

const H = "loewer";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  vi.useFakeTimers({ toFake: ["Date"] });
  // 7:30 pm Tuesday in Chicago, already Wednesday in UTC.
  vi.setSystemTime(new Date("2026-11-25T01:30:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await close();
});

describe("householdToday", () => {
  it("defaults to Chicago when no zone is set", async () => {
    await expect(householdTimeZone(H, db)).resolves.toBe("America/Chicago");
    await expect(householdToday(H, db)).resolves.toBe("2026-11-24");
  });

  it("follows the household's zone", async () => {
    await setConfigValue(H, "timezone", "UTC", db);

    await expect(householdToday(H, db)).resolves.toBe("2026-11-25");
  });

  it("falls back to the default for a stored zone it cannot read", async () => {
    // Written straight to the table, as a value saved before zones were checked would be.
    await db.insert(schema.config).values({ householdId: H, key: "timezone", value: "Mars/Base" });

    await expect(householdTimeZone(H, db)).resolves.toBe("America/Chicago");
  });
});

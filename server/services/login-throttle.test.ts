import { schema } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLoginAttempts,
  clientAddress,
  MAX_ATTEMPTS,
  registerLoginAttempt,
  WINDOW_MS,
} from "./login-throttle";

import type { Database } from "@server/db";
import type { LoginVerdict } from "./login-throttle";

let db: Database;
let close: () => Promise<void>;

const NOW = new Date("2026-09-10T18:00:00Z");
const CLIENT = "203.0.113.7";

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
  vi.restoreAllMocks();
});

/** The verdict on each of `times` attempts, in order. */
async function attempts(times: number, client = CLIENT, at: Date = NOW) {
  const verdicts: LoginVerdict[] = [];

  for (let attempt = 0; attempt < times; attempt += 1) {
    verdicts.push(await registerLoginAttempt(client, at, db));
  }

  return verdicts;
}

describe("the login throttle", () => {
  it("allows attempts up to the limit and refuses the one after it", async () => {
    const verdicts = await attempts(MAX_ATTEMPTS + 1);

    expect(verdicts.slice(0, MAX_ATTEMPTS)).not.toContain("throttled");
    expect(verdicts[MAX_ATTEMPTS]).toBe("throttled");
  });

  it("counts each address separately, so one attacker does not lock out the household", async () => {
    await attempts(MAX_ATTEMPTS + 1, CLIENT);

    await expect(registerLoginAttempt("198.51.100.2", NOW, db)).resolves.toBe("allowed");
  });

  it("lets a throttled client back in once the window has passed", async () => {
    await attempts(MAX_ATTEMPTS + 1);

    const later = new Date(NOW.getTime() + WINDOW_MS + 1000);

    await expect(registerLoginAttempt(CLIENT, later, db)).resolves.toBe("allowed");
  });

  it("does not let continued guessing extend a lockout", async () => {
    await attempts(MAX_ATTEMPTS + 1);

    const nearTheEnd = new Date(NOW.getTime() + WINDOW_MS - 1000);

    await registerLoginAttempt(CLIENT, nearTheEnd, db);

    const later = new Date(NOW.getTime() + WINDOW_MS + 1000);

    await expect(registerLoginAttempt(CLIENT, later, db)).resolves.toBe("allowed");
  });

  it("forgets a client's attempts once it signs in", async () => {
    await attempts(MAX_ATTEMPTS);

    await clearLoginAttempts(CLIENT, db);

    await expect(registerLoginAttempt(CLIENT, NOW, db)).resolves.toBe("allowed");
  });

  it("drops rows whose window has expired, so rotated addresses do not accumulate", async () => {
    await attempts(1, CLIENT);

    const later = new Date(NOW.getTime() + WINDOW_MS + 1000);

    await attempts(1, "198.51.100.2", later);

    const rows = await db.select().from(schema.loginAttempts);

    expect(rows.map((row) => row.client)).toEqual(["198.51.100.2"]);
  });

  it("still allows an attempt that was counted but whose cleanup failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(db, "delete").mockImplementation(() => {
      throw new Error("canceling statement due to statement timeout");
    });

    await expect(registerLoginAttempt(CLIENT, NOW, db)).resolves.toBe("allowed");

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      severity: "error",
      event: "auth.throttle_unavailable",
      operation: "prune",
    });
  });

  it("names the fail-closed refusal apart from a client that is over the limit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      insert() {
        throw new Error("connection terminated");
      },
    } as unknown as Database;

    await expect(registerLoginAttempt(CLIENT, NOW, broken)).resolves.toBe("unavailable");

    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      severity: "error",
      event: "auth.throttle_unavailable",
      operation: "count",
    });
  });
});

describe("the client address", () => {
  it("prefers x-real-ip, the single-address header, over a forwarded list", () => {
    const request = new Request("https://example.test/", {
      headers: { "x-real-ip": CLIENT, "x-forwarded-for": `10.0.0.1, ${CLIENT}` },
    });

    expect(clientAddress(request)).toBe(CLIENT);
  });

  it("falls back to the first x-forwarded-for entry", () => {
    const request = new Request("https://example.test/", {
      headers: { "x-forwarded-for": `${CLIENT}, 10.0.0.1` },
    });

    expect(clientAddress(request)).toBe(CLIENT);
  });

  it("shares one bucket when no header identifies the caller", () => {
    expect(clientAddress(new Request("https://example.test/"))).toBe("unknown");
    expect(clientAddress(undefined)).toBe("unknown");
  });
});

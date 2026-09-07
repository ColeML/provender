import { describe, expect, it } from "vitest";

import type { Database } from "@server/db";

import { getConfig } from "./config";

const rows = [
  { key: "people", value: "4", updatedAt: new Date("2026-01-01") },
  { key: "default_budget", value: "120", updatedAt: new Date("2026-01-01") },
];

function stubDb(result: typeof rows) {
  return { select: () => ({ from: () => ({ where: async () => result }) }) } as unknown as Database;
}

describe("getConfig", () => {
  it("flattens the key/value rows into one object", async () => {
    await expect(getConfig("loewer", stubDb(rows))).resolves.toEqual({
      people: "4",
      default_budget: "120",
    });
  });

  it("returns an empty object when nothing is configured", async () => {
    await expect(getConfig("loewer", stubDb([]))).resolves.toEqual({});
  });
});

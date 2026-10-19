import { afterEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { SETTINGS } from "@server/lib/settings";

import { getConfig, InvalidSettingError, setConfigValue, setConfigValues } from "./config";

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

describe("the known settings", () => {
  it("are thirteen rows plus the Kroger store name, which has none", () => {
    expect(SETTINGS.filter((setting) => !setting.hidden)).toHaveLength(13);
    expect(SETTINGS.find((setting) => setting.key === "kroger_location_name")).toMatchObject({
      hidden: true,
    });
  });
});

describe("setConfigValue", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
  });

  async function freshDb() {
    const test = await createTestDb();

    close = test.close;

    return test.db;
  }

  it.each([
    ["people", "4"],
    ["default_meals", "7"],
    ["default_budget", "120"],
    ["default_budget", "89.50"],
    ["no_repeat_days", "365"],
    ["dislikes", ""],
    ["no_repeat_days", ""],
    ["render_dir", "anything at all"],
  ])("accepts %s = %j", async (key, value) => {
    const db = await freshDb();

    await setConfigValue("loewer", key, value, db);

    await expect(getConfig("loewer", db)).resolves.toEqual({ [key]: value });
  });

  it.each([
    ["people", "0"],
    ["people", "2.5"],
    ["people", "four"],
    ["default_meals", "8"],
    ["default_budget", "$120"],
    ["default_budget", "0"],
    ["default_budget", "12.345"],
    ["no_repeat_days", "-1"],
  ])("refuses %s = %j", async (key, value) => {
    const db = await freshDb();

    await expect(setConfigValue("loewer", key, value, db)).rejects.toBeInstanceOf(
      InvalidSettingError,
    );
    await expect(getConfig("loewer", db)).resolves.toEqual({});
  });

  it("names the setting and its range in the message", async () => {
    const db = await freshDb();

    await expect(setConfigValue("loewer", "default_meals", "9", db)).rejects.toThrow(
      "Dinners per week must be a whole number from 1 to 7.",
    );
  });
});

describe("setConfigValues", () => {
  it("writes none of the values when one is refused", async () => {
    const { db, close } = await createTestDb();

    await expect(
      setConfigValues("loewer", { location: "Edmond, OK", people: "lots" }, db),
    ).rejects.toBeInstanceOf(InvalidSettingError);
    await expect(getConfig("loewer", db)).resolves.toEqual({});

    await close();
  });

  it("overwrites existing keys and keeps the rest", async () => {
    const { db, close } = await createTestDb();

    await setConfigValues("loewer", { people: "4", location: "Edmond, OK" }, db);
    await setConfigValues("loewer", { people: "6" }, db);

    await expect(getConfig("loewer", db)).resolves.toEqual({
      people: "6",
      location: "Edmond, OK",
    });

    await close();
  });
});

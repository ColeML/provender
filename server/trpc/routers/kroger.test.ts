import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { getConfig } from "@server/services/config";
import { clearTokenCache } from "@server/services/kroger";

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

const TOKEN = { access_token: "tok", expires_in: 1800 };

function respond(...bodies: { status?: number; body: unknown }[]) {
  const fetchMock = vi.fn();

  for (const { status = 200, body } of bodies) {
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  }

  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  clearTokenCache();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearTokenCache();
  await close();
});

describe("kroger.findLocations", () => {
  it("returns the stores near the ZIP code", async () => {
    vi.stubEnv("KROGER_CLIENT_ID", "client");
    vi.stubEnv("KROGER_CLIENT_SECRET", "secret");
    respond(
      { body: TOKEN },
      {
        body: {
          data: [
            {
              locationId: "03500529",
              name: "Dillons - Edmond",
              chain: "DILLONS",
              address: { addressLine1: "1 Main St", city: "Edmond", state: "OK" },
            },
          ],
        },
      },
    );

    await expect(caller().kroger.findLocations({ zipCode: "73034" })).resolves.toEqual([
      {
        locationId: "03500529",
        name: "Dillons - Edmond",
        chain: "DILLONS",
        address: "1 Main St, Edmond, OK",
      },
    ]);
  });

  // Each code tells the page something different: fix the deployment, fix the ZIP, or retry.
  it.each([
    ["no credentials", "PRECONDITION_FAILED", () => {}],
    [
      "Kroger refusing the request",
      "BAD_REQUEST",
      () => respond({ body: TOKEN }, { status: 400, body: {} }),
    ],
    ["Kroger being down", "SERVICE_UNAVAILABLE", () => respond({ status: 503, body: {} })],
  ])("answers %s with %s", async (_, code, stub) => {
    const configured = code !== "PRECONDITION_FAILED";

    vi.stubEnv("KROGER_CLIENT_ID", configured ? "client" : "");
    vi.stubEnv("KROGER_CLIENT_SECRET", configured ? "secret" : "");
    stub();

    await expect(caller().kroger.findLocations({ zipCode: "73034" })).rejects.toMatchObject({
      code,
    });
  });

  it("refuses a ZIP code that is not five digits", async () => {
    await expect(caller().kroger.findLocations({ zipCode: "7303" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("config.setValues", () => {
  it("saves the Kroger store's id and name together", async () => {
    await caller().config.setValues({
      values: { kroger_location_id: "03500529", kroger_location_name: "Dillons - Edmond" },
    });

    await expect(getConfig("loewer", db)).resolves.toEqual({
      kroger_location_id: "03500529",
      kroger_location_name: "Dillons - Edmond",
    });
  });
});

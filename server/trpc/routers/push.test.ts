import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schema, type Database } from "@server/db";
import { createTestDb } from "@server/db/testing";

import { createCallerFactory } from "../init";
import { appRouter } from "./index";

let db: Database;
let close: () => Promise<void>;

const PHONE = {
  endpoint: "https://push.example/phone",
  keys: { p256dh: "phone-key", auth: "phone-auth" },
};

function caller(householdId = "loewer") {
  return createCallerFactory(appRouter)({
    db,
    session: { user: { name: householdId }, expires: "2099-01-01T00:00:00.000Z" },
    householdId,
  });
}

const signedOut = () => createCallerFactory(appRouter)({ db, session: null, householdId: null });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(schema.households).values({ id: "other", name: "Other" });
  vi.stubEnv("VAPID_PUBLIC_KEY", "public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("push", () => {
  it.each([
    ["vapidPublicKey", () => signedOut().push.vapidPublicKey()],
    ["subscribe", () => signedOut().push.subscribe(PHONE)],
    ["unsubscribe", () => signedOut().push.unsubscribe({ endpoint: PHONE.endpoint })],
    ["sendTest", () => signedOut().push.sendTest({ endpoint: PHONE.endpoint })],
  ])("refuses %s to a caller who is not signed in", async (_, call) => {
    await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("serves the public key", async () => {
    await expect(caller().push.vapidPublicKey()).resolves.toBe("public");
  });

  it("serves null when the deployment has no key", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");

    await expect(caller().push.vapidPublicKey()).resolves.toBeNull();
  });

  it("saves the device under the session's household, whatever the request says", async () => {
    await caller().push.subscribe({ ...PHONE, householdId: "other" } as typeof PHONE);

    await expect(db.select().from(schema.pushSubscriptions)).resolves.toMatchObject([
      { endpoint: PHONE.endpoint, householdId: "loewer" },
    ]);
  });

  it("refuses an endpoint that is not an https URL", async () => {
    await expect(
      caller().push.subscribe({ ...PHONE, endpoint: "http://push.example/phone" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses an endpoint or key too long to be a browser's", async () => {
    await expect(
      caller().push.subscribe({ ...PHONE, endpoint: `https://push.example/${"x".repeat(2048)}` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().push.subscribe({ ...PHONE, keys: { p256dh: "x".repeat(257), auth: "auth" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("removes the device on unsubscribe", async () => {
    await caller().push.subscribe(PHONE);

    await caller().push.unsubscribe({ endpoint: PHONE.endpoint });

    await expect(db.select().from(schema.pushSubscriptions)).resolves.toEqual([]);
  });

  it("answers a test push to a device that is not subscribed with NOT_FOUND", async () => {
    await expect(caller().push.sendTest({ endpoint: PHONE.endpoint })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("answers a test push to another household's device with NOT_FOUND", async () => {
    await caller("other").push.subscribe(PHONE);

    await expect(caller().push.sendTest({ endpoint: PHONE.endpoint })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("answers a test push with PRECONDITION_FAILED when the deployment has no VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await caller().push.subscribe(PHONE);

    await expect(caller().push.sendTest({ endpoint: PHONE.endpoint })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

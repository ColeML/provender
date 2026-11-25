import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { schema, type Database } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { eq } from "drizzle-orm";
import { WebPushError } from "web-push";

import {
  PushNotConfiguredError,
  PushSubscriptionNotFoundError,
  sendTestPush,
  subscribeDevice,
  unsubscribeDevice,
  vapidPublicKey,
  type PushSender,
} from "./push";

const HOUSEHOLD = "loewer";
const PHONE = {
  endpoint: "https://push.example/phone",
  keys: { p256dh: "phone-key", auth: "phone-auth" },
};
const LAPTOP = {
  endpoint: "https://push.example/laptop",
  keys: { p256dh: "laptop-key", auth: "laptop-auth" },
};

let db: Database;
let close: () => Promise<void>;

const rows = () =>
  db.select().from(schema.pushSubscriptions).orderBy(schema.pushSubscriptions.endpoint);

const refuse = (statusCode: number): PushSender =>
  vi.fn(async () => {
    throw new WebPushError("refused", statusCode, {}, "", PHONE.endpoint);
  });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  vi.stubEnv("VAPID_PUBLIC_KEY", "public");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private");
  vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("subscribeDevice", () => {
  it("saves the device's endpoint and keys under the household", async () => {
    await subscribeDevice(HOUSEHOLD, PHONE, db);

    expect(await rows()).toMatchObject([
      {
        endpoint: PHONE.endpoint,
        householdId: HOUSEHOLD,
        p256dh: "phone-key",
        auth: "phone-auth",
        lastSentOn: null,
      },
    ]);
  });

  it("replaces the row when the same device subscribes again", async () => {
    await subscribeDevice(HOUSEHOLD, PHONE, db);
    await subscribeDevice(
      HOUSEHOLD,
      { ...PHONE, keys: { p256dh: "new-key", auth: "new-auth" } },
      db,
    );

    expect(await rows()).toMatchObject([
      { endpoint: PHONE.endpoint, p256dh: "new-key", auth: "new-auth" },
    ]);
  });

  it("goes with the household when that household is deleted", async () => {
    await subscribeDevice(HOUSEHOLD, PHONE, db);

    await db.delete(schema.households).where(eq(schema.households.id, HOUSEHOLD));

    expect(await rows()).toEqual([]);
  });
});

describe("unsubscribeDevice", () => {
  it("removes this device and leaves the household's others", async () => {
    await subscribeDevice(HOUSEHOLD, PHONE, db);
    await subscribeDevice(HOUSEHOLD, LAPTOP, db);

    await unsubscribeDevice(HOUSEHOLD, PHONE.endpoint, db);

    expect((await rows()).map((row) => row.endpoint)).toEqual([LAPTOP.endpoint]);
  });

  it("does nothing for a device that was never subscribed", async () => {
    await expect(unsubscribeDevice(HOUSEHOLD, PHONE.endpoint, db)).resolves.toBeUndefined();
  });
});

describe("sendTestPush", () => {
  it("sends one push, to this device only", async () => {
    const send: PushSender = vi.fn(async () => {});
    await subscribeDevice(HOUSEHOLD, PHONE, db);
    await subscribeDevice(HOUSEHOLD, LAPTOP, db);

    await expect(sendTestPush(HOUSEHOLD, PHONE.endpoint, db, send)).resolves.toEqual({
      sent: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(PHONE, expect.any(String));
  });

  it("sends a title, a body and a URL for the worker to show", async () => {
    const send = vi.fn<PushSender>(async () => {});
    await subscribeDevice(HOUSEHOLD, PHONE, db);

    await sendTestPush(HOUSEHOLD, PHONE.endpoint, db, send);

    expect(JSON.parse(send.mock.calls[0][1])).toEqual({
      title: expect.any(String),
      body: expect.any(String),
      url: "/settings",
    });
  });

  it.each([404, 410])(
    "deletes the subscription when the push service answers %i",
    async (statusCode) => {
      await subscribeDevice(HOUSEHOLD, PHONE, db);

      await expect(
        sendTestPush(HOUSEHOLD, PHONE.endpoint, db, refuse(statusCode)),
      ).resolves.toEqual({ sent: false, gone: true });

      expect(await rows()).toEqual([]);
    },
  );

  it("keeps the subscription and throws when the push service fails another way", async () => {
    await subscribeDevice(HOUSEHOLD, PHONE, db);

    await expect(sendTestPush(HOUSEHOLD, PHONE.endpoint, db, refuse(500))).rejects.toThrow(
      WebPushError,
    );

    expect(await rows()).toHaveLength(1);
  });

  it("refuses a device that is not subscribed, and sends nothing", async () => {
    const send: PushSender = vi.fn(async () => {});

    await expect(sendTestPush(HOUSEHOLD, PHONE.endpoint, db, send)).rejects.toThrow(
      PushSubscriptionNotFoundError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to send when the deployment has no VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await subscribeDevice(HOUSEHOLD, PHONE, db);

    await expect(sendTestPush(HOUSEHOLD, PHONE.endpoint, db)).rejects.toThrow(
      PushNotConfiguredError,
    );
  });
});

describe("vapidPublicKey", () => {
  it("serves the deployment's public key", () => {
    expect(vapidPublicKey()).toBe("public");
  });

  it("is null when the deployment has no public key", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");

    expect(vapidPublicKey()).toBeNull();
  });
});

import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { and, eq } from "drizzle-orm";
import webpush, { WebPushError, type PushSubscription } from "web-push";

/** What a browser's `PushSubscription.toJSON()` carries that the server needs. */
export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one encrypted payload. Passed in so a test never reaches a real push service. */
export type PushSender = (subscription: DeviceSubscription, payload: string) => Promise<void>;

/** The deployment has no VAPID keys, so nothing can be sent. Fix the environment, not the call. */
export class PushNotConfiguredError extends Error {
  constructor() {
    super(
      "Push notifications are not set up: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required",
    );
  }
}

export class PushSubscriptionNotFoundError extends Error {
  constructor() {
    super("This device is not subscribed to notifications");
  }
}

/**
 * The key a browser subscribes with, or `null` when the deployment has none.
 *
 * Takes no `householdId`: the key belongs to the deployment, as Kroger's credentials do.
 */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function vapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new PushNotConfiguredError();
  }

  return { publicKey, privateKey, subject };
}

const webPushSender: PushSender = async (subscription: PushSubscription, payload) => {
  await webpush.sendNotification(subscription, payload, {
    vapidDetails: vapidDetails(),
    // A test push nobody sees within a minute is not worth delivering later.
    TTL: 60,
  });
};

/** The push service's answer for a subscription the browser has dropped for good. */
function isGone(error: unknown) {
  return error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410);
}

/**
 * Saves this device under the caller's household, replacing any row for the same endpoint.
 *
 * The household comes from the session, so a browser that signs in to another household and
 * subscribes again moves there. The endpoint is a URL only that browser knows, so no one else can.
 */
export async function subscribeDevice(
  householdId: string,
  { endpoint, keys }: DeviceSubscription,
  db: Database = defaultDb,
) {
  await db
    .insert(schema.pushSubscriptions)
    .values({ endpoint, householdId, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { householdId, p256dh: keys.p256dh, auth: keys.auth },
    });
}

function forDevice(householdId: string, endpoint: string) {
  return and(
    eq(schema.pushSubscriptions.householdId, householdId),
    eq(schema.pushSubscriptions.endpoint, endpoint),
  );
}

export async function unsubscribeDevice(
  householdId: string,
  endpoint: string,
  db: Database = defaultDb,
) {
  await db.delete(schema.pushSubscriptions).where(forDevice(householdId, endpoint));
}

/**
 * Sends a test notification to this device and no other. A subscription the push service says is
 * gone is deleted, and the caller hears `gone` so the device can subscribe again.
 */
export async function sendTestPush(
  householdId: string,
  endpoint: string,
  db: Database = defaultDb,
  send: PushSender = webPushSender,
): Promise<{ sent: true } | { sent: false; gone: true }> {
  const [row] = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(forDevice(householdId, endpoint));

  if (!row) {
    throw new PushSubscriptionNotFoundError();
  }

  const payload = JSON.stringify({
    title: "Provender",
    body: "Notifications work on this device. Prep reminders will arrive like this.",
    url: "/settings",
  });

  try {
    await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
  } catch (error) {
    if (!isGone(error)) {
      throw error;
    }

    await unsubscribeDevice(householdId, endpoint, db);

    return { sent: false, gone: true };
  }

  return { sent: true };
}

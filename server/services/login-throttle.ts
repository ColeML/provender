import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { logError } from "@server/lib/log";
import { eq, lt, sql } from "drizzle-orm";

/**
 * How many sign-in attempts one client address gets, and over how long.
 *
 * The app is a public URL behind one shared password, so the only cost of a guess is scrypt's CPU
 * time and a networked attacker can run guesses in parallel. Counting them bounds that.
 *
 * Unlike every other service here these functions take no `householdId`: signing in happens
 * before a household is resolved, and nothing they read or write is household data.
 *
 * Neither function throws. A limiter that answered a database error by propagating it would
 * become a way to bypass itself, so a failure logs and refuses.
 */
export const MAX_ATTEMPTS = 10;
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Which client an attempt is counted against.
 *
 * On Vercel neither header is client-controlled and the two carry the same value: the platform
 * overwrites `x-forwarded-for` and does not forward external IPs, to prevent spoofing, and
 * documents `x-real-ip` as identical to it. So the order below decides nothing on this deployment.
 * `x-real-ip` is read first because it is a single address, where the `x-forwarded-for` fallback
 * takes the leftmost entry of a list — the client-supplied end, if this ever runs somewhere that
 * forwards one. Putting a proxy on top of Vercel is the case that would break both, and Vercel
 * documents `x-vercel-forwarded-for` as the header that survives it.
 *
 * Anything unidentified shares the `unknown` bucket rather than going uncounted — which does mean
 * ten failures with no address header lock out every other unidentified client for the window.
 */
export function clientAddress(request: Request | undefined): string {
  const realIp = request?.headers.get("x-real-ip")?.trim();

  if (realIp) {
    return realIp;
  }

  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return forwarded ? forwarded : "unknown";
}

/**
 * Counts one attempt against `client` and says whether it is over the limit.
 *
 * Counting and deciding are the same statement, and it runs *before* the password is checked.
 * Reading a count, verifying, then writing would let every request that arrives during scrypt's
 * ~100ms read the same pre-increment count — so a few hundred concurrent guesses would all be
 * checked no matter what the limit said, which is the attack this exists to stop.
 *
 * A refused attempt is still counted, but it does not move `window_start`, so the window expires
 * a fixed time after its first attempt and continued guessing cannot extend a lockout.
 */
export async function registerLoginAttempt(
  client: string,
  now: Date = new Date(),
  db: Database = defaultDb,
): Promise<{ throttled: boolean }> {
  const floor = new Date(now.getTime() - WINDOW_MS);
  const withinWindow = sql`${schema.loginAttempts.windowStart} > ${floor}`;

  let throttled: boolean;

  try {
    const [row] = await db
      .insert(schema.loginAttempts)
      .values({ client, attemptCount: 1, windowStart: now })
      .onConflictDoUpdate({
        target: schema.loginAttempts.client,
        set: {
          attemptCount: sql`case when ${withinWindow} then ${schema.loginAttempts.attemptCount} + 1 else 1 end`,
          windowStart: sql`case when ${withinWindow} then ${schema.loginAttempts.windowStart} else ${now} end`,
        },
      })
      .returning({ attemptCount: schema.loginAttempts.attemptCount });

    throttled = (row?.attemptCount ?? MAX_ATTEMPTS + 1) > MAX_ATTEMPTS;
  } catch (caught) {
    logError("auth.throttle_unavailable", { operation: "count", message: reason(caught) });

    // Fail closed: an attempt that could not be counted is not an attempt that may be answered.
    return { throttled: true };
  }

  // Keeps the table bounded when an attacker rotates addresses, which would otherwise leave a row
  // per address forever. Caught separately from the count, and after the verdict is decided,
  // because housekeeping is not part of the decision: sharing the `try` above would let a failed
  // delete refuse an attempt the count had just allowed.
  try {
    await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.windowStart, floor));
  } catch (caught) {
    logError("auth.throttle_unavailable", { operation: "prune", message: reason(caught) });
  }

  return { throttled };
}

/** Forget a client's attempts, so signing in restores its full allowance. */
export async function clearLoginAttempts(client: string, db: Database = defaultDb): Promise<void> {
  try {
    await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.client, client));
  } catch (caught) {
    logError("auth.throttle_unavailable", { operation: "clear", message: reason(caught) });
  }
}

function reason(caught: unknown): string {
  return caught instanceof Error ? caught.message : "unknown";
}

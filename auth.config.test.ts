import { hashPassword } from "@server/auth/password";
import { schema } from "@server/db";
import { createTestDb } from "@server/db/testing";
import { MAX_ATTEMPTS, registerLoginAttempt } from "@server/services/login-throttle";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { authConfig, authorizeHousehold } from "./auth.config";

import type { Database } from "@server/db";

const PASSWORD = "correct horse battery staple";
const CLIENT = "203.0.113.7";

/**
 * What Auth.js hands its logger when `authorize` returns null. The real class comes from
 * `next-auth`, whose root entry drags Next's server runtime into a plain Node test; it sets
 * `name` from the constructor, which is what the config matches on.
 */
class CredentialsSignin extends Error {
  override name = "CredentialsSignin";
}

/**
 * What Auth.js hands its logger when `authorize` throws: the wrapper's own message is only a link
 * to the docs, and the error that actually failed is at `cause.err`.
 */
class CallbackRouteError extends Error {
  override name = "CallbackRouteError";

  constructor(err: Error) {
    super("Read more at https://errors.authjs.dev#callbackrouteerror", {
      cause: { err, provider: "credentials" },
    });
  }
}

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;
let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The sign-in Auth.js would make, from one client address. */
function authorize(credentials: Partial<Record<string, unknown>>) {
  return authorizeHousehold(
    credentials,
    new Request("https://provender.test/api/auth/callback/credentials", {
      headers: { "x-real-ip": CLIENT },
    }),
    db,
  );
}

function loggedText() {
  return [...warn.mock.calls, ...error.mock.calls].flat().join("\n");
}

function loggedJson(spy: MockInstance<typeof console.warn>) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("the credentials provider", () => {
  it("admits the household on the right password, logging nothing", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorize({ password: PASSWORD })).resolves.toEqual({
      id: "household",
      name: "Household",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("records a wrong password once, as the caller's fault", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorize({ password: "guess" })).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(loggedJson(warn)[0]).toEqual({
      severity: "warn",
      event: "auth.password_rejected",
      reason: "wrong_password",
    });
  });

  it("distinguishes a sign-in that sent no password", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorize({})).resolves.toBeNull();

    expect(loggedJson(warn)[0]).toMatchObject({
      event: "auth.password_rejected",
      reason: "no_password",
    });
  });

  it("records an unset AUTH_PASSWORD_HASH distinctly, as a deploy fault", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", "");

    await expect(authorize({ password: PASSWORD })).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
    expect(loggedJson(error)).toEqual([{ severity: "error", event: "auth.password_hash_unset" }]);
  });

  it("never writes the password or the stored hash", async () => {
    const stored = await hashPassword(PASSWORD);
    vi.stubEnv("AUTH_PASSWORD_HASH", stored);

    await authorize({ password: "hunter2" });

    expect(loggedText()).not.toContain("hunter2");
    expect(loggedText()).not.toContain(stored);
    expect(loggedText()).not.toContain(PASSWORD);
  });
});

describe("the sign-in throttle", () => {
  /** Spend the client's whole allowance, as a run of wrong guesses would. */
  async function spendAllowance() {
    for (let spent = 0; spent < MAX_ATTEMPTS; spent += 1) {
      await registerLoginAttempt(CLIENT, new Date(), db);
    }
  }

  it("counts a wrong password against the client that sent it", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await authorize({ password: "guess" });

    const [row] = await db.select().from(schema.loginAttempts);

    expect(row).toMatchObject({ client: CLIENT, attemptCount: 1 });
  });

  it("refuses even the right password once the client has spent its allowance", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));
    await spendAllowance();

    await expect(authorize({ password: PASSWORD })).resolves.toBeNull();
  });

  it("tells a throttled attempt apart from a wrong one in the log, not in the answer", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    const wrong = await authorize({ password: "guess" });

    warn.mockClear();
    await spendAllowance();

    const throttled = await authorize({ password: "guess" });

    expect(throttled).toEqual(wrong);
    expect(loggedJson(warn)).toEqual([
      { severity: "warn", event: "auth.password_rejected", reason: "throttled" },
    ]);
  });

  it("clears the count when the household signs in", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await authorize({ password: "guess" });
    await authorize({ password: PASSWORD });

    await expect(db.select().from(schema.loginAttempts)).resolves.toEqual([]);
  });

  it("refuses a guess that starts while a parallel one is spending the last of the allowance", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    for (let spent = 1; spent < MAX_ATTEMPTS; spent += 1) {
      await registerLoginAttempt(CLIENT, new Date(), db);
    }

    warn.mockClear();

    // Both are in flight before either has been counted, which is how a networked attacker
    // guesses: concurrency, not sequence.
    const refused = await Promise.all([
      authorize({ password: "guess" }),
      authorize({ password: "guess" }),
    ]);

    expect(refused).toEqual([null, null]);
    expect(loggedJson(warn).map((line) => line.reason)).toContain("throttled");
  });

  it("never writes the password when it refuses a throttled attempt", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));
    await spendAllowance();

    await authorize({ password: "hunter2" });

    expect(loggedText()).not.toContain("hunter2");
  });
});

describe("the Auth.js logger", () => {
  it("drops the rejected-credential error Auth.js raises, which authorize already logged", () => {
    authConfig.logger.error(new CredentialsSignin("no"));

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("records what Auth.js wrapped, not just the wrapper's link to the docs", () => {
    const cause = new Error("the database is unreachable");

    authConfig.logger.error(new CallbackRouteError(cause));

    expect(loggedJson(error)).toEqual([
      {
        severity: "error",
        event: "auth.internal_error",
        name: "CallbackRouteError",
        message: "Read more at https://errors.authjs.dev#callbackrouteerror",
        causeName: "Error",
        causeMessage: "the database is unreachable",
        causeStack: cause.stack,
      },
    ]);
  });
});

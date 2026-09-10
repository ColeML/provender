import { hashPassword } from "@server/auth/password";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { authConfig, authorizeHousehold } from "./auth.config";

const PASSWORD = "correct horse battery staple";

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

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function loggedText() {
  return [...warn.mock.calls, ...error.mock.calls].flat().join("\n");
}

function loggedJson(spy: MockInstance<typeof console.warn>) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("the credentials provider", () => {
  it("admits the household on the right password, logging nothing", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorizeHousehold({ password: PASSWORD })).resolves.toEqual({
      id: "household",
      name: "Household",
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("records a wrong password once, as the caller's fault", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorizeHousehold({ password: "guess" })).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(loggedJson(warn)[0]).toEqual({
      level: "warn",
      event: "auth.password_rejected",
      reason: "wrong_password",
    });
  });

  it("distinguishes a sign-in that sent no password", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", await hashPassword(PASSWORD));

    await expect(authorizeHousehold({})).resolves.toBeNull();

    expect(loggedJson(warn)[0]).toMatchObject({
      event: "auth.password_rejected",
      reason: "no_password",
    });
  });

  it("records an unset AUTH_PASSWORD_HASH distinctly, as a deploy fault", async () => {
    vi.stubEnv("AUTH_PASSWORD_HASH", "");

    await expect(authorizeHousehold({ password: PASSWORD })).resolves.toBeNull();

    expect(warn).not.toHaveBeenCalled();
    expect(loggedJson(error)).toEqual([{ level: "error", event: "auth.password_hash_unset" }]);
  });

  it("never writes the password or the stored hash", async () => {
    const stored = await hashPassword(PASSWORD);
    vi.stubEnv("AUTH_PASSWORD_HASH", stored);

    await authorizeHousehold({ password: "hunter2" });

    expect(loggedText()).not.toContain("hunter2");
    expect(loggedText()).not.toContain(stored);
    expect(loggedText()).not.toContain(PASSWORD);
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
        level: "error",
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

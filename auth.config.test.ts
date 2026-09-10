import { hashPassword } from "@server/auth/password";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { authorizeHousehold } from "./auth.config";

const PASSWORD = "correct horse battery staple";

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

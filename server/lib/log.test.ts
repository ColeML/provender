import { afterEach, describe, expect, it, vi } from "vitest";

import { logError, logWarn } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logWarn", () => {
  it("writes one JSON line carrying the event and its fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logWarn("auth.bearer_rejected", { reason: "wrong_token" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      severity: "warn",
      event: "auth.bearer_rejected",
      reason: "wrong_token",
    });
  });
});

describe("logWarn's reserved fields", () => {
  it("keeps severity and event when a caller passes fields of the same name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logWarn("auth.bearer_rejected", { severity: "info", event: "something.else" });

    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      severity: "warn",
      event: "auth.bearer_rejected",
    });
  });

  it("drops a caller's level, so one line never carries two severity fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logWarn("auth.bearer_rejected", { level: "info" });

    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      severity: "warn",
      event: "auth.bearer_rejected",
    });
  });

  it("keeps message and method, the other Vercel names, whose values do not answer wrong", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logWarn("auth.bearer_rejected", { message: "the token was rejected", method: "POST" });

    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      severity: "warn",
      event: "auth.bearer_rejected",
      message: "the token was rejected",
      method: "POST",
    });
  });
});

describe("logError", () => {
  it("writes to console.error, which is what Vercel's own level facet reads", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logError("auth.api_token_unset");

    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      severity: "error",
      event: "auth.api_token_unset",
    });
  });
});

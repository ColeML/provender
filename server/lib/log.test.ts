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
      level: "warn",
      event: "auth.bearer_rejected",
      reason: "wrong_token",
    });
  });
});

describe("logError", () => {
  it("writes to console.error, so the level survives into Vercel's log view", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logError("auth.api_token_unset");

    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      level: "error",
      event: "auth.api_token_unset",
    });
  });
});

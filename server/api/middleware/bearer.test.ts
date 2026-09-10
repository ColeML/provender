import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { requireBearerToken } from "./bearer";

function appWith() {
  const app = new Hono();
  app.use("/*", requireBearerToken);
  app.get("/thing", (c) => c.json({ ok: true }));

  return app;
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

/** Every line either logger wrote, as one string to search for a leaked secret. */
function loggedText() {
  return [...warn.mock.calls, ...error.mock.calls].flat().join("\n");
}

function loggedJson(spy: MockInstance<typeof console.warn>) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("requireBearerToken", () => {
  it("allows a request carrying the right token", async () => {
    vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

    const response = await appWith().request("/thing", {
      headers: { Authorization: "Bearer s3cret" },
    });

    expect(response.status).toBe(200);
  });

  it("logs nothing when the token is accepted", async () => {
    vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

    await appWith().request("/thing", { headers: { Authorization: "Bearer s3cret" } });

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["no Authorization header", {}],
    ["a wrong token", { Authorization: "Bearer nope" }],
    ["a token of a different length", { Authorization: "Bearer s3cret-but-longer" }],
    ["the right token without the Bearer scheme", { Authorization: "s3cret" }],
    ["an empty bearer value", { Authorization: "Bearer " }],
  ])("refuses %s", async (_name, headers) => {
    vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

    const response = await appWith().request("/thing", { headers });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 401,
        message: "A valid bearer token is required",
        status: "UNAUTHENTICATED",
      },
    });
  });

  it("refuses everything when no token is configured, rather than allowing it", async () => {
    vi.stubEnv("PROVENDER_API_TOKEN", "");

    const response = await appWith().request("/thing", {
      headers: { Authorization: "Bearer anything" },
    });

    expect(response.status).toBe(401);
  });

  describe("logging", () => {
    it("records a wrong token once, as the caller's fault", async () => {
      vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

      await appWith().request("/thing", { headers: { Authorization: "Bearer nope" } });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(error).not.toHaveBeenCalled();
      expect(loggedJson(warn)[0]).toEqual({
        level: "warn",
        event: "auth.bearer_rejected",
        method: "GET",
        path: "/thing",
        reason: "wrong_token",
      });
    });

    it("distinguishes a missing token from a wrong one", async () => {
      vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

      await appWith().request("/thing");

      expect(loggedJson(warn)[0]).toMatchObject({
        event: "auth.bearer_rejected",
        reason: "no_token",
      });
    });

    it("records an unset PROVENDER_API_TOKEN distinctly, as a deploy fault", async () => {
      vi.stubEnv("PROVENDER_API_TOKEN", "");

      await appWith().request("/thing", { headers: { Authorization: "Bearer s3cret" } });

      expect(warn).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(loggedJson(error)[0]).toEqual({
        level: "error",
        event: "auth.api_token_unset",
        method: "GET",
        path: "/thing",
      });
    });

    it("never writes a token value, configured or supplied", async () => {
      vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

      await appWith().request("/thing", { headers: { Authorization: "Bearer wrong-guess" } });

      expect(loggedText()).not.toContain("s3cret");
      expect(loggedText()).not.toContain("wrong-guess");
    });
  });
});

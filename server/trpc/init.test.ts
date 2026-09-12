import { db } from "@server/db";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Context } from "./context";
import { logTrpcError, protectedProcedure, publicProcedure, router } from "./init";

const testRouter = router({
  prices: router({
    refresh: publicProcedure.query(() => {
      throw new Error("prices lookup failed");
    }),
  }),
  savePlan: publicProcedure.input(z.object({ note: z.string() })).mutation(() => {
    throw new Error("write failed");
  }),
  scale: publicProcedure.input(z.object({ servings: z.number() })).query(() => "ok"),
  week: protectedProcedure.query(() => "ok"),
});

function signedOutContext(): Context {
  return { db, session: null, householdId: null };
}

function call(path: string, init?: { method: "POST"; body: unknown }) {
  const url = `http://localhost/api/trpc/${path}`;
  const request = init
    ? new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer super-secret-token" },
        body: JSON.stringify({ json: init.body }),
      })
    : new Request(url);

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: testRouter,
    createContext: signedOutContext,
    onError: logTrpcError,
  });
}

function loggedLine(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(String(spy.mock.calls[0]?.[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tRPC error logging", () => {
  it("writes one error line carrying the same fields /v1 writes for a request that threw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("prices.refresh");

    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);

    const line = loggedLine(error);

    // `api.unhandled_error` carries method, path, message and stack. Same fields, same meaning.
    expect(Object.keys(line).sort()).toEqual([
      "code",
      "event",
      "message",
      "method",
      "path",
      "severity",
      "stack",
    ]);
    expect(line).toMatchObject({
      severity: "error",
      event: "trpc.unhandled_error",
      method: "GET",
      path: "prices.refresh",
      code: "INTERNAL_SERVER_ERROR",
      message: "prices lookup failed",
      stack: expect.stringContaining("prices lookup failed"),
    });
  });

  it("logs a refused caller as a warning, keeping it apart from a deployment fault", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call("week");

    expect(response.status).toBe(401);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(loggedLine(warn)).toEqual({
      severity: "warn",
      event: "auth.session_rejected",
      method: "GET",
      path: "week",
      code: "UNAUTHORIZED",
    });
  });

  it("spends no line on an input a caller got wrong, so no input value reaches the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await call(
      "scale?input=" + encodeURIComponent('{"json":{"servings":"four"}}'),
    );

    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps the request body and its headers out of the line when a mutation throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await call("savePlan", { method: "POST", body: { note: "correct-horse-battery-staple" } });

    expect(error).toHaveBeenCalledTimes(1);

    const line = String(error.mock.calls[0]?.[0]);

    expect(line).not.toContain("correct-horse-battery-staple");
    expect(line).not.toContain("super-secret-token");
  });
});

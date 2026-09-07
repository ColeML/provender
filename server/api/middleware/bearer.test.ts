import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requireBearerToken } from "./bearer";

function appWith() {
  const app = new Hono();
  app.use("/*", requireBearerToken);
  app.get("/thing", (c) => c.json({ ok: true }));

  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireBearerToken", () => {
  it("allows a request carrying the right token", async () => {
    vi.stubEnv("PROVENDER_API_TOKEN", "s3cret");

    const response = await appWith().request("/thing", {
      headers: { Authorization: "Bearer s3cret" },
    });

    expect(response.status).toBe(200);
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
});

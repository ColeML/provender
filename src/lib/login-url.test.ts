import { describe, expect, it, vi } from "vitest";

const requestHeaders = new Headers();

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { isInternalPath, loginUrl, REQUESTED_PATH_HEADER } = await import("./login-url");

function asked(path: string | null) {
  if (path === null) {
    requestHeaders.delete(REQUESTED_PATH_HEADER);
  } else {
    requestHeaders.set(REQUESTED_PATH_HEADER, path);
  }
}

describe("loginUrl", () => {
  it("remembers the page the visitor asked for", async () => {
    asked("/shop");

    expect(await loginUrl()).toBe("/login?from=%2Fshop");
  });

  it("keeps the query string, encoded", async () => {
    asked("/recipes?q=stew&sort=title");

    expect(await loginUrl()).toBe("/login?from=%2Frecipes%3Fq%3Dstew%26sort%3Dtitle");
  });

  it("falls back to the bare login page when the proxy left no path", async () => {
    asked(null);

    expect(await loginUrl()).toBe("/login");
  });

  it.each([
    "//evil.test/phish",
    "/\\evil.test/phish",
    "/\t/evil.test/phish",
    "https://evil.test",
    "shop",
  ])("refuses to carry %s, which would send the visitor off this origin", async (path) => {
    asked(path);

    expect(await loginUrl()).toBe("/login");
  });
});

describe("isInternalPath", () => {
  it.each(["/", "/shop", "/recipes?q=stew"])("accepts %s", (path) => {
    expect(isInternalPath(path)).toBe(true);
  });

  it.each([
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "/\n\\evil.test/phish",
    "https://evil.test",
    "shop",
    "",
  ])("rejects %s", (path) => {
    expect(isInternalPath(path)).toBe(false);
  });
});

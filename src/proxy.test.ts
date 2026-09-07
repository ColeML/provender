import type { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

function request(pathname: string, cookies: string[] = []) {
  return {
    nextUrl: { pathname, search: "" },
    url: `https://provender.test${pathname}`,
    cookies: { has: (name: string) => cookies.includes(name) },
  } as unknown as NextRequest;
}

describe("proxy", () => {
  it("sends a cookie-less browser to the login page", () => {
    const response = proxy(request("/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://provender.test/login?from=%2F");
  });

  it("remembers where the caller was going", () => {
    const response = proxy(request("/shop"));

    expect(response.headers.get("location")).toContain("from=%2Fshop");
  });

  it.each(["authjs.session-token", "__Secure-authjs.session-token"])(
    "lets a request carrying %s through",
    (cookie) => {
      expect(proxy(request("/", [cookie])).headers.get("location")).toBeNull();
    },
  );

  it.each(["/login", "/api/auth/callback/credentials"])("never gates %s", (path) => {
    expect(proxy(request(path)).headers.get("location")).toBeNull();
  });

  it("leaves /v1 alone, so an API client gets a 401 rather than an HTML login page", () => {
    expect(proxy(request("/v1/config")).headers.get("location")).toBeNull();
  });
});

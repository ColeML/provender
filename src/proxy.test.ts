import type { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { REQUESTED_PATH_HEADER } from "./lib/login-url";
import { proxy } from "./proxy";

function request(pathname: string, cookies: string[] = [], search = "") {
  return {
    nextUrl: { pathname, search },
    url: `https://provender.test${pathname}${search}`,
    headers: new Headers(),
    cookies: { has: (name: string) => cookies.includes(name) },
  } as unknown as NextRequest;
}

/**
 * A header the proxy set on the *request*, which Next carries on the response under this prefix
 * until it hands the request to the route. There is no public reader for it.
 */
function requestHeader(response: NextResponse, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
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

  it("leaves /api/trpc alone, so a signed-out browser call parses JSON rather than HTML", () => {
    expect(proxy(request("/api/trpc/config.get")).headers.get("location")).toBeNull();
  });

  it("tells the page which path was asked for, so an unverified cookie still redirects with a from", () => {
    const response = proxy(request("/shop", ["authjs.session-token"]));

    expect(requestHeader(response, REQUESTED_PATH_HEADER)).toBe("/shop");
  });

  it("carries the query string through to the page as well", () => {
    const response = proxy(request("/recipes", ["authjs.session-token"], "?q=stew"));

    expect(requestHeader(response, REQUESTED_PATH_HEADER)).toBe("/recipes?q=stew");
  });
});

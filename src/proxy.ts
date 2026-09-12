import { NextResponse, type NextRequest } from "next/server";

import { REQUESTED_PATH_HEADER } from "@/lib/login-url";

/**
 * The app-wide gate — an optimistic one.
 *
 * This checks only that a session cookie is *present*. It does not verify it, and it is not the
 * security boundary: Next's own guidance is that Proxy should not be used for session management
 * or authorization, and verifying a JWT here would also force the Auth.js config to be split into
 * edge-safe and Node halves. The real checks run server-side — `auth()` in Server Components,
 * `protectedProcedure` in tRPC, and the bearer middleware on `/v1`. This layer exists so an
 * unauthenticated browser lands on the login page instead of an error.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/** Paths that must answer before anyone has a session. */
const PUBLIC_PATHS = ["/login", "/api/auth"];

/**
 * Paths that answer JSON, so a redirect to an HTML login page would be a useless answer — the
 * caller is parsing a body, not following a `Location`. Both refuse on their own: `/v1` in the
 * AIP-193 shape from its bearer middleware, `/api/trpc` as a tRPC `UNAUTHORIZED` from
 * `protectedProcedure`.
 */
const JSON_PATHS = ["/v1", "/api/trpc"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Segment-wise, not a raw prefix: `startsWith("/login")` would also admit `/loginish`.
  const ungated = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  if ([...PUBLIC_PATHS, ...JSON_PATHS].some(ungated)) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  const requested = pathname + request.nextUrl.search;

  if (hasSession) {
    // Unverified, so the page's own `auth()` may still turn this visitor away. Pass the path on
    // so that redirect can carry a `from` as well (#93).
    const forwarded = new Headers(request.headers);

    forwarded.set(REQUESTED_PATH_HEADER, requested);

    return NextResponse.next({ request: { headers: forwarded } });
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("from", requested);

  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own build output and static files. Those carry no data and gating
  // them would keep the login page from rendering its own stylesheet.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

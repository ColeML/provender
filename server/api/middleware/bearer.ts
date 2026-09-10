import { timingSafeEqual } from "node:crypto";
import { apiError } from "@server/api/errors";
import { householdForApiToken } from "@server/auth/household";
import { logError, logWarn } from "@server/lib/log";
import { createMiddleware } from "hono/factory";

/**
 * Compare in constant time.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, which would both crash the
 * request and confirm the token's length to whoever probed it. The length is checked first, and
 * the mismatch branch still does a comparison sized to the supplied token so a wrong-length guess
 * is not measurably faster to reject than a wrong-value one.
 */
function tokensMatch(provided: string, expected: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    // Still do the work, so a wrong-length token is not measurably faster to reject.
    timingSafeEqual(a, a);

    return false;
  }

  return timingSafeEqual(a, b);
}

/**
 * Bearer authentication for `/v1`.
 *
 * This is the agent's credential — Claude Code sends it, browsers never do. It is deliberately
 * unrelated to the session cookie: neither mechanism can admit the other's caller.
 */
/** Set once the token is accepted, so a handler cannot reach a service without a household. */
export type ApiEnv = { Variables: { householdId: string } };

export const requireBearerToken = createMiddleware<ApiEnv>(async (c, next) => {
  const expected = process.env.PROVENDER_API_TOKEN;

  if (!expected) {
    // No token configured means nothing can be authenticated, so refuse rather than allow. This
    // is a broken deploy rather than a bad caller, and every request will fail until it is fixed.
    logError("auth.api_token_unset", { method: c.req.method, path: c.req.path });

    return apiError(c, "UNAUTHENTICATED", "The API is not configured to accept requests");
  }

  const header = c.req.header("Authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!provided || !tokensMatch(provided, expected)) {
    // The token itself is never logged — the reason separates a caller who sent nothing from one
    // whose token is wrong, which is as much as anyone needs to debug it.
    logWarn("auth.bearer_rejected", {
      method: c.req.method,
      path: c.req.path,
      reason: provided ? "wrong_token" : "no_token",
    });

    return apiError(c, "UNAUTHENTICATED", "A valid bearer token is required");
  }

  c.set("householdId", householdForApiToken(provided));

  await next();
});

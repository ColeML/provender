import "server-only";

import { DEFAULT_HOUSEHOLD_ID } from "@server/db/schema/households";

import type { Session } from "next-auth";

/**
 * Which household a request belongs to.
 *
 * A household is never named in a URL — the caller does not choose it, so putting it in the path
 * would lengthen every resource name to express something that is never ambiguous. It is resolved
 * from identity instead.
 *
 * Both functions take the credential they resolve from even though neither reads it yet. There is
 * one household today, so returning a constant is correct — but a resolver that accepted nothing
 * would have to grow a parameter at every call site later, and the tempting shortcut of reading
 * the session inside the function would silently return the wrong household on the bearer path,
 * where there is no session at all.
 */
export function householdForSession(_session: Session): string {
  return DEFAULT_HOUSEHOLD_ID;
}

export function householdForApiToken(_token: string): string {
  return DEFAULT_HOUSEHOLD_ID;
}

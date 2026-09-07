import "server-only";

import { DEFAULT_HOUSEHOLD_ID } from "@server/db/schema/households";

/**
 * Which household a request belongs to.
 *
 * A household is never named in a URL — the caller does not choose it, so putting it in the path
 * would lengthen every resource name to express something that is never ambiguous. It is resolved
 * from identity instead.
 *
 * Today there is one household and both credentials map to it. When family accounts arrive, the
 * session carries which household its user belongs to and each household gets its own token; this
 * is the single place either has to change, and every service already refuses to run without the
 * answer.
 */
export function householdForSession(): string {
  return DEFAULT_HOUSEHOLD_ID;
}

export function householdForApiToken(): string {
  return DEFAULT_HOUSEHOLD_ID;
}

import { headers } from "next/headers";

/**
 * The path the visitor asked for, as the proxy saw it.
 *
 * The proxy admits any request carrying a session cookie without verifying it, so a malformed or
 * expired cookie reaches the page and the page's own `auth()` is what turns the visitor away. By
 * then the pathname is no longer on the request the page can read, so the proxy leaves it here.
 */
export const REQUESTED_PATH_HEADER = "x-requested-path";

/** Stands in for the real origin, which this app never needs to know to answer the question. */
const SAME_ORIGIN = "https://provender.invalid";

/**
 * Whether a `from` is a path on this app rather than somewhere else.
 *
 * Asked as a question about where the value resolves, not as a list of prefixes to refuse. The URL
 * parser strips tabs and newlines and reads a backslash as a separator before it settles on an
 * origin, so `/\t/evil.test` is off-site while passing any prefix check.
 */
export function isInternalPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }

  try {
    return new URL(path, SAME_ORIGIN).origin === SAME_ORIGIN;
  } catch {
    return false;
  }
}

/** Where to send a signed-out visitor, remembering the page they asked for. */
export async function loginUrl(): Promise<string> {
  const requested = (await headers()).get(REQUESTED_PATH_HEADER);

  if (!requested || !isInternalPath(requested)) {
    return "/login";
  }

  return `/login?from=${encodeURIComponent(requested)}`;
}

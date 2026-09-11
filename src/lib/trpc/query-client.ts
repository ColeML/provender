import type { AppRouter } from "@server/trpc/routers";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";

/** Only the parts of `Location` this needs, so a test can pass a plain object. */
type Navigable = Pick<Location, "pathname" | "search" | "assign">;

function isSignedOut(error: unknown) {
  return isTRPCClientError<AppRouter>(error) && error.data?.code === "UNAUTHORIZED";
}

/**
 * Sends the browser to sign in again.
 *
 * A full navigation rather than a router push, because the dead session and the cache fetched
 * under it should both go. `location` is undefined on the server, where no navigation is possible
 * and the caller is the one that has to answer.
 */
export function signOutRedirect(location: Navigable | undefined = globalThis.location) {
  if (!location || location.pathname === "/login") {
    return;
  }

  location.assign(`/login?from=${encodeURIComponent(location.pathname + location.search)}`);
}

/**
 * No dehydrate/hydrate options: pages hand server-loaded data to client components as props, so
 * no query is ever dehydrated. Add them back with the first server-side prefetch.
 *
 * `onSignedOut` is the sole reaction to an `UNAUTHORIZED` reply. The proxy lets `/api/trpc`
 * through unredirected so a browser call gets JSON rather than a login page, which leaves the
 * expired session for the client to act on — without this it would read as data that never
 * arrives.
 */
export function makeQueryClient(onSignedOut: () => void = signOutRedirect) {
  // One batched request rejects every query in it, so the handler runs several times for a single
  // expired session — and each `location.assign` restarts the navigation already in flight.
  let handled = false;

  const handleError = (error: unknown) => {
    if (!isSignedOut(error) || handled) {
      return;
    }

    handled = true;
    onSignedOut();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        // Long enough that a remount does not refetch what was just fetched, short enough that a
        // stale week plan does not linger.
        staleTime: 30 * 1000,
        // A signed-out reply will not change on a retry, and retrying it three times with backoff
        // would hold the screen for seconds before the redirect. The count restates query-core's
        // own default, which defining `retry` at all would otherwise replace — including its zero
        // on the server, where a retry only delays the response.
        retry: (failureCount, error) =>
          !isSignedOut(error) && failureCount < (typeof globalThis.window === "undefined" ? 0 : 3),
      },
    },
  });
}

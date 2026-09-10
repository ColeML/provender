import { QueryClient } from "@tanstack/react-query";

/**
 * No dehydrate/hydrate options: pages hand server-loaded data to client components as props, so
 * no query is ever dehydrated. Add them back with the first server-side prefetch.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that a remount does not refetch what was just fetched, short enough that a
        // stale week plan does not linger.
        staleTime: 30 * 1000,
      },
    },
  });
}

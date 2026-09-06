import "server-only";

import { getConfig } from "@server/services/config";

import { publicProcedure, router } from "../init";

/**
 * The application router. Every procedure the client can call is reachable from here, and its
 * *type* is what gives the browser end-to-end type safety with no code generation step.
 *
 * Procedures delegate to `server/services/*` and decide nothing themselves — see the note in
 * `server/services/config.ts`.
 */
export const appRouter = router({
  config: router({
    get: publicProcedure.query(({ ctx }) => getConfig(ctx.db)),
  }),
});

export type AppRouter = typeof appRouter;

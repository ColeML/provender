import "server-only";

import { logError, logWarn } from "@server/lib/log";
import { initTRPC, TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import superjson from "superjson";
import { flattenError, ZodError } from "zod";

import type { Context } from "./context";

/**
 * The tRPC instance and the procedure builders every router is assembled from.
 *
 * superjson as the transformer because the domain is full of `Date`s — plan days, history
 * entries, price `updated`. Plain JSON turns those into strings somewhere between the server and
 * the component, and the resulting bugs are the quiet kind.
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? flattenError(error.cause) : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

/**
 * A procedure with no authentication requirement.
 *
 * Deliberately named for what it is. There is no bare `procedure` export, because the difference
 * between "I meant this to be public" and "I forgot the middleware" should be visible in the
 * diff, not inferred from its absence.
 */
export const publicProcedure = t.procedure;

/**
 * Requires a signed-in household session.
 *
 * The verification itself happened in the context, against the real cookie — the proxy's
 * cookie-presence check is a redirect convenience and proves nothing, so this cannot lean on it.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user || !ctx.householdId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  }

  // Narrow both to non-null for everything downstream, so a procedure cannot forget to check the
  // session or reach a service without a household.
  return next({ ctx: { ...ctx, session: ctx.session, householdId: ctx.householdId } });
});

/**
 * The one place a tRPC failure is written to the log. Passed to `fetchRequestHandler` as `onError`.
 *
 * Without an `onError` the adapter writes nothing, in any environment — so a service exception
 * reaching a procedure left no line at all, while the same exception through `/v1` left
 * `api.unhandled_error`. The fields match that event so the two transports read alike, and the
 * severity split is the one `/v1` already makes: a refused caller is a `warn`, a request that
 * threw is the deployment's fault and an `error`.
 *
 * Only the error's own code, message and stack reach the log. The input never does, because it is
 * whatever the caller sent.
 */
export function logTrpcError({
  error,
  path,
  req,
}: {
  error: TRPCError;
  path: string | undefined;
  req: Request;
}) {
  // `path` is absent when the failure happened before a procedure was resolved.
  const where = { method: req.method, path: path ?? "<unknown>", code: error.code };

  if (error.code === "UNAUTHORIZED") {
    logWarn("auth.session_rejected", where);

    return;
  }

  // Any other 4xx is the caller's to fix, and `/v1` spends no line on one either. A zod rejection
  // is the case that matters: its message quotes the input that failed validation.
  if (getHTTPStatusCodeFromError(error) < 500) {
    return;
  }

  // `code` separates a dependency a procedure reported as down from a procedure that crashed;
  // both are 5xx and both are the deployment's problem, but they are not the same thing to fix.
  logError("trpc.unhandled_error", {
    ...where,
    message: error.message,
    stack: error.stack ?? "",
  });
}

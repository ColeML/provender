import "server-only";

import { initTRPC } from "@trpc/server";
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
 * diff, not inferred from its absence. `protectedProcedure` arrives with auth.
 */
export const publicProcedure = t.procedure;

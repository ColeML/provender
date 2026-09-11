import { verifyPassword } from "@server/auth/password";
import type { Database } from "@server/db";
import { logError, logWarn } from "@server/lib/log";
import {
  clearLoginAttempts,
  clientAddress,
  registerLoginAttempt,
} from "@server/services/login-throttle";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig, User } from "next-auth";

/**
 * Who a submitted password admits, and why a rejection happened.
 *
 * Named and exported so a test can call it directly: `Credentials()` hides the callback it was
 * given inside an `options` field that Auth.js merges at request time, so reaching it through the
 * provider means asserting on that library's internals. `db` is a parameter with a default for
 * the same reason it is on every service — a test passes a stub instead of mocking the module
 * graph.
 */
export async function authorizeHousehold(
  credentials: Partial<Record<string, unknown>>,
  request?: Request,
  db?: Database,
): Promise<User | null> {
  const password = credentials?.password;
  const storedHash = process.env.AUTH_PASSWORD_HASH;

  if (typeof password !== "string") {
    logWarn("auth.password_rejected", { reason: "no_password" });

    return null;
  }

  if (!storedHash) {
    logError("auth.password_hash_unset");

    return null;
  }

  const client = clientAddress(request);
  const { throttled } = await registerLoginAttempt(client, new Date(), db);

  // Verified even when the answer is already no. Skipping scrypt would return a throttled attempt
  // in a fraction of the time a wrong password takes, and that difference is what a prober needs
  // to find where the limit sits.
  const correct = await verifyPassword(password, storedHash);

  // Only the log distinguishes the two. The caller gets the same null, so the same redirect and
  // the same message, whichever it was.
  if (throttled) {
    logWarn("auth.password_rejected", { reason: "throttled" });

    return null;
  }

  if (!correct) {
    logWarn("auth.password_rejected", { reason: "wrong_password" });

    return null;
  }

  await clearLoginAttempts(client, db);

  // A single shared identity, so the subject is a constant rather than anything derived from what
  // was typed.
  return { id: "household", name: "Household" };
}

/**
 * The error Auth.js wrapped, if it wrapped one.
 *
 * An `AuthError`'s own message is only a link to the docs; whatever actually failed inside
 * `authorize` is at `cause.err`. Three named fields are read off it rather than the cause being
 * spread, because the rest of that object is whatever Auth.js and the thrown error attached and
 * its shape is not ours to guarantee free of a credential.
 */
function wrappedCause(error: Error): Error | undefined {
  const cause: unknown = error.cause;

  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    return cause.err;
  }

  return undefined;
}

/**
 * One shared household login.
 *
 * There is no user table and no adapter: the JWT session strategy keeps the whole session in the
 * cookie, which is all a single shared account needs. When per-person accounts arrive, this grows
 * an adapter and the services grow an owner column — see `coding-standards.md`.
 */
export const authConfig = {
  providers: [
    Credentials({
      credentials: { password: { label: "Password", type: "password" } },
      authorize: authorizeHousehold,
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  logger: {
    /**
     * Auth.js writes its own `console.error` for anything thrown inside it, and a rejected
     * password reaches it as a `CredentialsSignin`. Left alone that makes a mistyped password two
     * log lines, the louder of them at error level, which is the deployment's level and not the
     * caller's. `authorizeHousehold` has already recorded it.
     */
    error(error) {
      // Matched by name rather than `instanceof`: importing the error class from `next-auth`
      // pulls its Next server entry into every module that reads this config.
      if (error.name === "CredentialsSignin") {
        return;
      }

      const cause = wrappedCause(error);

      logError("auth.internal_error", {
        name: error.name,
        message: error.message,
        ...(cause && {
          causeName: cause.name,
          causeMessage: cause.message,
          causeStack: cause.stack ?? "",
        }),
      });
    },
  },
} satisfies NextAuthConfig;

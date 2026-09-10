import { verifyPassword } from "@server/auth/password";
import { logError, logWarn } from "@server/lib/log";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig, User } from "next-auth";

/**
 * Who a submitted password admits, and why a rejection happened.
 *
 * Named and exported so a test can call it directly: `Credentials()` hides the callback it was
 * given inside an `options` field that Auth.js merges at request time, so reaching it through the
 * provider means asserting on that library's internals.
 */
export async function authorizeHousehold(
  credentials: Partial<Record<string, unknown>>,
): Promise<User | null> {
  const password = credentials?.password;
  const storedHash = process.env.AUTH_PASSWORD_HASH;

  if (typeof password !== "string") {
    logWarn("auth.password_rejected", { reason: "no_password" });

    return null;
  }

  if (!storedHash) {
    // A broken deploy rather than a bad caller: nobody can sign in until it is fixed.
    logError("auth.password_hash_unset");

    return null;
  }

  if (!(await verifyPassword(password, storedHash))) {
    // What was typed is never logged, so a mistyped password cannot reach the log.
    logWarn("auth.password_rejected", { reason: "wrong_password" });

    return null;
  }

  // A single shared identity, so the subject is a constant rather than anything derived from what
  // was typed.
  return { id: "household", name: "Household" };
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

      logError("auth.internal_error", { name: error.name, message: error.message });
    },
  },
} satisfies NextAuthConfig;

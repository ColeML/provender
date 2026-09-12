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
  const verdict = await registerLoginAttempt(client, new Date(), db);

  // Verified even when the answer is already no. Skipping scrypt would return a throttled attempt
  // in a fraction of the time a wrong password takes, and that difference is what a prober needs
  // to find where the limit sits.
  const correct = await verifyPassword(password, storedHash);

  // Refusals are enumerated by what is *not* `allowed`, so a verdict added later refuses until
  // someone decides otherwise.
  if (verdict !== "allowed") {
    // Only `throttled` is the caller's doing. An `unavailable` verdict is the deployment's, and
    // `auth.throttle_unavailable` has already recorded it at error level — a line here would be
    // byte-for-byte a rate-limit hit, so a database outage would read as someone guessing the
    // password.
    if (verdict === "throttled") {
      logWarn("auth.password_rejected", { reason: "throttled" });
    }

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
 * What kind of error Auth.js raised, in a form a production build cannot mangle.
 *
 * `AuthError` sets `name` from `this.constructor.name`, which SWC minifies to a single letter, so
 * matching on the name works in dev and silently fails in production (#113). `type` is a static
 * string literal on the class and survives intact. `instanceof` is not an option: importing the
 * error class from `next-auth` pulls its Next server entry into every module that reads this
 * config.
 */
function authErrorType(error: Error): string | undefined {
  if ("type" in error && typeof error.type === "string") {
    return error.type;
  }

  return undefined;
}

/** Every environment variable whose value must never reach a log line. */
const SECRETS = [
  "AUTH_SECRET",
  "AUTH_PASSWORD_HASH",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "PROVENDER_API_TOKEN",
  "KROGER_CLIENT_SECRET",
] as const;

/**
 * Strips configured secrets out of third-party text.
 *
 * What Auth.js wrapped is whatever threw inside it, and a driver error can quote the connection
 * string it failed to open, password and all. Only a whole configured value is matched, so this
 * is a floor under the message and stack, not a promise about text this app never wrote.
 */
function redactSecrets(text: string): string {
  let safe = text;

  for (const variable of SECRETS) {
    const secret = process.env[variable];

    if (secret) {
      safe = safe.replaceAll(secret, "[redacted]");
    }
  }

  return safe;
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
      const type = authErrorType(error);

      if (type === "CredentialsSignin") {
        return;
      }

      const cause = wrappedCause(error);

      logError("auth.internal_error", {
        // The type, so the field a search is built on stays the same string a production build
        // mangles `name` away from.
        name: type ?? error.name,
        message: redactSecrets(error.message),
        ...(cause && {
          causeName: cause.name,
          causeMessage: redactSecrets(cause.message),
          causeStack: redactSecrets(cause.stack ?? ""),
        }),
      });
    },
  },
} satisfies NextAuthConfig;

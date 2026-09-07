import { verifyPassword } from "@server/auth/password";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";

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
      async authorize(credentials) {
        const password = credentials?.password;

        if (typeof password !== "string") {
          return null;
        }

        const valid = await verifyPassword(password, process.env.AUTH_PASSWORD_HASH);

        // A single shared identity, so the subject is a constant rather than anything derived
        // from what was typed.
        return valid ? { id: "household", name: "Household" } : null;
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
} satisfies NextAuthConfig;

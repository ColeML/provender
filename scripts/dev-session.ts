/**
 * Mint a session cookie for a local dev server, so a browser or a curl can reach a signed-in page
 * without the login form.
 *
 * Usage: pnpm tsx scripts/dev-session.ts
 * Prints `authjs.session-token=<jwt>`, ready for a `Cookie:` header.
 *
 * This exists because validating a signed-in surface otherwise means typing the household
 * password, and an automated check cannot. It is not a back door: the cookie is signed with
 * AUTH_SECRET, so it admits nobody who could not already mint one from the same value, and the
 * name is the unprefixed cookie a dev server over http reads — a deployment sets
 * `__Secure-authjs.session-token`, which this never produces.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encode } from "next-auth/jwt";

/** The cookie Auth.js reads over http, and the salt it derives the signing key with. */
export const DEV_SESSION_COOKIE = "authjs.session-token";

const DEFAULT_MAX_AGE_SECONDS = 60 * 60;

export async function mintDevSession({
  secret,
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
}: {
  secret: string;
  maxAgeSeconds?: number;
}): Promise<{ name: string; value: string }> {
  if (!secret) {
    throw new Error("AUTH_SECRET is empty. Set it in .env — openssl rand -base64 32");
  }

  const value = await encode({
    salt: DEV_SESSION_COOKIE,
    secret,
    maxAge: maxAgeSeconds,
    // What `authorizeHousehold` returns: one shared identity, so the subject is a constant.
    token: { sub: "household", name: "Household" },
  });

  return { name: DEV_SESSION_COOKIE, value };
}

/**
 * Reads AUTH_SECRET from the env files, which `next dev` loads but tsx does not.
 *
 * .env.local first, then .env, matching `server/load-env.ts` — dotenv does not overwrite a key it
 * has already set, so .env.local wins there and has to win here too. Signing with the other file's
 * value would mint a cookie the running server rejects, with nothing in the output to say why.
 */
export function secretFromEnvFile(dir = "."): string {
  for (const file of [".env.local", ".env"]) {
    let contents: string;

    try {
      contents = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }

    const secret = /^AUTH_SECRET=(.*)$/m.exec(contents)?.[1]?.trim();

    if (secret) {
      return secret;
    }
  }

  return "";
}

async function main() {
  const cookie = await mintDevSession({ secret: secretFromEnvFile() });

  console.log(`${cookie.name}=${cookie.value}`);
}

if (process.argv[1]?.endsWith("dev-session.ts")) {
  main();
}

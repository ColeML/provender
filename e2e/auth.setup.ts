import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { mintDevSession, secretFromEnvFile } from "../scripts/dev-session";

const STATE_PATH = "./e2e/.auth/state.json";

/**
 * Write a signed-in storage state, so no test drives the login form.
 *
 * The cookie is minted from AUTH_SECRET rather than typed, which is what lets an automated run
 * reach a signed-in page at all — see `scripts/dev-session.ts`.
 */
export default async function globalSetup() {
  const cookie = await mintDevSession({ secret: secretFromEnvFile() });

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(
    STATE_PATH,
    JSON.stringify({
      cookies: [
        {
          name: cookie.name,
          value: cookie.value,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}

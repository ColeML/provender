import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decode } from "next-auth/jwt";
import { describe, expect, it } from "vitest";

import { DEV_SESSION_COOKIE, mintDevSession, secretFromEnvFile } from "./dev-session";

const SECRET = "a-test-secret-long-enough-for-hkdf-to-be-happy";

describe("mintDevSession", () => {
  it("mints a cookie Auth.js can decode back to the household subject", async () => {
    const cookie = mintDevSession({ secret: SECRET });

    await expect(
      decode({ token: (await cookie).value, secret: SECRET, salt: DEV_SESSION_COOKIE }),
    ).resolves.toMatchObject({ sub: "household" });
  });

  it("names the cookie the one the dev server reads, not the secure variant", async () => {
    const cookie = await mintDevSession({ secret: SECRET });

    expect(cookie.name).toBe("authjs.session-token");
  });

  it("refuses an empty secret rather than signing with one", async () => {
    await expect(mintDevSession({ secret: "" })).rejects.toThrow(/AUTH_SECRET/);
  });

  it("expires the session, so a forgotten cookie stops working", async () => {
    const cookie = await mintDevSession({ secret: SECRET, maxAgeSeconds: 900 });
    const claims = await decode({
      token: cookie.value,
      secret: SECRET,
      salt: DEV_SESSION_COOKIE,
    });

    const lifetime = (claims?.exp ?? 0) - Math.floor(Date.now() / 1000);

    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(900);
  });
});

describe("secretFromEnvFile", () => {
  /**
   * `server/load-env.ts` loads .env.local before .env, and dotenv does not overwrite a key it has
   * already set, so .env.local wins. Reading only .env would sign the cookie with a secret the
   * dev server is not using, and every request would then 401 for no visible reason.
   */
  it("prefers .env.local, the way the dev server's own loader does", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dev-session-"));

    await writeFile(join(dir, ".env"), "AUTH_SECRET=from-dot-env\n");
    await writeFile(join(dir, ".env.local"), "AUTH_SECRET=from-dot-env-local\n");

    expect(secretFromEnvFile(dir)).toBe("from-dot-env-local");
  });

  it("falls back to .env when .env.local does not set it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dev-session-"));

    await writeFile(join(dir, ".env"), "AUTH_SECRET=from-dot-env\n");

    expect(secretFromEnvFile(dir)).toBe("from-dot-env");
  });
});

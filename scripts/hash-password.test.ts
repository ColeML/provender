import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { verifyPassword } from "../server/auth/password";

const run = promisify(execFile);

function runScript(stdin: string) {
  const child = run("pnpm", ["-s", "tsx", "scripts/hash-password.ts"]);

  child.child.stdin?.end(stdin);

  return child;
}

/**
 * Runs the script for real rather than importing it.
 *
 * The bug this guards against was a syntax-level failure — top-level await under tsx's CommonJS
 * transform — which no import-based test would have caught, and which is silent inside a `$(...)`
 * substitution: the script exits non-zero, prints nothing, and the caller gets an empty hash.
 */
describe("scripts/hash-password.ts", () => {
  it("prints a hash that verifies against the password it read from stdin", async () => {
    const { stdout } = await runScript("hunter2\n");

    await expect(verifyPassword("hunter2", stdout.trim())).resolves.toBe(true);
    await expect(verifyPassword("wrong", stdout.trim())).resolves.toBe(false);
  }, 60_000);

  it("prints only the hash on stdout, so it can be redirected to a file", async () => {
    const { stdout } = await runScript("hunter2\n");

    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stdout).toMatch(/^[0-9a-f]+:[0-9a-f]+$/m);
  }, 60_000);

  it("exits non-zero when given no password", async () => {
    await expect(runScript("\n")).rejects.toMatchObject({ code: 1 });
  }, 60_000);
});

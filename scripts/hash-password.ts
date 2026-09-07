/**
 * Generate the value for AUTH_PASSWORD_HASH.
 *
 * Usage: pnpm tsx scripts/hash-password.ts
 * Then type the password and press Enter. It is not echoed.
 *
 * The password is read from stdin rather than argv on purpose: an argument lands in shell history
 * and is visible in the process table to every other process on the machine for as long as the
 * hash takes to compute.
 */
import { createInterface } from "node:readline/promises";

import { hashPassword } from "../server/auth/password";

// Wrapped rather than awaited at the top level: tsx transforms this file as CommonJS, where
// top-level await is a syntax error — the script exits non-zero and prints nothing, which in a
// `$(...)` substitution silently yields an empty hash.
async function main() {
  const readline = createInterface({ input: process.stdin, output: process.stderr });

  // The prompt goes to stderr so `... > hash.txt` captures only the hash.
  const password = (await readline.question("Password: ")).trim();

  readline.close();

  if (!password) {
    console.error("No password given.");
    process.exit(1);
  }

  console.log(await hashPassword(password));
}

main();

/**
 * Generate the value for AUTH_PASSWORD_HASH.
 *
 * Usage: pnpm tsx scripts/hash-password.ts '<the shared password>'
 */
import { hashPassword } from "../server/auth/password";

// Wrapped rather than awaited at the top level: tsx transforms this file as CommonJS, where
// top-level await is a syntax error — the script exits non-zero and prints nothing, which in a
// `$(...)` substitution silently yields an empty hash.
async function main() {
  const password = process.argv[2];

  if (!password) {
    console.error("Usage: pnpm tsx scripts/hash-password.ts '<password>'");
    process.exit(1);
  }

  console.log(await hashPassword(password));
}

main();

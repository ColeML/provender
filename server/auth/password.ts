import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;

/**
 * Verification for the one shared household password.
 *
 * scrypt from `node:crypto` rather than bcrypt or argon2: it is memory-hard, it ships with Node,
 * and it means the only thing guarding the app does not depend on a native module building
 * correctly on a deploy host.
 *
 * The stored format is `<salt-hex>:<key-hex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

/**
 * Whether `password` matches `stored`.
 *
 * Fails closed on a malformed or missing hash rather than throwing. A configuration mistake
 * should lock everyone out, not surface a 500 that reveals the hash was unreadable — and an
 * exception thrown from inside an Auth.js `authorize` callback is not a denial.
 */
export async function verifyPassword(password: string, stored: string | undefined) {
  if (!stored) {
    return false;
  }

  const [saltHex, keyHex] = stored.split(":");

  if (!saltHex || !keyHex) {
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;

  try {
    expected = Buffer.from(keyHex, "hex");
    salt = Buffer.from(saltHex, "hex");
  } catch {
    return false;
  }

  if (expected.length !== KEY_LENGTH || salt.length === 0) {
    return false;
  }

  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return timingSafeEqual(actual, expected);
}

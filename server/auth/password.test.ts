import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("verifyPassword", () => {
  it("accepts the password it was hashed from", async () => {
    const stored = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery stapl", stored)).resolves.toBe(false);
  });

  it("produces a different hash each time, so the salt is real", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    expect(a).not.toBe(b);
    await expect(verifyPassword("same", a)).resolves.toBe(true);
    await expect(verifyPassword("same", b)).resolves.toBe(true);
  });

  describe("fails closed rather than throwing", () => {
    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["missing the separator", "deadbeef"],
      ["missing the key", "deadbeef:"],
      ["the wrong key length", "deadbeef:abcd"],
    ])("when the stored hash is %s", async (_name, stored) => {
      await expect(verifyPassword("anything", stored)).resolves.toBe(false);
    });
  });
});

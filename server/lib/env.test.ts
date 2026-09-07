import { describe, expect, it } from "vitest";

import { getEnv } from "./env";

const valid: Record<string, string> = {
  DATABASE_URL: "postgresql://localhost/x",
  AUTH_SECRET: "secret",
  AUTH_PASSWORD_HASH: "salt:key",
  PROVENDER_API_TOKEN: "token",
};

describe("getEnv", () => {
  it("returns the parsed environment", () => {
    expect(getEnv(valid)).toEqual(valid);
  });

  it.each(Object.keys(valid))("names %s in the error when it is missing", (key) => {
    const { [key]: _removed, ...rest } = valid;

    expect(() => getEnv(rest)).toThrowError(new RegExp(`${key} is required`));
  });

  it.each(Object.keys(valid))(
    "rejects %s when it is empty rather than passing it through",
    (key) => {
      expect(() => getEnv({ ...valid, [key]: "" })).toThrowError(new RegExp(`${key} is required`));
    },
  );
});

import { describe, expect, it } from "vitest";

import { getEnv } from "./env";

describe("getEnv", () => {
  it("returns the parsed environment", () => {
    expect(getEnv({ DATABASE_URL: "postgresql://localhost/x" })).toEqual({
      DATABASE_URL: "postgresql://localhost/x",
    });
  });

  it("names the missing variable in the error", () => {
    expect(() => getEnv({})).toThrowError(/DATABASE_URL is required/);
  });

  it("rejects an empty connection string rather than passing it through", () => {
    expect(() => getEnv({ DATABASE_URL: "" })).toThrowError(/DATABASE_URL is required/);
  });

  it("ignores auth variables, which their own consumers validate at the point of use", () => {
    expect(getEnv({ DATABASE_URL: "postgresql://localhost/x" })).not.toHaveProperty("AUTH_SECRET");
  });
});

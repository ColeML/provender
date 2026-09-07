import { describe, expect, it } from "vitest";

import { isoWeekFor as appIsoWeekFor } from "../server/lib/iso-week";

import { category, csv, isoWeekFor, num, steps, str } from "./sheet-transforms";

describe("num", () => {
  it.each([
    ["8", 8],
    [8, 8],
    ["10.19", 10.19],
    ["", null],
    [null, null],
    [undefined, null],
    ["to taste", null],
  ])("reads %p as %p", (input, expected) => {
    expect(num(input)).toBe(expected);
  });
});

describe("csv", () => {
  it("splits a tag list and trims it", () => {
    expect(csv("mexican, kid-friendly, griddle")).toEqual(["mexican", "kid-friendly", "griddle"]);
  });

  it.each(["", null, undefined, " , , "])("reads %p as an empty list", (input) => {
    expect(csv(input)).toEqual([]);
  });
});

describe("steps", () => {
  it("splits a numbered blob and drops the numbers", () => {
    expect(steps("1. Preheat the oven.\n\n2. Slice the peppers.")).toEqual([
      "Preheat the oven.",
      "Slice the peppers.",
    ]);
  });

  it("handles double-digit steps, which a naive split would mangle", () => {
    expect(steps("9. Nine.\n\n10. Ten.\n\n11. Eleven.")).toEqual(["Nine.", "Ten.", "Eleven."]);
  });

  it("keeps a part that carries no number rather than dropping it", () => {
    expect(steps("1. First.\n\nSome trailing note.")).toEqual(["First.", "Some trailing note."]);
  });

  it("keeps a number that belongs to the text", () => {
    expect(steps("1. Cut into 1/4-inch strips.")).toEqual(["Cut into 1/4-inch strips."]);
  });

  it.each(["", null, undefined])("reads %p as no steps", (input) => {
    expect(steps(input)).toEqual([]);
  });
});

describe("category", () => {
  it.each([
    ["produce", "produce"],
    ["Pantry", "pantry"],
    ["  MEAT ", "meat"],
  ])("maps %p to %p", (input, expected) => {
    expect(category(input)).toBe(expected);
  });

  it.each(["", null, undefined, "cheese aisle"])(
    "falls back to other for %p, rather than failing the import",
    (input) => {
      expect(category(input)).toBe("other");
    },
  );
});

describe("str", () => {
  it.each([
    [" hello ", "hello"],
    [null, ""],
    [undefined, ""],
    [8, "8"],
  ])("reads %p as %p", (input, expected) => {
    expect(str(input)).toBe(expected);
  });
});

describe("isoWeekFor", () => {
  it("puts the live v1 week in 2026-W36", () => {
    expect(isoWeekFor("2026-08-31")).toBe("2026-W36");
    expect(isoWeekFor("2026-09-06")).toBe("2026-W36");
  });

  /**
   * This function is duplicated from the app, because the script must run without importing
   * anything that pulls in `server-only`. This is what keeps the copy honest.
   */
  it("agrees with the app's implementation across three years of dates", () => {
    const start = Date.UTC(2025, 0, 1);

    for (let offset = 0; offset < 365 * 3; offset += 1) {
      const date = new Date(start + offset * 86_400_000).toISOString().slice(0, 10);

      expect(isoWeekFor(date), date).toBe(appIsoWeekFor(date));
    }
  });
});

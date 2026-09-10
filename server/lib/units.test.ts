import { describe, expect, it } from "vitest";

import {
  convert,
  IncompatibleUnitsError,
  isKnownUnit,
  scaleFactor,
  snapToKitchenUnit,
  UnknownUnitError,
} from "./units";

/**
 * The cases in this file are ported from v1's `python/tests/test_scale.py`.
 *
 * The fraction snapping was a deliberate fix there (f8a20b4), and the tolerance is tight enough
 * that the conversion factors have to agree — so these are the regression tests that prove the
 * local table matches what `pint` produced, not merely that it is self-consistent.
 */
describe("convert", () => {
  it("matches pint on a cup in millilitres", () => {
    expect(convert(1, "cup", "ml")).toBeCloseTo(236.588, 2);
  });

  it("treats the volume ladder as exact ratios", () => {
    // A cup is 16 tbsp and 48 tsp by definition, which is what makes the snapping predictable.
    expect(convert(1, "cup", "tbsp")).toBeCloseTo(16, 9);
    expect(convert(1, "cup", "tsp")).toBeCloseTo(48, 9);
    expect(convert(1, "tbsp", "tsp")).toBeCloseTo(3, 9);
  });

  it.each([
    [1, "lb", "oz", 16],
    [1, "kg", "g", 1000],
    [1, "oz", "g", 28.3495],
    [1, "lb", "g", 453.592],
  ])("converts %i %s to %s", (quantity, from, to, expected) => {
    expect(convert(quantity, from, to)).toBeCloseTo(expected, 3);
  });

  it("refuses volume to mass, which needs a density it does not know", () => {
    expect(() => convert(1, "cup", "gram")).toThrowError(IncompatibleUnitsError);
  });

  it.each(["clove", "pinch", ""])("refuses %p as a unit", (unit) => {
    expect(() => convert(1, unit, "ml")).toThrowError(UnknownUnitError);
  });
});

describe("isKnownUnit", () => {
  it.each(["cup", "CUP", " tbsp ", "lb", "grams"])("knows %p", (unit) => {
    expect(isKnownUnit(unit)).toBe(true);
  });

  it.each(["clove", "ea", "head", "bunch"])("does not know %p, which is a count", (unit) => {
    expect(isKnownUnit(unit)).toBe(false);
  });
});

describe("snapToKitchenUnit", () => {
  it("steps down to a unit where the amount is measurable", () => {
    // 1/3 cup scaled by 4/3 is 4/9 cup — not a clean cup fraction, but 7.111 tbsp, which is
    // within tolerance of 7⅛.
    expect(snapToKitchenUnit(4 / 9, "cup")).toEqual({ quantity: 7.125, unit: "tbsp" });
  });

  it("leaves a cup amount that is already clean", () => {
    expect(snapToKitchenUnit(3.75, "cup")).toEqual({ quantity: 3.75, unit: "cup" });
  });

  it("drops a negligible fraction rather than inventing an eighth", () => {
    expect(snapToKitchenUnit(2.005, "cup")).toEqual({ quantity: 2, unit: "cup" });
  });

  it("snaps in place for a unit that is not on the ladder", () => {
    expect(snapToKitchenUnit(1.51, "lb")).toEqual({ quantity: 1.5, unit: "lb" });
  });

  it("normalises the unit's casing", () => {
    expect(snapToKitchenUnit(2, "CUP").unit).toBe("cup");
  });

  it.each([
    [0.5, "cup", 0.5, "cup"],
    [0.333, "cup", 1 / 3, "cup"],
    [0.625, "cup", 0.625, "cup"],
  ])("keeps %p %s measurable", (quantity, unit, expectedQuantity, expectedUnit) => {
    const snapped = snapToKitchenUnit(quantity, unit);

    expect(snapped.unit).toBe(expectedUnit);
    expect(snapped.quantity).toBeCloseTo(expectedQuantity, 3);
  });
});

describe("scaleFactor", () => {
  it.each([
    [2, 4, 2],
    [6, 8, 4 / 3],
    [4, 4, 1],
  ])("scales %i servings to %i", (base, target, expected) => {
    expect(scaleFactor(base, target)).toBeCloseTo(expected, 6);
  });

  it.each([null, undefined, 0, -1])(
    "returns 1 for a base of %p, so the caller can surface the ambiguity",
    (base) => {
      expect(scaleFactor(base, 4)).toBe(1);
    },
  );
});

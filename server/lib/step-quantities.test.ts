import { describe, expect, it } from "vitest";

import { malformedQuantity, parseStep } from "./step-quantities";

describe("parseStep", () => {
  it("returns a step with no marked amounts as its text alone", () => {
    expect(parseStep("Bake at 375F for 20 minutes.")).toEqual(["Bake at 375F for 20 minutes."]);
  });

  it("splits out a marked amount and its unit", () => {
    expect(parseStep("Whisk {1/3 cup} mayonnaise with the honey.")).toEqual([
      "Whisk ",
      { quantity: 1 / 3, unit: "cup" },
      " mayonnaise with the honey.",
    ]);
  });

  it("reads whole, decimal, fractional and mixed amounts", () => {
    expect(parseStep("{8}{1.5 lb}{3/4 tsp}{1 1/2 cups}")).toEqual([
      { quantity: 8, unit: null },
      { quantity: 1.5, unit: "lb" },
      { quantity: 0.75, unit: "tsp" },
      { quantity: 1.5, unit: "cups" },
    ]);
  });

  it("lowercases the unit, as an ingredient's unit is", () => {
    expect(parseStep("Add {3 Tbsp} oil.")).toContainEqual({ quantity: 3, unit: "tbsp" });
  });

  it("drops a trailing period from the unit", () => {
    expect(parseStep("Add {2 tbsp.} oil.")).toContainEqual({ quantity: 2, unit: "tbsp" });
  });

  it("leaves a brace that is not an amount as text", () => {
    expect(parseStep("Season {to taste}.")).toEqual(["Season {to taste}."]);
  });
});

describe("malformedQuantity", () => {
  it("accepts a step with well-formed amounts or none", () => {
    expect(malformedQuantity("Add {3 tbsp} oil, then {1 1/2 cups} stock.")).toBeNull();
    expect(malformedQuantity("Bake 20 minutes.")).toBeNull();
  });

  it("names a brace that holds no amount", () => {
    expect(malformedQuantity("Season {to taste}.")).toBe("{to taste}");
  });

  it("names a zero amount or a zero denominator", () => {
    expect(malformedQuantity("Add {0 cup} water.")).toBe("{0 cup}");
    expect(malformedQuantity("Add {1/0 cup} water.")).toBe("{1/0 cup}");
  });

  it("names an unbalanced brace", () => {
    expect(malformedQuantity("Add {3 tbsp oil.")).toBe("{3 tbsp oil.");
    expect(malformedQuantity("Add 3 tbsp} oil.")).toBe("}");
  });
});

import { describe, expect, it } from "vitest";

import { formatQuantity } from "./quantity";

describe("formatQuantity", () => {
  it("renders a fraction a cook would recognize", () => {
    expect(formatQuantity(0.5, "cup")).toBe("½ cup");
    expect(formatQuantity(3.5, "lb")).toBe("3½ lb");
    expect(formatQuantity(0.25, "tsp")).toBe("¼ tsp");
  });

  it("handles thirds from both the rounded and the truncated form", () => {
    expect(formatQuantity(0.33, "cup")).toBe("⅓ cup");
    expect(formatQuantity(0.333, "cup")).toBe("⅓ cup");
    expect(formatQuantity(0.667, "cup")).toBe("⅔ cup");
  });

  it("leaves a whole number alone", () => {
    expect(formatQuantity(2, "ea")).toBe("2 ea");
  });

  it("falls back to a decimal where no fraction fits", () => {
    expect(formatQuantity(1.4, "lb")).toBe("1.4 lb");
  });

  it("shows the unit alone for a to-taste ingredient", () => {
    expect(formatQuantity(null, "pinch")).toBe("pinch");
    expect(formatQuantity(null, null)).toBe("");
  });

  it("omits the unit when there is none", () => {
    expect(formatQuantity(3, null)).toBe("3");
  });
});

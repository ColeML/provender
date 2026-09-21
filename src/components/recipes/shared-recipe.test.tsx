// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SharedRecipe } from "./shared-recipe";

const fajitas = {
  title: "Chicken Fajitas",
  baseServings: 8,
  totalMin: 40,
  sourceUrl: "https://example.test/fajitas",
  instructions: ["Preheat the oven.", "Slice the peppers."],
  ingredients: [
    { id: "a", name: "chili powder", quantity: 2, unit: "Tbsp", notes: null },
    { id: "b", name: "salt", quantity: null, unit: null, notes: "to taste" },
  ],
};

describe("SharedRecipe", () => {
  it("shows the title, the servings it is written for, and the times", () => {
    render(<SharedRecipe recipe={fajitas} />);

    expect(screen.getByRole("heading", { level: 1, name: "Chicken Fajitas" })).toBeInTheDocument();
    expect(screen.getByText("Serves 8")).toBeInTheDocument();
    expect(screen.getByText(/40 min/)).toBeInTheDocument();
  });

  it("lists the ingredients with their quantities, in recipe order", () => {
    render(<SharedRecipe recipe={fajitas} />);

    const items = screen.getAllByRole("listitem");

    expect(items[0]).toHaveTextContent("chili powder");
    expect(items[0]).toHaveTextContent("2 Tbsp");
    expect(items[1]).toHaveTextContent("to taste");
  });

  it("numbers the steps", () => {
    render(<SharedRecipe recipe={fajitas} />);

    expect(screen.getByText("Slice the peppers.")).toBeInTheDocument();
  });

  // The issue's requirement: nothing household-specific reaches a stranger. The learned cost is
  // the one field on a recipe row that is about this household's shopping rather than the dish.
  it("shows no cost estimate", () => {
    const { container } = render(<SharedRecipe recipe={fajitas} />);

    expect(container.textContent).not.toMatch(/\$/);
  });

  it("offers no way into the rest of the library", () => {
    render(<SharedRecipe recipe={fajitas} />);

    const internal = screen
      .queryAllByRole("link")
      .filter((link) => !link.getAttribute("href")?.startsWith("https://example.test"));

    expect(internal).toEqual([]);
  });

  it("omits the source line entirely when the recipe has no source", () => {
    render(<SharedRecipe recipe={{ ...fajitas, sourceUrl: null, totalMin: null }} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { RecipeLibrary, type LibraryRecipe } from "./recipe-library";

const LIBRARY: LibraryRecipe[] = [
  {
    recipeId: "fajitas",
    title: "Chicken Fajitas",
    baseServings: 8,
    totalMin: 30,
    tags: ["mexican", "quick"],
  },
  {
    recipeId: "teriyaki",
    title: "Instant Pot Teriyaki Chicken",
    baseServings: 8,
    totalMin: 45,
    tags: ["instant pot", "kid-friendly"],
  },
  { recipeId: "ziti", title: "Baked Ziti", baseServings: 8, totalMin: null, tags: [] },
];

function renderLibrary() {
  const user = userEvent.setup();

  render(<RecipeLibrary recipes={LIBRARY} />);

  return user;
}

afterEach(cleanup);

describe("the recipe library", () => {
  it("lists everything, linked", () => {
    renderLibrary();

    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: /Baked Ziti/ })).toHaveAttribute(
      "href",
      "/recipes/ziti",
    );
  });

  it("searches the title", async () => {
    const user = renderLibrary();

    await user.type(screen.getByRole("searchbox"), "ziti");

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("searches tags too, so a tag is as good as a name", async () => {
    const user = renderLibrary();

    await user.type(screen.getByRole("searchbox"), "instant pot");

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Teriyaki/ })).toBeInTheDocument();
  });

  it("matches every term, not just one of them", async () => {
    const user = renderLibrary();

    await user.type(screen.getByRole("searchbox"), "chicken mexican");

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Fajitas/ })).toBeInTheDocument();
  });

  it("ignores case", async () => {
    const user = renderLibrary();

    await user.type(screen.getByRole("searchbox"), "ZITI");

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("says so when nothing matches", async () => {
    const user = renderLibrary();

    await user.type(screen.getByRole("searchbox"), "sushi");

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("omits the time for a recipe that has none", () => {
    renderLibrary();

    expect(screen.getByRole("link", { name: /Baked Ziti/ })).toHaveTextContent(/8 sv$/);
  });
});

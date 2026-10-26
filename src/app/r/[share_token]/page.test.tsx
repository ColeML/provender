// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@server/services/shares", () => ({
  getSharedRecipe: async () => ({
    recipe: {
      title: "Chicken Fajitas",
      baseServings: 8,
      totalMin: 30,
      sourceUrl: null,
      instructions: ["Slice the peppers."],
      notes: ["Kids want the cilantro on the side"],
    },
    ingredients: [],
  }),
}));

const { default: Shared } = await import("./page");

describe("the shared recipe page", () => {
  // Notes are the household talking to itself; a stranger with the link gets the dish only.
  it("does not show the household's notes", async () => {
    const { container } = render(await Shared({ params: Promise.resolve({ share_token: "t" }) }));

    expect(container).toHaveTextContent("Chicken Fajitas");
    expect(container).not.toHaveTextContent("cilantro");
    expect(container).not.toHaveTextContent(/notes/i);
  });
});

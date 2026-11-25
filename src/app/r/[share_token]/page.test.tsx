// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

const prepAhead = vi.hoisted(() => ({ tasks: ["Marinate the chicken overnight."] }));

vi.mock("@server/services/shares", () => ({
  getSharedRecipe: async () => ({
    recipe: {
      prepAhead: prepAhead.tasks,
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

afterEach(() => {
  cleanup();
  prepAhead.tasks = ["Marinate the chicken overnight."];
});

describe("the shared recipe page", () => {
  // Notes are the household talking to itself; a stranger with the link gets the dish only.
  it("does not show the household's notes", async () => {
    const { container } = render(await Shared({ params: Promise.resolve({ share_token: "t" }) }));

    expect(container).toHaveTextContent("Chicken Fajitas");
    expect(container).not.toHaveTextContent("cilantro");
    expect(container).not.toHaveTextContent(/notes/i);
  });

  it("shows the prep-ahead tasks read-only, above the steps", async () => {
    render(await Shared({ params: Promise.resolve({ share_token: "t" }) }));

    const prep = screen.getByRole("list", { name: "Prep ahead" });

    expect(within(prep).getByRole("listitem")).toHaveTextContent("Marinate the chicken overnight.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      prep.compareDocumentPosition(screen.getByRole("list", { name: "Method" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows no prep-ahead heading when there are no tasks", async () => {
    prepAhead.tasks = [];
    const { container } = render(await Shared({ params: Promise.resolve({ share_token: "t" }) }));

    expect(container).not.toHaveTextContent(/prep ahead/i);
  });
});

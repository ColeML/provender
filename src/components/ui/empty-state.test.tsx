// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("states what is absent", () => {
    render(<EmptyState>No week is planned yet.</EmptyState>);

    expect(screen.getByText("No week is planned yet.")).toBeInTheDocument();
  });

  it("renders the next step beside the message", () => {
    render(<EmptyState hint="Ask Claude Code to plan it.">Nothing here.</EmptyState>);

    expect(screen.getByText("Ask Claude Code to plan it.")).toBeInTheDocument();
  });

  it("omits the hint paragraph when there is no next step", () => {
    const { container } = render(<EmptyState>Nothing here.</EmptyState>);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders a footer slot, for the verse #75 puts there", () => {
    render(<EmptyState footer={<cite>Matthew 6:11</cite>}>Nothing here.</EmptyState>);

    expect(screen.getByText("Matthew 6:11")).toBeInTheDocument();
  });

  it("omits the footer element when nothing fills it", () => {
    const { container } = render(<EmptyState>Nothing here.</EmptyState>);

    expect(container.querySelector("footer")).toBeNull();
  });

  it("keeps the message in the UI face, since the display face is for an h1", () => {
    render(<EmptyState>Nothing here.</EmptyState>);

    expect(screen.getByText("Nothing here.").className).not.toContain("font-display");
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Wordmark } from "./wordmark";

afterEach(cleanup);

describe("Wordmark", () => {
  it("reads as the app's name", () => {
    render(<Wordmark />);

    expect(screen.getByText("Provender")).toBeInTheDocument();
  });

  it("sets the name in the display face", () => {
    render(<Wordmark />);

    expect(screen.getByText("Provender").className).toContain("font-display");
  });

  it("letterspaces the capitals rather than tightening them", () => {
    render(<Wordmark />);

    const className = screen.getByText("Provender").className;

    expect(className).toContain("uppercase");
    expect(className).not.toContain("tracking-tight");
  });

  it("leaves the name lowercase-readable to assistive tech, since CSS does the capitalising", () => {
    render(<Wordmark />);

    expect(screen.getByText("Provender").textContent).toBe("Provender");
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CSB_VERSES } from "@/lib/verses";

import { Verse } from "./verse";

afterEach(cleanup);

describe("Verse", () => {
  it("quotes the verse and names its reference and translation", () => {
    render(<Verse reference="Psalm 23:1" />);

    expect(screen.getByText(CSB_VERSES["Psalm 23:1"])).toBeInTheDocument();
    expect(screen.getByText("Psalm 23:1 · CSB")).toBeInTheDocument();
  });
});

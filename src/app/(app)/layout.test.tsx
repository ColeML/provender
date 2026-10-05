// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

const { default: AppLayout } = await import("./layout");

afterEach(cleanup);

describe("the app header", () => {
  it("reaches settings from a gear named for screen readers, not a text tab", () => {
    render(<AppLayout>page</AppLayout>);

    const header = within(screen.getByRole("banner"));
    const settings = header.getByRole("link", { name: "Settings" });

    expect(settings).toHaveAttribute("href", "/settings");
    expect(settings).not.toHaveTextContent("Settings");
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(settings).toHaveClass("min-h-11", "min-w-11");
  });
});

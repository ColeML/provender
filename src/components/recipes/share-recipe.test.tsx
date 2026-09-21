// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareControl } from "./share-recipe";

const TOKEN = "9xK2q7";

describe("ShareControl", () => {
  it("offers to share a recipe that has no link yet", () => {
    render(
      <ShareControl
        origin="https://provender.test"
        token={null}
        onShare={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Share this recipe" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  });

  it("mints a link when asked", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();

    render(
      <ShareControl
        origin="https://provender.test"
        token={null}
        onShare={onShare}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Share this recipe" }));

    expect(onShare).toHaveBeenCalledOnce();
  });

  it("shows the full link once one exists, so it can be read as well as copied", () => {
    render(
      <ShareControl
        origin="https://provender.test"
        token={TOKEN}
        onShare={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveValue(
      `https://provender.test/r/${TOKEN}`,
    );
  });

  it("copies the link to the clipboard", async () => {
    const user = userEvent.setup();

    render(
      <ShareControl
        origin="https://provender.test"
        token={TOKEN}
        onShare={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    // Read back out of the clipboard rather than asserting on a spy: what matters is the string
    // someone pastes, not that a method was called.
    await expect(navigator.clipboard.readText()).resolves.toEqual(
      `https://provender.test/r/${TOKEN}`,
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("revokes the link when asked", async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();

    render(
      <ShareControl
        origin="https://provender.test"
        token={TOKEN}
        onShare={vi.fn()}
        onRevoke={onRevoke}
        pending={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Revoke link" }));

    expect(onRevoke).toHaveBeenCalledWith(TOKEN);
  });

  // Minting is a write, and a second click before the first answers would hit ALREADY_EXISTS.
  it("does not fire a second time while a request is in flight", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();

    render(
      <ShareControl
        origin="https://provender.test"
        token={null}
        onShare={onShare}
        onRevoke={vi.fn()}
        pending
      />,
    );
    await user.click(screen.getByRole("button", { name: "Share this recipe" }));

    expect(onShare).not.toHaveBeenCalled();
  });
});

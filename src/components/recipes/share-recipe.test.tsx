// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareControl } from "./share-recipe";

const TOKEN = "9xK2q7";

/** The control is an icon until tapped; everything else lives in the popover it opens. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Share this recipe" }));
}

describe("ShareControl", () => {
  it("offers to share a recipe that has no link yet", async () => {
    const user = userEvent.setup();

    render(
      <ShareControl
        origin="https://provender.test"
        token={null}
        onShare={vi.fn()}
        onRevoke={vi.fn()}
        pending={false}
      />,
    );

    await open(user);

    expect(await screen.findByRole("button", { name: "Create link" })).toBeInTheDocument();
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
    await open(user);
    await user.click(await screen.findByRole("button", { name: "Create link" }));

    expect(onShare).toHaveBeenCalledOnce();
  });

  it("shows the full link once one exists, so it can be read as well as copied", async () => {
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

    await open(user);

    expect(await screen.findByRole("textbox", { name: "Share link" })).toHaveValue(
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
    await open(user);
    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    // Read back out of the clipboard rather than asserting on a spy: what matters is the string
    // someone pastes, not that a method was called.
    await expect(navigator.clipboard.readText()).resolves.toEqual(
      `https://provender.test/r/${TOKEN}`,
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  // Phones have the system share sheet; most desktop browsers do not, and get only "Copy link".
  it("hands the link to the share sheet where the browser has one", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    try {
      render(
        <ShareControl
          origin="https://provender.test"
          token={TOKEN}
          onShare={vi.fn()}
          onRevoke={vi.fn()}
          pending={false}
        />,
      );
      await open(user);
      await user.click(await screen.findByRole("button", { name: "Share link" }));

      expect(share).toHaveBeenCalledWith({ url: `https://provender.test/r/${TOKEN}` });
    } finally {
      Reflect.deleteProperty(navigator, "share");
    }
  });

  it("offers no share sheet where the browser has none", async () => {
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
    await open(user);
    await screen.findByRole("button", { name: "Copy link" });

    expect(screen.queryByRole("button", { name: "Share link" })).not.toBeInTheDocument();
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
    await open(user);
    await user.click(await screen.findByRole("button", { name: "Revoke link" }));

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
    await open(user);
    await user.click(await screen.findByRole("button", { name: "Create link" }));

    expect(onShare).not.toHaveBeenCalled();
  });
});

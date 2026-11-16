// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ShareDayControl } from "./share-day";

const ORIGIN = "https://provender.test";

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Share this day" }));
}

describe("ShareDayControl", () => {
  it("warns that the day's notes are included before a link is made", async () => {
    const user = userEvent.setup();

    render(<ShareDayControl origin={ORIGIN} share={null} pending={false} onShare={vi.fn()} />);
    await open(user);

    expect(await screen.findByText(/every meal, recipe and note/)).toBeInTheDocument();
    expect(screen.getByText(/3 days/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Share link" })).not.toBeInTheDocument();
  });

  it("mints a link when asked, once", async () => {
    const user = userEvent.setup();
    const onShare = vi.fn();

    const { rerender } = render(
      <ShareDayControl origin={ORIGIN} share={null} pending={false} onShare={onShare} />,
    );
    await open(user);
    await user.click(await screen.findByRole("button", { name: "Create link" }));
    rerender(<ShareDayControl origin={ORIGIN} share={null} pending onShare={onShare} />);
    await user.click(screen.getByRole("button", { name: "Create link" }));

    expect(onShare).toHaveBeenCalledOnce();
  });

  it("shows the live link at /d/{token} with when it stops working, and no revoke", async () => {
    const user = userEvent.setup();

    render(
      <ShareDayControl
        origin={ORIGIN}
        share={{ token: "9xK2q7", expireTime: "2026-09-10T18:00:00.000Z" }}
        pending={false}
        onShare={vi.fn()}
      />,
    );
    await open(user);

    expect(await screen.findByRole("textbox", { name: "Share link" })).toHaveValue(
      `${ORIGIN}/d/9xK2q7`,
    );
    expect(screen.getByText(/Works until/)).toBeInTheDocument();
    expect(screen.getByText(/notes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revoke link" })).not.toBeInTheDocument();
  });
});

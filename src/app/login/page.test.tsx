// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();

vi.mock("../../../auth", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));
// next-auth's entrypoint reaches for `next/server`, which resolves under Next but not under
// Vitest's node resolution. Only the error class is used here.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));

const { default: Login } = await import("./page");

async function signInFrom(from?: string) {
  const user = userEvent.setup();

  render(await Login({ searchParams: Promise.resolve(from === undefined ? {} : { from }) }));

  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  return signIn.mock.calls[0]?.[1] as { redirectTo: string } | undefined;
}

beforeEach(() => {
  signIn.mockReset();
});

describe("login", () => {
  it("returns the visitor to the page they were sent here from", async () => {
    expect((await signInFrom("/shop"))?.redirectTo).toBe("/shop");
  });

  it("goes home when there is no from", async () => {
    expect((await signInFrom())?.redirectTo).toBe("/");
  });

  it.each(["//evil.test/phish", "/\\evil.test/phish", "/\t/evil.test/phish", "https://evil.test"])(
    "goes home rather than to %s, which is off this origin",
    async (from) => {
      expect((await signInFrom(from))?.redirectTo).toBe("/");
    },
  );

  it("loads the logo up front, since it is the first thing on the page", async () => {
    const { container } = render(await Login({ searchParams: Promise.resolve({}) }));

    expect(container.querySelector("img")).not.toHaveAttribute("loading", "lazy");
  });

  it("says the password is wrong after a failed sign-in", async () => {
    render(await Login({ searchParams: Promise.resolve({ error: "1" }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("That password is not right.");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      "That password is not right.",
    );
  });

  it("shows that sign-in is in progress", async () => {
    signIn.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();

    render(await Login({ searchParams: Promise.resolve({}) }));

    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
  });
});

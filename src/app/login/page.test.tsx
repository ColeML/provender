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
});

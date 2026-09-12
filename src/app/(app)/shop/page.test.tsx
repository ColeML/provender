// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REQUESTED_PATH_HEADER } from "@/lib/login-url";

const session = vi.fn<() => Promise<{ user: { name: string } } | null>>();
const redirect = vi.fn<(url: string) => never>();
const requestHeaders = new Headers();

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("../../../../auth", () => ({ auth: () => session() }));
vi.mock("@server/services/plans", () => ({ currentOrLatestPlan: async () => null }));
vi.mock("@server/services/shopping", () => ({ listItems: async () => [] }));

const { default: Shop } = await import("./page");

beforeEach(() => {
  redirect.mockReset();
  session.mockResolvedValue(null);
  requestHeaders.set(REQUESTED_PATH_HEADER, "/shop");
});

describe("shop", () => {
  // An unverified session cookie gets past the proxy, so this redirect — not the proxy's — is what
  // a visitor with a stale one sees, and it has to remember where they were going (#93).
  it("sends a signed-out visitor to the login page, remembering this page", async () => {
    await Shop();

    expect(redirect).toHaveBeenCalledWith("/login?from=%2Fshop");
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REQUESTED_PATH_HEADER } from "@/lib/login-url";

const session = vi.fn<() => Promise<{ user: { name: string } } | null>>();
const redirect = vi.fn<(url: string) => never>();
const currentOrLatestPlan = vi.fn();
const findPlan = vi.fn();
const listItems = vi.fn();
const requestHeaders = new Headers();

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("../../../../auth", () => ({ auth: () => session() }));
vi.mock("@server/services/plans", () => ({
  currentOrLatestPlan: (...args: unknown[]) => currentOrLatestPlan(...args),
  findPlan: (...args: unknown[]) => findPlan(...args),
}));
vi.mock("@server/services/shopping", () => ({
  listItems: (...args: unknown[]) => listItems(...args),
}));

const { default: Shop } = await import("./page");

const noWeek = Promise.resolve({});

beforeEach(() => {
  redirect.mockReset();
  currentOrLatestPlan.mockReset();
  findPlan.mockReset();
  listItems.mockReset();
  session.mockResolvedValue(null);
  currentOrLatestPlan.mockResolvedValue(null);
  findPlan.mockResolvedValue(undefined);
  listItems.mockResolvedValue([]);
  requestHeaders.set(REQUESTED_PATH_HEADER, "/shop");
});

describe("shop", () => {
  // An unverified session cookie gets past the proxy, so this redirect — not the proxy's — is what
  // a visitor with a stale one sees, and it has to remember where they were going (#93).
  it("sends a signed-out visitor to the login page, remembering this page", async () => {
    await Shop({ searchParams: noWeek });

    expect(redirect).toHaveBeenCalledWith("/login?from=%2Fshop");
  });

  describe("signed in", () => {
    beforeEach(() => {
      session.mockResolvedValue({ user: { name: "Cole" } });
    });

    it("shows the current week when no week is asked for", async () => {
      currentOrLatestPlan.mockResolvedValue({ id: "2026-W39", budgetTarget: "120" });

      await Shop({ searchParams: noWeek });

      expect(currentOrLatestPlan).toHaveBeenCalled();
      expect(findPlan).not.toHaveBeenCalled();
      expect(listItems).toHaveBeenCalledWith(expect.anything(), "2026-W39");
    });

    // The point of the feature: shopping on Sunday for the week that starts tomorrow.
    it("shows the week that was asked for", async () => {
      findPlan.mockResolvedValue({ id: "2026-W40", budgetTarget: "120" });

      await Shop({ searchParams: Promise.resolve({ week: "2026-W40" }) });

      expect(findPlan).toHaveBeenCalledWith(expect.anything(), "2026-W40");
      expect(currentOrLatestPlan).not.toHaveBeenCalled();
      expect(listItems).toHaveBeenCalledWith(expect.anything(), "2026-W40");
    });

    it("reads no items for a week that has no plan, rather than failing", async () => {
      findPlan.mockResolvedValue(undefined);

      const page = await Shop({ searchParams: Promise.resolve({ week: "2026-W44" }) });

      expect(listItems).not.toHaveBeenCalled();
      // Still names the week, so the nav can step back out of it.
      expect(JSON.stringify(page)).toContain("2026-W44");
    });

    /**
     * `currentOrLatestPlan` falls back to the most recent plan, so the default view can show a
     * week that is not today's. The way back must still be hidden there, or it reloads this page.
     */
    it("marks the default view as default even when it fell back to an older week", async () => {
      currentOrLatestPlan.mockResolvedValue({ id: "2026-W36", budgetTarget: "120" });

      const page = await Shop({ searchParams: noWeek });

      expect(page.props.atDefault).toBe(true);
      expect(page.props.planId).toBe("2026-W36");
    });

    it("marks an explicitly asked-for week as not the default view", async () => {
      findPlan.mockResolvedValue({ id: "2026-W40", budgetTarget: "120" });

      const page = await Shop({ searchParams: Promise.resolve({ week: "2026-W40" }) });

      expect(page.props.atDefault).toBe(false);
    });

    // `?week=` is user-editable, so a typo must not become a 500 or an unnavigable page.
    it("falls back to the current week when the parameter is not an ISO week", async () => {
      currentOrLatestPlan.mockResolvedValue({ id: "2026-W39", budgetTarget: "120" });

      await Shop({ searchParams: Promise.resolve({ week: "not-a-week" }) });

      expect(findPlan).not.toHaveBeenCalled();
      expect(currentOrLatestPlan).toHaveBeenCalled();
    });
  });
});

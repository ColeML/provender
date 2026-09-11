// @vitest-environment jsdom
import { db } from "@server/db";
import type { AppRouter } from "@server/trpc/routers";
import { appRouter } from "@server/trpc/routers";
import { createTRPCClient, httpBatchLink, isTRPCClientError } from "@trpc/client";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";

import { makeQueryClient, signOutRedirect } from "./query-client";

/**
 * A client talking to the real router with a signed-out context, so what comes back is the
 * server's own refusal rather than a hand-written imitation of it.
 */
function signedOutClient() {
  const calls = { count: 0 };

  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "http://provender.test/api/trpc",
        transformer: superjson,
        fetch: (url, options) => {
          calls.count += 1;

          return fetchRequestHandler({
            endpoint: "/api/trpc",
            req: new Request(url, options),
            router: appRouter,
            createContext: () => ({ db, session: null, householdId: null }),
          });
        },
      }),
    ],
  });

  return { client, calls };
}

describe("the signed-out tRPC path", () => {
  it("refuses with UNAUTHORIZED rather than a redirect", async () => {
    const { client } = signedOutClient();

    const caught = await client.config.get.query().catch((error: unknown) => error);

    expect(isTRPCClientError<AppRouter>(caught) && caught.data?.code).toBe("UNAUTHORIZED");
  });

  it("sends the browser to the login page, and does not retry first", async () => {
    const onSignedOut = vi.fn();
    const queryClient = makeQueryClient(onSignedOut);
    const { client, calls } = signedOutClient();

    await expect(
      queryClient.fetchQuery({
        queryKey: ["config"],
        queryFn: () => client.config.get.query(),
      }),
    ).rejects.toThrow(/not signed in/i);

    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(calls.count).toBe(1);
  });

  it("redirects once when a whole batch fails, not once per call in it", async () => {
    const onSignedOut = vi.fn();
    const queryClient = makeQueryClient(onSignedOut);
    const { client, calls } = signedOutClient();

    await Promise.allSettled([
      queryClient.fetchQuery({ queryKey: ["config"], queryFn: () => client.config.get.query() }),
      queryClient.fetchQuery({ queryKey: ["prices"], queryFn: () => client.prices.list.query() }),
      queryClient.fetchQuery({
        queryKey: ["recipes"],
        queryFn: () => client.recipes.list.query(),
      }),
    ]);

    expect(calls.count).toBe(1);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("also reacts when a mutation is the call that finds out", async () => {
    const onSignedOut = vi.fn();
    const queryClient = makeQueryClient(onSignedOut);
    const { client } = signedOutClient();

    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, {
          mutationFn: () =>
            client.shoppingList.setPurchased.mutate({
              planId: "2026-W37",
              itemId: "milk",
              purchased: true,
            }),
        })
        .execute(undefined),
    ).rejects.toThrow(/not signed in/i);

    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying an ordinary failure in the browser", async () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry;
    const { client } = signedOutClient();
    const signedOut = await client.config.get.query().then(
      () => new Error("the server answered a signed-out call"),
      (error: Error) => error,
    );

    expect(typeof retry === "function" && retry(0, new Error("network down"))).toBe(true);
    expect(typeof retry === "function" && retry(0, signedOut)).toBe(false);
  });

  it("leaves an ordinary failure to the screen that made the call", async () => {
    const onSignedOut = vi.fn();
    const queryClient = makeQueryClient(onSignedOut);

    await expect(
      queryClient.fetchQuery({
        queryKey: ["config"],
        queryFn: () => Promise.reject(new Error("network down")),
        retry: false,
      }),
    ).rejects.toThrow("network down");

    expect(onSignedOut).not.toHaveBeenCalled();
  });
});

describe("signOutRedirect", () => {
  it("remembers where the caller was", () => {
    const assign = vi.fn();

    signOutRedirect({ pathname: "/shop", search: "?week=2026-W37", assign });

    expect(assign).toHaveBeenCalledWith("/login?from=%2Fshop%3Fweek%3D2026-W37");
  });

  it("does not send the login page to itself", () => {
    const assign = vi.fn();

    signOutRedirect({ pathname: "/login", search: "", assign });

    expect(assign).not.toHaveBeenCalled();
  });
});

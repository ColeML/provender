import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShareRecipe } from "./share-recipe";

/**
 * Server-rendering, with `window` removed.
 *
 * `ShareRecipe` is a client component, and Next server-renders those before they reach a browser.
 * An earlier version read `window.location.origin` in its render body, which threw
 * `window is not defined` and 500'd every recipe page while the jsdom tests stayed green — they
 * render into a DOM that supplies the global the server does not. The stub below is what makes
 * that mistake fail here: the shared `vitest.setup.ts` pulls in Testing Library, which leaves a
 * `window` on the global even in the node environment.
 */

afterEach(() => vi.unstubAllGlobals());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    recipes: {
      share: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
      revokeShare: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    },
  }),
}));

function serverRender(token: string | null) {
  vi.stubGlobal("window", undefined);

  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ShareRecipe recipeId="ziti" token={token} origin="https://provender.test" />
    </QueryClientProvider>,
  );
}

describe("ShareRecipe on the server", () => {
  it("renders the unshared state without reaching for a browser global", () => {
    expect(serverRender(null)).toContain("Share this recipe");
  });

  it("renders the link from the origin the server passed down", () => {
    expect(serverRender("9xK2q7")).toContain("https://provender.test/r/9xK2q7");
  });
});

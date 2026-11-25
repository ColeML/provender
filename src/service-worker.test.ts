import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `public/sw.js` runs here against an in-memory Cache API, because it is served as-is and cannot
 * import anything a test could reach.
 */
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://provender.test";

type RequestLike = Pick<Request, "url" | "method" | "mode" | "headers">;

const keyOf = (request: string | RequestLike) =>
  new URL(typeof request === "string" ? request : request.url, ORIGIN).href;

class FakeCache {
  entries = new Map<string, Response>();

  async match(request: string | RequestLike) {
    return this.entries.get(keyOf(request))?.clone();
  }

  async put(request: string | RequestLike, response: Response) {
    this.entries.set(keyOf(request), response);
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request: string | RequestLike) {
    return this.entries.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>();

  async open(name: string) {
    const store = this.stores.get(name) ?? new FakeCache();

    this.stores.set(name, store);

    return store;
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }

  async match(request: string | RequestLike) {
    for (const store of this.stores.values()) {
      const found = await store.match(request);

      if (found) {
        return found;
      }
    }

    return undefined;
  }

  saved() {
    return [...this.stores.values()].flatMap((store) => [...store.entries.keys()]);
  }
}

function page(body: string, url?: string) {
  const response = new Response(body, { headers: { "content-type": "text/html" } });

  if (url) {
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: new URL(url, ORIGIN).href },
    });
  }

  return response;
}

/** A chunk named after the page, so each page loads an asset of its own. */
const chunkFor = (request: string | RequestLike) =>
  `/_next/static/chunks/${new URL(keyOf(request)).pathname.split("/").pop() || "home"}.js`;

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

let caches: FakeCacheStorage;
let network: ReturnType<typeof vi.fn<(request: string | RequestLike) => Promise<Response>>>;
let listeners: Record<string, (event: unknown) => void>;

interface FakeWindow {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

let shown: { title: string; options: NotificationOptions }[];
let windows: FakeWindow[];
let opened: string[];

beforeEach(() => {
  caches = new FakeCacheStorage();
  network = vi.fn(offline);
  listeners = {};
  shown = [];
  windows = [];
  opened = [];

  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(new URL(url, ORIGIN).href);
      },
    },
    registration: {
      showNotification: async (title: string, options: NotificationOptions) => {
        shown.push({ title, options });
      },
    },
  };

  runInNewContext(SOURCE, { self, caches, fetch: network, URL, Response, Request, Headers });
});

/** Resolves to the worker's answer, or `undefined` when it leaves the request to the browser. */
async function request(
  path: string,
  { mode = "navigate", method = "GET", headers = {} }: Partial<RequestInit> = {},
) {
  let answer: Promise<Response> | undefined;
  const pending: Promise<unknown>[] = [];

  listeners.fetch({
    request: { url: new URL(path, ORIGIN).href, mode, method, headers: new Headers(headers) },
    respondWith: (response: Promise<Response>) => {
      answer = response;
    },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });

  const response = await answer;

  await Promise.all(pending);

  return response;
}

async function saveWeek(paths: string[]) {
  const pending: Promise<unknown>[] = [];

  listeners.message({
    data: { type: "save-week", paths },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });

  await Promise.all(pending);
}

function openWindow(path: string): FakeWindow {
  const window: FakeWindow = {
    url: new URL(path, ORIGIN).href,
    focus: vi.fn(async () => window),
    navigate: vi.fn(async () => window),
  };

  windows.push(window);

  return window;
}

/** Fires a `push` carrying `data` (an object is sent as JSON) and waits for the worker. */
async function push(data?: unknown) {
  const pending: Promise<unknown>[] = [];
  const text = typeof data === "string" ? data : JSON.stringify(data);

  listeners.push({
    data:
      data === undefined
        ? null
        : {
            text: () => text,
            json: () => JSON.parse(text),
          },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });

  await Promise.all(pending);
}

/** Taps a notification whose data is `data`, and waits for the worker. */
async function tap(data: unknown) {
  const pending: Promise<unknown>[] = [];
  const close = vi.fn();

  listeners.notificationclick({
    notification: { data, close },
    waitUntil: (work: Promise<unknown>) => pending.push(work),
  });

  await Promise.all(pending);

  return { close };
}

describe("sw.js push", () => {
  it("shows the payload's title and body, and keeps its URL for the tap", async () => {
    await push({ title: "Tonight", body: "Marinate the chicken.", url: "/plan/2026-11-26" });

    expect(shown).toMatchObject([
      {
        title: "Tonight",
        options: { body: "Marinate the chicken.", data: { url: "/plan/2026-11-26" } },
      },
    ]);
  });

  // A push the browser delivers must show something: Chrome and Safari both penalise a worker
  // that receives one silently, and Safari ends the subscription.
  it.each([
    ["no payload", undefined],
    ["a payload that is not JSON", "hello"],
  ])("still shows a notification for %s", async (_, data) => {
    await push(data);

    expect(shown).toMatchObject([{ title: "Provender", options: { data: { url: "/" } } }]);
  });
});

describe("sw.js notificationclick", () => {
  it("closes the notification", async () => {
    const { close } = await tap({ url: "/settings" });

    expect(close).toHaveBeenCalled();
  });

  it("focuses an open tab already on the URL, without reloading it", async () => {
    const tab = openWindow("/plan/2026-11-26");

    await tap({ url: "/plan/2026-11-26" });

    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });

  it("focuses an open tab elsewhere in the app and takes it to the URL", async () => {
    const tab = openWindow("/shop");

    await tap({ url: "/plan/2026-11-26" });

    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/plan/2026-11-26`);
    expect(opened).toEqual([]);
  });

  it("opens the URL when no tab is open", async () => {
    await tap({ url: "/plan/2026-11-26" });

    expect(opened).toEqual([`${ORIGIN}/plan/2026-11-26`]);
  });

  it("opens the URL in a new window when the open tab cannot be navigated", async () => {
    const tab = openWindow("/shop");
    tab.navigate.mockRejectedValue(new TypeError("not controlled"));

    await tap({ url: "/plan/2026-11-26" });

    expect(opened).toEqual([`${ORIGIN}/plan/2026-11-26`]);
  });

  it("opens the home page rather than another site", async () => {
    await tap({ url: "https://elsewhere.example/" });

    expect(opened).toEqual([`${ORIGIN}/`]);
  });
});

describe("sw.js", () => {
  it("answers a day page from the network while online, and saves it", async () => {
    network.mockResolvedValue(page("live"));

    expect(await (await request("/plan/2026-09-14"))?.text()).toBe("live");
    expect(caches.saved()).toContain(`${ORIGIN}/plan/2026-09-14`);
  });

  it("shows the live page online, never the saved copy", async () => {
    network.mockResolvedValueOnce(page("monday v1")).mockResolvedValueOnce(page("monday v2"));

    await request("/plan/2026-09-14");

    expect(await (await request("/plan/2026-09-14"))?.text()).toBe("monday v2");
  });

  it("falls back to the saved copy offline, whatever the query string", async () => {
    network.mockResolvedValueOnce(page("saved monday"));
    await request("/plan/2026-09-14");

    network.mockImplementation(offline);

    expect(await (await request("/plan/2026-09-14?week=2026-W38"))?.text()).toBe("saved monday");
  });

  it("fails offline on a page in scope that was never saved", async () => {
    expect((await request("/recipes/ziti"))?.type).toBe("error");
  });

  it("leaves other routes to the browser", async () => {
    for (const path of ["/shop", "/plan", "/recipes", "/settings", "/api/trpc/plan.get"]) {
      expect(await request(path)).toBeUndefined();
    }
  });

  it("saves the week's pages and the assets they load, so an unopened recipe opens offline", async () => {
    network.mockImplementation(async (request) => {
      const { pathname } = new URL(keyOf(request));

      if (pathname.startsWith("/_next/static/")) {
        return new Response(`asset ${pathname}`);
      }

      return page(
        `<link href="/_next/static/css/app.css"><script src="${chunkFor(request)}">${pathname}`,
      );
    });

    await saveWeek(["/", "/plan/2026-09-14", "/recipes/rice"]);
    network.mockImplementation(offline);

    expect(await (await request("/recipes/rice"))?.text()).toContain("/recipes/rice");
    expect(await (await request("/_next/static/css/app.css", { mode: "no-cors" }))?.text()).toBe(
      "asset /_next/static/css/app.css",
    );
  });

  it("drops saved pages and assets the new week no longer links to", async () => {
    network.mockImplementation(async (request) => page(`<script src="${chunkFor(request)}">`));

    await saveWeek(["/", "/recipes/chili"]);
    await saveWeek(["/", "/recipes/soup"]);

    expect(caches.saved()).not.toContain(`${ORIGIN}/recipes/chili`);
    expect(caches.saved()).not.toContain(`${ORIGIN}/_next/static/chunks/chili.js`);
    expect(caches.saved()).toContain(`${ORIGIN}/recipes/soup`);
    expect(caches.saved()).toContain(`${ORIGIN}/_next/static/chunks/soup.js`);
  });

  it("keeps what it has when saving the week fails partway", async () => {
    network.mockResolvedValue(page("saved"));
    await saveWeek(["/", "/recipes/chili"]);

    network.mockImplementation(offline);
    await saveWeek(["/", "/recipes/soup"]).catch(() => {});

    expect(caches.saved()).toContain(`${ORIGIN}/recipes/chili`);
  });

  it("clears every saved page when saving the week lands on /login", async () => {
    network.mockResolvedValueOnce(page("saved"));
    await request("/plan/2026-09-14");

    network.mockResolvedValue(page("sign in", "/login"));
    await saveWeek(["/", "/recipes/soup"]);

    expect(caches.saved()).toEqual([]);
  });

  it("writes nothing from a save that was still running when the user signed out", async () => {
    let answer: (response: Response) => void = () => {};
    network.mockImplementation(() => new Promise((resolve) => (answer = resolve)));

    const saving = saveWeek(["/recipes/soup"]);

    await request("/login");
    answer(page("soup"));
    await saving;

    expect(caches.saved()).toEqual([]);
  });

  it("writes nothing from a page that arrives after the user signed out", async () => {
    let answer: (response: Response) => void = () => {};
    network.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    const loading = request("/recipes/soup");

    await request("/login");
    answer(page("soup"));
    await loading;

    expect(caches.saved()).toEqual([]);
  });

  it.each([
    ["opening /login", "/login?from=/shop", "GET"],
    ["signing out", "/api/auth/signout", "POST"],
  ])("clears every saved page on %s", async (_, path, method) => {
    network.mockResolvedValueOnce(page("saved"));
    await request("/plan/2026-09-14");

    await request(path, { method, mode: method === "GET" ? "navigate" : "same-origin" });

    expect(caches.saved()).toEqual([]);
  });

  it("answers an offline client-side navigation with the saved page, so Next loads it in full", async () => {
    network.mockResolvedValueOnce(page("saved monday"));
    await request("/plan/2026-09-14");

    network.mockImplementation(offline);
    const response = await request("/plan/2026-09-14?_rsc=abc", {
      mode: "cors",
      headers: { RSC: "1" },
    });

    expect(response?.headers.get("content-type")).toBe("text/html");
  });

  it("passes an online client-side navigation through without saving it", async () => {
    network.mockResolvedValueOnce(
      new Response("flight", { headers: { "content-type": "text/x-component" } }),
    );

    const response = await request("/plan/2026-09-14?_rsc=abc", {
      mode: "cors",
      headers: { RSC: "1" },
    });

    expect(await response?.text()).toBe("flight");
    expect(caches.saved()).toEqual([]);
  });
});

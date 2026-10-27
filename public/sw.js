// Keeps this week's plan and recipe pages readable offline. Read-only: nothing that edits data is
// handled here, and every page in scope still comes from the network whenever there is one.

const PAGES = "provender-pages";
const ASSETS = "provender-assets";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function isSavedPage(url) {
  return (
    url.pathname === "/" ||
    url.pathname.startsWith("/plan/") ||
    url.pathname.startsWith("/recipes/")
  );
}

/** Saved under the path alone, so `?week=` and Next's `?_rsc=` find the same copy. */
function pageKey(url) {
  return new URL(url.pathname, url.origin).href;
}

function landsOnLogin(response) {
  return response.redirected && new URL(response.url).pathname === "/login";
}

/** Bumped on sign-out, so a fetch that started before it cannot write its page after it. */
let signOuts = 0;

/** The saved pages are one household's data, so a signed-out browser must not keep them. */
async function forget() {
  signOuts += 1;
  await Promise.all([caches.delete(PAGES), caches.delete(ASSETS)]);
}

/**
 * A navigation fetch does not follow redirects, so a page that sends the visitor to sign in comes
 * back as an opaque redirect, which is not `ok`. The browser's next request, to `/login`, clears.
 */
async function keep(key, response, signOutsAtStart) {
  if (!response.ok || signOuts !== signOutsAtStart) {
    return;
  }

  // Before the first await, while the browser has not started reading the body.
  const copy = response.clone();

  await (await caches.open(PAGES)).put(key, copy);
}

async function networkFirst(event, url) {
  const signOutsAtStart = signOuts;

  try {
    const response = await fetch(event.request);

    event.waitUntil(keep(pageKey(url), response, signOutsAtStart));

    return response;
  } catch {
    return (await caches.match(pageKey(url))) ?? Response.error();
  }
}

/**
 * Next fetches a page's RSC payload for a client-side navigation. Answering an offline one with
 * the saved HTML makes Next fall back to a full page load, which `networkFirst` then serves.
 */
async function payloadOrSavedPage(request, url) {
  try {
    return await fetch(request);
  } catch (error) {
    const saved = await caches.match(pageKey(url));

    if (saved) {
      return saved;
    }

    throw error;
  }
}

/** Build assets are named by content hash, so a saved one is never out of date. */
async function cacheFirst(event) {
  const saved = await caches.match(event.request);

  if (saved) {
    return saved;
  }

  const response = await fetch(event.request);

  if (response.ok) {
    const copy = response.clone();

    event.waitUntil(caches.open(ASSETS).then((assets) => assets.put(event.request, copy)));
  }

  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname === "/login" ||
    (url.pathname === "/api/auth/signout" && request.method === "POST")
  ) {
    event.waitUntil(forget());
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
  } else if (!isSavedPage(url)) {
    return;
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, url));
  } else if (request.headers.get("RSC") === "1" && !request.headers.has("Next-Router-Prefetch")) {
    event.respondWith(payloadOrSavedPage(request, url));
  }
});

const ASSET_PATH = /\/_next\/static\/[^"'\s\\)]+/g;

/**
 * Saves the pages the home page lists and the build assets they load, dropping the rest. Every page
 * is fetched before anything is written, so a save that fails offline keeps the last good week.
 */
async function saveWeek(paths) {
  const signOutsAtStart = signOuts;
  const keys = paths.map((path) => pageKey(new URL(path, self.location.origin)));
  const responses = await Promise.all(keys.map((key) => fetch(key)));

  if (responses.some(landsOnLogin)) {
    await forget();
    return;
  }

  const [pages, assets] = await Promise.all([caches.open(PAGES), caches.open(ASSETS)]);
  const assetKeys = new Set();

  await Promise.all(
    responses.map(async (response, index) => {
      if (!response.ok) {
        return;
      }

      for (const [path] of (await response.clone().text()).matchAll(ASSET_PATH)) {
        assetKeys.add(new URL(path, self.location.origin).href);
      }

      if (signOuts === signOutsAtStart) {
        await pages.put(keys[index], response);
      }
    }),
  );

  await Promise.all(
    [...assetKeys].map(async (key) => {
      if (await assets.match(key)) {
        return;
      }

      const response = await fetch(key);

      if (response.ok) {
        await assets.put(key, response);
      }
    }),
  );

  const drop = async (cache, wanted) => {
    for (const request of await cache.keys()) {
      if (!wanted.has(request.url)) {
        await cache.delete(request);
      }
    }
  };

  await Promise.all([drop(pages, new Set(keys)), drop(assets, assetKeys)]);
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "save-week") {
    event.waitUntil(saveWeek(event.data.paths));
  }
});

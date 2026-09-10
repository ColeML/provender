"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribers per key, not one set for all of them.
 *
 * A single shared set would re-render every component using any stored flag whenever one of them
 * wrote — invisible at the call site, and wrong as soon as there is a second key.
 */
const listeners = new Map<string, Set<() => void>>();

function listenersFor(key: string) {
  const existing = listeners.get(key);

  if (existing) {
    return existing;
  }

  const created = new Set<() => void>();

  listeners.set(key, created);

  return created;
}

/**
 * `window.localStorage`, not `globalThis.localStorage`.
 *
 * Node has its own experimental global of that name which shadows jsdom's and reads as undefined,
 * so tests would silently exercise a no-op store. In a browser the two are the same object.
 */
function store() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function subscribeTo(key: string) {
  return (listener: () => void) => {
    const forKey = listenersFor(key);

    forKey.add(listener);
    // A write in another tab arrives as a storage event; a write in this one is announced by
    // `set`, because the event does not fire in the tab that caused it.
    window.addEventListener("storage", listener);

    return () => {
      forKey.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };
}

/**
 * A boolean kept in `localStorage`.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: a client component renders on the
 * server first, so seeding from `localStorage` in an initialiser would either crash or hydrate to
 * a different value, and setting state inside an effect starts a second render for something that
 * was never a state change. This is the primitive for reading a store React does not own, and its
 * server snapshot makes the first paint deterministic.
 *
 * Writes sync across tabs, because a `storage` event reaches every other tab and `set` notifies
 * this one.
 */
export function useStoredFlag(key: string) {
  // Memoised: an unstable `subscribe` makes useSyncExternalStore resubscribe on every render.
  const subscribe = useCallback((listener: () => void) => subscribeTo(key)(listener), [key]);

  const value = useSyncExternalStore(
    subscribe,
    () => store()?.getItem(key) === "true",
    // The server cannot know the preference, so it renders the default and the client corrects it.
    () => false,
  );

  const set = useCallback(
    (next: boolean) => {
      store()?.setItem(key, String(next));

      for (const listener of listenersFor(key)) {
        listener();
      }
    },
    [key],
  );

  return [value, set] as const;
}

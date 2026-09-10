"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean kept in `localStorage`.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: this component renders on the
 * server first, so seeding from `localStorage` in an initialiser would either crash or hydrate to
 * a different value, and setting state inside an effect starts a second render for something that
 * is not a state change. This is the primitive for reading a store React does not own, and its
 * server snapshot makes the first paint deterministic.
 *
 * It also syncs across tabs, because the store notifies every subscriber.
 */
const listeners = new Set<() => void>();

/**
 * `window.localStorage`, not `globalThis.localStorage`.
 *
 * Node has its own experimental global of that name which shadows jsdom's and reads as undefined,
 * so tests would silently exercise a no-op store. In a browser the two are the same object.
 */
function store() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // A write in another tab arrives as a storage event; a write in this one is announced by `set`.
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useStoredFlag(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => store()?.getItem(key) === "true",
    // The server cannot know the preference, so it renders the default and the client corrects it.
    () => false,
  );

  const set = useCallback(
    (next: boolean) => {
      store()?.setItem(key, String(next));

      for (const listener of listeners) {
        listener();
      }
    },
    [key],
  );

  return [value, set] as const;
}

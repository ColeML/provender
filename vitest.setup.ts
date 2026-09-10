import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom 30 does not provide `localStorage`, even with a real origin, so anything reading it sees
 * undefined and a test would silently exercise a no-op store. This is a minimal in-memory
 * `Storage` with the same semantics, installed only when the environment lacks one.
 */
if (typeof window !== "undefined" && !window.localStorage) {
  const entries = new Map<string, string>();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return entries.size;
      },
      key: (index: number) => [...entries.keys()][index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    } satisfies Storage,
  });
}

// Unmount between tests: a leaked tree makes the next test's getByRole ambiguous, which reads as a
// broken component rather than a dirty environment.
afterEach(cleanup);

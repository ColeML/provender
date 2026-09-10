"use client";

import { useEffect } from "react";

/**
 * Holds a screen wake lock while `active`, so a phone propped up mid-recipe does not sleep.
 *
 * Unsupported browsers do nothing rather than throwing: Safari only shipped this in 16.4, and a
 * cook view that fails to load is far worse than one whose screen dims.
 *
 * Re-acquires on `visibilitychange` because the browser drops the lock whenever the tab is
 * hidden — switching apps to answer a message and coming back would otherwise leave it off with
 * no sign that anything changed.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let lock: WakeLockSentinel | null = null;
    // The effect can be torn down while a request is still in flight, and releasing a sentinel
    // that arrives after that would otherwise leave the screen awake for the next view.
    let released = false;

    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");

        if (released) {
          await sentinel.release();

          return;
        }

        lock = sentinel;
      } catch {
        // A denied or interrupted request is not worth surfacing: the page still works.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}

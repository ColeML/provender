"use client";

import { useEffect } from "react";

/** Production only: a worker in `next dev` serves saved chunks to a page that hot reload changed. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    // A browser that refuses workers, as Firefox does in a private window, just gets no saved copy.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {});
  }, []);

  return null;
}

interface Props {
  paths: string[];
}

/** Asks `public/sw.js` to save these pages, so they open offline even if never visited. */
export function SaveWeekOffline({ paths }: Props) {
  useEffect(() => {
    // Offline, this page is itself the saved copy, and a save would only fail.
    if (!("serviceWorker" in navigator) || !navigator.onLine) {
      return;
    }

    const save = async () => {
      const registration = await navigator.serviceWorker.ready;

      registration.active?.postMessage({ type: "save-week", paths });
    };

    void save();
  }, [paths]);

  return null;
}

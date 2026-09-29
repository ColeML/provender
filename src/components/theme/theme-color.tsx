"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import { THEME_COLORS } from "./theme-colors";

function pointTagsAt(theme: string | undefined) {
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
    const tagTheme = tag.getAttribute("content") === THEME_COLORS.dark ? "dark" : "light";

    if (theme === "light" || theme === "dark") {
      tag.setAttribute("media", tagTheme === theme ? "all" : "not all");
    } else {
      tag.setAttribute("media", `(prefers-color-scheme: ${tagTheme})`);
    }
  }
}

/**
 * Keeps the status bar on the chosen theme after the page has loaded.
 *
 * Like `THEME_COLOR_SCRIPT`, it switches each tag's `media` and leaves its `content` alone. A
 * client-side navigation renders the tags afresh with the layout's device media, so it watches
 * <head> for them as well as the theme.
 */
export function ThemeColor() {
  const { theme } = useTheme();

  useEffect(() => {
    pointTagsAt(theme);

    const observer = new MutationObserver(() => pointTagsAt(theme));
    observer.observe(document.head, { childList: true });

    return () => observer.disconnect();
  }, [theme]);

  return null;
}

import { THEME_COLORS } from "./theme-colors";

type Scheme = "light" | "dark";

/** jsdom has no `matchMedia`, which next-themes reads to resolve "system". */
export function emulateDevice(scheme: Scheme) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: mediaMatches(query, scheme),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}

function mediaMatches(query: string | null, device: Scheme) {
  if (query === null || query === "all") {
    return true;
  }

  return query === `(prefers-color-scheme: ${device})`;
}

/** What `viewport.themeColor` in the root layout emits. */
export function addThemeColorTags() {
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}">
  `;
}

/** The color a browser gives the status bar: the first `theme-color` tag whose media applies. */
export function statusBarColor(device: Scheme) {
  const tag = [...document.querySelectorAll('meta[name="theme-color"]')].find((candidate) =>
    mediaMatches(candidate.getAttribute("media"), device),
  );

  return tag?.getAttribute("content");
}

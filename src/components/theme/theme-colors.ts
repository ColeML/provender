/** The installed app's status bar color per theme: each theme's `background` token. */
export const THEME_COLORS = { light: "#F9F0DE", dark: "#0F1C1D" };

/**
 * Moves the status bar onto a saved light or dark choice before first paint, the way next-themes'
 * own script does for the page. "theme" is next-themes' default storage key.
 *
 * It switches each tag's `media` and never its `content`: React hydrates a hoisted <meta> by its
 * content, and a changed one makes React insert a duplicate tag.
 */
export const THEME_COLOR_SCRIPT = `try {
  var theme = window.localStorage.getItem("theme");
  var colors = ${JSON.stringify(THEME_COLORS)};
  if (theme === "light" || theme === "dark") {
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (tag) {
      tag.setAttribute("media", tag.getAttribute("content") === colors[theme] ? "all" : "not all");
    });
  }
} catch (error) {}`;

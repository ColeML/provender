// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { addThemeColorTags, statusBarColor } from "./testing";
import { THEME_COLOR_SCRIPT } from "./theme-colors";

const VELLUM = "#F5EEDD";
const NIGHT = "#181310";

/**
 * Runs the script after the layout's `theme-color` tags, as the page does. Through `Function`
 * rather than a `<script>` tag, because jsdom runs tags against its own window, which has none of
 * the test's `localStorage`.
 */
function loadPage() {
  addThemeColorTags();
  new Function(THEME_COLOR_SCRIPT)();
}

function tagColors() {
  return [...document.querySelectorAll('meta[name="theme-color"]')].map((tag) =>
    tag.getAttribute("content"),
  );
}

afterEach(() => {
  window.localStorage.clear();
  document.head.innerHTML = "";
});

describe("THEME_COLOR_SCRIPT", () => {
  it("puts the status bar on a saved dark theme before the app loads", () => {
    window.localStorage.setItem("theme", "dark");

    loadPage();

    expect(statusBarColor("light")).toBe(NIGHT);
    expect(statusBarColor("dark")).toBe(NIGHT);
  });

  it("puts the status bar on a saved light theme before the app loads", () => {
    window.localStorage.setItem("theme", "light");

    loadPage();

    expect(statusBarColor("light")).toBe(VELLUM);
    expect(statusBarColor("dark")).toBe(VELLUM);
  });

  it("leaves the device in charge when the device is followed", () => {
    window.localStorage.setItem("theme", "system");

    loadPage();

    expect(statusBarColor("light")).toBe(VELLUM);
    expect(statusBarColor("dark")).toBe(NIGHT);
  });

  // React hydrates a hoisted <meta> by its content, so a rewritten color makes React insert a
  // second copy of the tag.
  it("keeps each tag's own color", () => {
    window.localStorage.setItem("theme", "dark");

    loadPage();

    expect(tagColors()).toEqual([VELLUM, NIGHT]);
  });
});

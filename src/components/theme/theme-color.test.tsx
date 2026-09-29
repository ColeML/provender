// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addThemeColorTags, emulateDevice, statusBarColor } from "./testing";
import { ThemeColor } from "./theme-color";
import { ThemePicker } from "./theme-picker";

const VELLUM = "#F5EEDD";
const NIGHT = "#181310";

function renderApp() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeColor />
      <ThemePicker />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  addThemeColorTags();
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.head.innerHTML = "";
});

describe("ThemeColor", () => {
  it("darkens the status bar when dark is picked on a light device", async () => {
    emulateDevice("light");
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(statusBarColor("light")).toBe(NIGHT);
  });

  it("lightens the status bar when light is picked on a dark device", async () => {
    emulateDevice("dark");
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(statusBarColor("dark")).toBe(VELLUM);
  });

  it("follows the device again when match device is picked", async () => {
    emulateDevice("dark");
    window.localStorage.setItem("theme", "light");
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("radio", { name: "Match device" }));

    expect(statusBarColor("dark")).toBe(NIGHT);
    expect(statusBarColor("light")).toBe(VELLUM);
  });

  it("keeps the choice when a navigation renders the tags again", async () => {
    emulateDevice("light");
    window.localStorage.setItem("theme", "dark");
    renderApp();

    addThemeColorTags();

    await waitFor(() => expect(statusBarColor("light")).toBe(NIGHT));
  });
});

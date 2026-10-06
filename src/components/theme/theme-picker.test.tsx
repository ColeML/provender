// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { emulateDevice } from "./testing";
import { ThemePicker } from "./theme-picker";

function renderPicker() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemePicker />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  emulateDevice("light");
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
});

describe("ThemePicker", () => {
  it("switches the app to dark and remembers it", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("switches the app to light on a dark device", async () => {
    emulateDevice("dark");
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement).toHaveClass("light");
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("goes back to following the device", async () => {
    emulateDevice("dark");
    window.localStorage.setItem("theme", "light");
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("radio", { name: "Match device" }));

    expect(screen.getByRole("radio", { name: "Match device" })).toBeChecked();
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("system");
  });

  it("shows the choice already saved on this device", () => {
    window.localStorage.setItem("theme", "dark");
    renderPicker();

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
  });
});

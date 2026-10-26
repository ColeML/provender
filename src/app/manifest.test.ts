import { describe, expect, it } from "vitest";

import { THEME_COLORS } from "@/components/theme/theme-colors";

import manifest from "./manifest";

describe("manifest", () => {
  it("gives the installed app the dark theme's colors, which read in either theme", () => {
    expect(manifest()).toMatchObject({
      theme_color: THEME_COLORS.dark,
      background_color: THEME_COLORS.dark,
    });
  });
});

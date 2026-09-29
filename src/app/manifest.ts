import type { MetadataRoute } from "next";

import { THEME_COLORS } from "@/components/theme/theme-colors";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Provender",
    short_name: "Provender",
    description: "Weekly meal planning, provisioned.",
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    // The glyph sits inside the maskable safe zone, so one image serves both purposes.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import { Charis_SIL } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";

import { Providers } from "@/lib/trpc/client";

import "./globals.css";

/**
 * Charter, which Google Fonts publishes as Charis SIL. `next/font` downloads it at build time and
 * serves it from our own origin, so a page view makes no request to Google.
 *
 * Charis SIL is not a variable font and ships 400 and 700 only. Every title is `font-semibold`,
 * which CSS font matching resolves to 700, so 700 is the only weight worth the download. A title
 * that wants normal weight has to add 400 here — the browser would otherwise draw it at 700.
 */
const display = Charis_SIL({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-charis",
});

export const metadata: Metadata = {
  title: "Provender",
  description: "Weekly meal planning, provisioned.",
};

// The manifest's theme_color can't follow the theme, so the installed app's status bar takes its
// color from here. The theme is system-only, so the media query always agrees with next-themes.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5EEDD" },
    { media: "(prefers-color-scheme: dark)", color: "#181310" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the theme class on <html> before paint, so the server markup and the first
    // client render disagree by design.
    <html lang="en" className={display.variable} suppressHydrationWarning>
      <body className="antialiased">
        {/* The dev-only "Encountered a script tag" warning is next-themes' pre-paint theme script;
            silencing it in 0.4.6 means stopping the script (pacocoursey/next-themes#385). */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

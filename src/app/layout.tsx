import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

import { Providers } from "@/lib/trpc/client";

import "./globals.css";

export const metadata: Metadata = {
  title: "Provender",
  description: "Weekly meal planning, provisioned.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the theme class on <html> before paint, so the server markup and the first
    // client render disagree by design.
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

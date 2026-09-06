import type { Metadata } from "next";

import { Providers } from "@/lib/trpc/client";

import "./globals.css";

export const metadata: Metadata = {
  title: "Provender",
  description: "Weekly meal planning, provisioned.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

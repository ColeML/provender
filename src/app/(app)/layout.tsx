import Link from "next/link";
import { Suspense } from "react";

import { BareSurfaceLinks, SurfaceLinks } from "@/components/ui/surface-links";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * The signed-in shell. `/login` sits outside this group, so it never renders the nav.
 *
 * The header deliberately does not stick. `/shop` is used one-handed in an aisle, where every row
 * of screen is a row of list, and its aisle headings already own `top-0`.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-border border-b">
        {/* Wraps so the surface links drop to a second row on a phone rather than run off it. */}
        <nav className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link
            href="/"
            className="focus-visible:ring-ring rounded-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            <Wordmark />
          </Link>

          <span className="flex-1" />

          {/* `SurfaceLinks` reads the query string, which Next requires a boundary around. The
              fallback is the same links without the week, so a route that is not dynamic loses
              the carried week rather than the whole nav. */}
          <div className="flex gap-4">
            <Suspense fallback={<BareSurfaceLinks />}>
              <SurfaceLinks />
            </Suspense>
          </div>
        </nav>
      </header>

      {children}
    </>
  );
}

import { Settings } from "lucide-react";
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
        {/* On a phone the tabs take a row of their own under the wordmark and gear: the four of
            them beside both need about 390px, which is wider than the screen. */}
        <nav className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 px-4 pt-2 sm:pb-2">
          <Link
            href="/"
            className="focus-visible:ring-ring -mx-1.5 inline-flex min-h-11 items-center rounded-sm px-1.5 focus-visible:ring-3 focus-visible:outline-none"
          >
            <Wordmark />
          </Link>

          <span className="flex-1" />

          {/* `SurfaceLinks` reads the query string, which Next requires a boundary around. The
              fallback is the same links without the week, so a route that is not dynamic loses
              the carried week rather than the whole nav. */}
          <div className="order-last -mx-2 flex w-full sm:order-none sm:w-auto">
            <Suspense fallback={<BareSurfaceLinks />}>
              <SurfaceLinks />
            </Suspense>
          </div>

          <Link
            href="/settings"
            aria-label="Settings"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:ring-3 focus-visible:outline-none"
          >
            <Settings aria-hidden className="size-5" />
          </Link>
        </nav>
      </header>

      {children}
    </>
  );
}

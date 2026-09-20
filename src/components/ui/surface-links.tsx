"use client";

import { parseIsoWeek } from "@server/lib/iso-week";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** `carriesWeek` marks the surfaces that read `?week=`; the others have no week to keep. */
const SURFACES = [
  { href: "/plan", label: "Plan", carriesWeek: true },
  { href: "/shop", label: "Shop", carriesWeek: true },
  { href: "/recipes", label: "Recipes", carriesWeek: false },
  { href: "/settings", label: "Settings", carriesWeek: false },
];

const CLASS = "text-muted-foreground hover:text-foreground text-sm";

/**
 * The same links with no week on them, for the Suspense fallback.
 *
 * `useSearchParams` makes its boundary fall back while a route is prerendered, and every page in
 * this group is `force-dynamic` today. Falling back to the links rather than to nothing means a
 * page that stops being dynamic loses the carried week, not the whole navigation.
 */
export function BareSurfaceLinks() {
  return (
    <>
      {SURFACES.map((surface) => (
        <Link key={surface.href} href={surface.href} className={CLASS}>
          {surface.label}
        </Link>
      ))}
    </>
  );
}

/**
 * The header's surface links, carrying the selected week between `/plan` and `/shop`.
 *
 * A week picked on one is the week meant on the other: you plan Thursday, then shop for it. The
 * week rides in the URL rather than in stored state, so the back button and a shared link both
 * land where they read, and opening the app fresh always starts on the current week.
 */
export function SurfaceLinks() {
  const week = useSearchParams().get("week");
  // A hand-typed `?week=` reaches here, and the header must not spread a junk value app-wide.
  const carried = week !== null && parseIsoWeek(week) !== undefined ? week : undefined;

  return (
    <>
      {SURFACES.map((surface) => (
        <Link
          key={surface.href}
          href={
            surface.carriesWeek && carried !== undefined
              ? `${surface.href}?week=${carried}`
              : surface.href
          }
          className={CLASS}
        >
          {surface.label}
        </Link>
      ))}
    </>
  );
}

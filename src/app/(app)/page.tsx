import { householdForSession } from "@server/auth/household";
import { weekOverview } from "@server/services/overview";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "../../../auth";

/**
 * Read at request time, not build time.
 *
 * The week is live data, and prerendering would both freeze it into the build and make a reachable
 * database a requirement for building — which fails in CI and on a preview deploy before the
 * database is wired up.
 */
export const dynamic = "force-dynamic";

const SLOT_LABELS: Record<string, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
};

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { planId, isCurrentWeek, days, outstandingItems } = await weekOverview(
    householdForSession(session),
  );

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">This week</h1>

      {planId === null ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No week is planned yet.{" "}
          <Link href="/plan" className="text-foreground underline">
            Plan one
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-1 text-sm">
            {isCurrentWeek ? planId : `${planId} — the most recent week planned`}
            {outstandingItems > 0 ? (
              <>
                {" · "}
                <Link href="/shop" className="text-foreground underline">
                  {outstandingItems === 1 ? "1 item to buy" : `${outstandingItems} items to buy`}
                </Link>
              </>
            ) : (
              " · nothing left to buy"
            )}
          </p>

          {days.length === 0 ? (
            <p className="text-muted-foreground mt-6 text-sm">
              The week exists but no days are filled in.{" "}
              <Link href="/plan" className="text-foreground underline">
                Plan the days
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-border mt-6 divide-y">
              {days.map((day) => (
                <li key={`${day.date}-${day.mealSlot}`} className="flex items-baseline gap-3 py-3">
                  {/* Stacked because "Wednesday breakfast" overflows this column at any phone
                      width, which wrapped the slot word below the dish it labels. */}
                  <span className="relative flex min-h-11 w-24 shrink-0 flex-col justify-center text-sm font-medium">
                    {/* The overlay stretches the link's hit area over the span's full height, at
                        the cost of making the slot word part of the link rather than selectable. */}
                    <Link
                      href={`/plan/${day.date}`}
                      className="focus-visible:after:ring-ring underline after:absolute after:inset-0 after:rounded-sm focus-visible:outline-none focus-visible:after:ring-3"
                    >
                      {WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}
                    </Link>

                    {/* The meal is named on every row but dinner, which is the default and the
                        only one a week of planning writes. */}
                    {day.mealSlot === "dinner" ? null : (
                      <span className="text-muted-foreground font-normal">
                        {SLOT_LABELS[day.mealSlot] ?? day.mealSlot}
                      </span>
                    )}
                  </span>

                  {/* The title link needs `box-decoration-clone`: a title that wraps splits an
                      inline element into fragments, and the default slice leaves the ring open. */}
                  <span className="min-w-0 flex-1">
                    {day.mainRecipeId === null ? (
                      <span className="text-muted-foreground text-sm">
                        {day.status === "planned" ? "No main" : day.status}
                      </span>
                    ) : (
                      <Link
                        href={`/recipes/${day.mainRecipeId}`}
                        className="focus-visible:ring-ring box-decoration-clone rounded-sm text-base focus-visible:ring-3 focus-visible:outline-none"
                      >
                        {day.mainTitle ?? day.mainRecipeId}
                      </Link>
                    )}
                  </span>

                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {DAY.format(new Date(`${day.date}T00:00:00Z`))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

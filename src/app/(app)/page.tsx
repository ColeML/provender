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
      <h1 className="text-2xl font-semibold">This week</h1>

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
                  <span className="w-24 shrink-0 text-sm font-medium">
                    {day.mealSlot === "dinner" ? (
                      // Only dinners: the day view is the dinner, so a lunch row linking there
                      // would show a meal the reader did not tap.
                      <Link href={`/plan/${day.date}`}>
                        {WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}
                      </Link>
                    ) : (
                      <>
                        {WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}
                        <span className="text-muted-foreground font-normal"> lunch</span>
                      </>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    {day.mainRecipeId === null ? (
                      <span className="text-muted-foreground text-sm">
                        {day.status === "planned" ? "No main" : day.status}
                      </span>
                    ) : (
                      <Link href={`/recipes/${day.mainRecipeId}`} className="text-base">
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

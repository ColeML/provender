import { householdForSession } from "@server/auth/household";
import { weekOverview } from "@server/services/overview";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WeekDays } from "@/components/home/week-days";

import { auth } from "../../../auth";

/**
 * Read at request time, not build time.
 *
 * The week is live data, and prerendering would both freeze it into the build and make a reachable
 * database a requirement for building — which fails in CI and on a preview deploy before the
 * database is wired up.
 */
export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const formatDay = (date: string) => DAY.format(new Date(`${date}T00:00:00Z`));

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { planId, isCurrentWeek, dates, days, outstandingItems } = await weekOverview(
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
            {formatDay(dates[0])} – {formatDay(dates[6])}
            {isCurrentWeek ? null : " — the most recent week planned"}
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

          <WeekDays dates={dates} days={days} />
        </>
      )}
    </main>
  );
}

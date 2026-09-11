import { householdForSession } from "@server/auth/household";
import { isCalendarDate, isoWeekFor } from "@server/lib/iso-week";
import { InvalidPlanIdError, PlanNotFoundError } from "@server/services/plans";
import { getForecast } from "@server/services/weather";
import { daySlots } from "@server/services/week-plan";
import { notFound, redirect } from "next/navigation";

import { DayView, type DayWeather } from "@/components/plan/day-view";

import { auth } from "../../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

const TITLE_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  if (!isCalendarDate(date)) {
    return { title: "Day — Provender" };
  }

  return { title: `${TITLE_DATE.format(new Date(`${date}T00:00:00Z`))} — Provender` };
}

/** How far ahead Open-Meteo will forecast, and the most `getForecast` will return. */
const FORECAST_DAYS = 16;

function shiftDays(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`);

  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}

/**
 * Never fails the page: a forecast is context for the day, not the point of it.
 *
 * A date the forecast cannot cover skips the request entirely. Open-Meteo answers for today
 * onward, so last Tuesday would otherwise pay a geocode and a forecast call — each with a 15s
 * timeout — to render the same dash it renders for free.
 *
 * The window starts yesterday because Open-Meteo is asked with `timezone: "auto"` and so answers
 * in the household's local days, while this process only knows UTC. Oklahoma is six hours behind,
 * so from 19:00 there the local day is UTC's yesterday — and 19:00 is when this screen is read.
 * One request that finds nothing costs less than dropping tonight's forecast. The far edge is
 * uncertain the same way, and is left permissive for the same reason.
 */
async function weatherOrNothing(householdId: string, date: string): Promise<DayWeather | null> {
  const today = new Date().toISOString().slice(0, 10);

  if (date < shiftDays(today, -1) || date > shiftDays(today, FORECAST_DAYS - 1)) {
    return null;
  }

  try {
    const { days } = await getForecast(householdId, { days: FORECAST_DAYS });

    return days.find((day) => day.date === date) ?? null;
  } catch {
    return null;
  }
}

export default async function Day({ params }: { params: Promise<{ date: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const householdId = householdForSession(session);
  const { date } = await params;

  if (!isCalendarDate(date)) {
    notFound();
  }

  const planId = isoWeekFor(date);

  const [slots, weather] = await Promise.all([
    // A week nobody has planned is not an error here — the day simply reads as unplanned.
    daySlots(householdId, date).catch((error: unknown) => {
      if (error instanceof PlanNotFoundError || error instanceof InvalidPlanIdError) {
        return [];
      }

      throw error;
    }),
    weatherOrNothing(householdId, date),
  ]);

  return <DayView planId={planId} date={date} slots={slots} weather={weather} />;
}

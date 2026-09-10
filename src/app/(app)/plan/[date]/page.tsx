import { householdForSession } from "@server/auth/household";
import { isCalendarDate, isoWeekFor } from "@server/lib/iso-week";
import { InvalidPlanIdError, PlanNotFoundError } from "@server/services/plans";
import { getForecast } from "@server/services/weather";
import { weekPlan, type WeekPlanDay } from "@server/services/week-plan";
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

function unplannedDay(date: string): WeekPlanDay {
  return {
    date,
    planned: false,
    servings: null,
    status: "unplanned",
    notes: null,
    main: null,
    side: null,
    extras: [],
  };
}

/**
 * Never fails the page: a forecast is context for the day, not the point of it.
 *
 * A date outside the forecast window skips the request entirely. Open-Meteo only answers for today
 * onward, so last Tuesday would otherwise pay a geocode and a forecast call — each with a 15s
 * timeout — to render the same dash it renders for free.
 */
async function weatherOrNothing(householdId: string, date: string): Promise<DayWeather | null> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(`${today}T00:00:00Z`);

  horizon.setUTCDate(horizon.getUTCDate() + FORECAST_DAYS - 1);

  if (date < today || date > horizon.toISOString().slice(0, 10)) {
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

  const [plan, weather] = await Promise.all([
    // A week nobody has planned is not an error here — the day simply reads as unplanned.
    weekPlan(householdId, planId).catch((error: unknown) => {
      if (error instanceof PlanNotFoundError || error instanceof InvalidPlanIdError) {
        return null;
      }

      throw error;
    }),
    weatherOrNothing(householdId, date),
  ]);

  const day = plan?.days.find((candidate) => candidate.date === date) ?? unplannedDay(date);

  return <DayView planId={planId} day={day} weather={weather} />;
}

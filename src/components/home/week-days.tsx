"use client";

import type { OverviewDay } from "@server/services/overview";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const FOCUS = "focus-visible:ring-ring rounded-sm focus-visible:ring-3 focus-visible:outline-none";

const subscribe = () => () => {};

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The browser's date, not the server's. The server clock is UTC, which is already tomorrow by
 * dinner time in the US. `null` on the server, so the first client render matches its HTML.
 */
function useToday() {
  return useSyncExternalStore(subscribe, localDate, () => null);
}

interface DayMealsProps {
  date: string;
  meals: OverviewDay[];
}

function DayMeals({ date, meals }: DayMealsProps) {
  if (meals.length === 0) {
    return (
      <Link
        href={`/plan/${date}`}
        className={cn("text-muted-foreground inline-flex min-h-11 items-center text-sm", FOCUS)}
      >
        Nothing planned
      </Link>
    );
  }

  return (
    <ul className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1">
      {meals.map((meal) => (
        <li key={meal.mealSlot} className="contents">
          <span className="text-muted-foreground pt-0.5 text-sm">{meal.mealSlot}</span>
          <span className="min-w-0">
            {meal.mainRecipeId === null ? (
              <span className="text-muted-foreground text-sm">
                {meal.status === "planned" ? "No main" : meal.status}
              </span>
            ) : (
              /* `box-decoration-clone` keeps the ring closed around a title that wraps. */
              <Link
                href={`/recipes/${meal.mainRecipeId}`}
                className={cn("box-decoration-clone text-base", FOCUS)}
              >
                {meal.mainTitle ?? meal.mainRecipeId}
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  dates: string[];
  days: OverviewDay[];
}

export function WeekDays({ dates, days }: Props) {
  const today = useToday();

  return (
    <ul className="divide-border mt-6 divide-y">
      {dates.map((date) => {
        const calendarDay = new Date(`${date}T00:00:00Z`);
        const isToday = date === today;
        const isPast = today !== null && date < today;

        return (
          <li
            key={date}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "border-l-3 pb-3 pl-3",
              isToday ? "border-l-accent" : "border-l-transparent",
              isPast && "text-muted-foreground",
            )}
          >
            <div className="relative flex min-h-11 items-center justify-between gap-3">
              {/* The overlay stretches the link's hit area over the whole header line. */}
              <Link
                href={`/plan/${date}`}
                className="focus-visible:after:ring-ring text-base font-semibold underline after:absolute after:inset-0 after:rounded-sm focus-visible:outline-none focus-visible:after:ring-3"
              >
                {WEEKDAY.format(calendarDay)}
              </Link>
              <span className="text-muted-foreground font-mono text-xs">
                {DAY.format(calendarDay)}
              </span>
            </div>

            <DayMeals date={date} meals={days.filter((day) => day.date === date)} />
          </li>
        );
      })}
    </ul>
  );
}

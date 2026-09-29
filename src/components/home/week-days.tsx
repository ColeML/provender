"use client";

import type { OverviewDay } from "@server/services/overview";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const DAY_NUMBER = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });

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
        className={cn("text-muted-foreground flex min-h-11 flex-1 items-center text-sm", FOCUS)}
      >
        Nothing planned
      </Link>
    );
  }

  return (
    <ul className="min-w-0 flex-1 space-y-1">
      {meals.map((meal) => (
        <li key={meal.mealSlot} className="flex items-baseline gap-2">
          {/* Dinner is the default, so only the other meals are named. */}
          {meal.mealSlot === "dinner" ? null : (
            <span className="text-muted-foreground shrink-0 text-sm">{meal.mealSlot}</span>
          )}
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
        const meals = days.filter((day) => day.date === date);
        const calendarDay = new Date(`${date}T00:00:00Z`);
        const isToday = date === today;
        const isPast = today !== null && date < today;

        return (
          <li
            key={date}
            aria-current={isToday ? "date" : undefined}
            className={cn(
              "flex items-baseline gap-3 border-l-3 py-3 pl-3",
              isToday ? "border-l-accent" : "border-l-transparent",
              isPast && "text-muted-foreground",
            )}
          >
            <span className="relative flex min-h-11 w-16 shrink-0 flex-col justify-center font-mono text-sm">
              {/* The overlay stretches the link's hit area over the span's full height. */}
              <Link
                href={`/plan/${date}`}
                className="focus-visible:after:ring-ring underline after:absolute after:inset-0 after:rounded-sm focus-visible:outline-none focus-visible:after:ring-3"
              >
                {WEEKDAY.format(calendarDay)} {DAY_NUMBER.format(calendarDay)}
              </Link>
              {isToday ? <span className="text-accent font-sans text-xs">Today</span> : null}
            </span>

            <DayMeals date={date} meals={meals} />
          </li>
        );
      })}
    </ul>
  );
}

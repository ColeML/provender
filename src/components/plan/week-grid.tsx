"use client";

import type { WeekPlan, WeekPlanDay } from "@server/services/week-plan";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export interface RecipeChoice {
  recipeId: string;
  title: string;
}

export interface DayForecast {
  date: string;
  high: number | null;
  low: number | null;
  conditions: string;
}

interface Props {
  week: WeekPlan;
  recipes: RecipeChoice[];
  forecast: DayForecast[];
  /** Used when a swap turns an unplanned day into a planned one, since a day must have servings. */
  defaultServings: number;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const DATE = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function utc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

/** A pending choice, keyed `<date>:<role>`, so one day's edit does not touch another's. */
type Pending = Record<string, string | null>;

export function WeekGrid({ week, recipes, forecast, defaultServings }: Props) {
  const trpc = useTRPC();
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const byDate = new Map(forecast.map((day) => [day.date, day]));

  function settle(date: string) {
    setSaving((current) => {
      const next = new Set(current);

      next.delete(date);

      return next;
    });
  }

  const onSettled = {
    onError: (_error: unknown, variables: { date: string }) => {
      settle(variables.date);
      // Drop the optimistic value, so the grid shows what is actually stored rather than a choice
      // that never landed.
      setPending({});
      setFailed("That change did not save. Try again.");
    },
    onSuccess: (_data: unknown, variables: { date: string }) => {
      settle(variables.date);
      setFailed(null);
      // The server component owns the week, and its refresh is what supersedes the optimistic
      // value and moves the running total.
      router.refresh();
    },
  };

  const setDay = useMutation(trpc.plans.setDay.mutationOptions(onSettled));
  const clearDay = useMutation(trpc.plans.clearDay.mutationOptions(onSettled));

  function chosen(day: WeekPlanDay, role: "main" | "side") {
    const key = `${day.date}:${role}`;

    return key in pending
      ? pending[key]
      : ((role === "main" ? day.main : day.side)?.recipeId ?? null);
  }

  function swap(day: WeekPlanDay, role: "main" | "side", recipeId: string | null) {
    setPending((current) => ({ ...current, [`${day.date}:${role}`]: recipeId }));
    setSaving((current) => new Set(current).add(day.date));

    setDay.mutate({
      planId: week.planId,
      date: day.date,
      servings: day.servings ?? defaultServings,
      status: day.planned ? day.status : "planned",
      notes: day.notes,
      main: role === "main" ? recipeId : chosen(day, "main"),
      side: role === "side" ? recipeId : chosen(day, "side"),
      extras: day.extras.map((extra) => extra.recipeId),
    });
  }

  function clear(day: WeekPlanDay) {
    setSaving((current) => new Set(current).add(day.date));
    clearDay.mutate({ planId: week.planId, date: day.date });
  }

  const over = week.budgetTarget !== null && week.estimatedCost > week.budgetTarget;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold">{week.planId}</h1>

        <p className="font-mono text-sm">
          <span className={cn(over && "text-destructive")}>{money(week.estimatedCost)}</span>
          {week.budgetTarget === null ? null : (
            <span className="text-muted-foreground"> of {money(week.budgetTarget)}</span>
          )}
        </p>
      </header>

      {failed === null ? null : (
        <p role="alert" className="text-destructive mt-3 text-sm">
          {failed}
        </p>
      )}

      {/* Below the desktop breakpoint the week is read-only: planning is a sit-down activity, and
          a cramped mobile editor would go unused. */}
      <ul aria-label="Week summary" className="divide-border mt-6 divide-y lg:hidden">
        {week.days.map((day) => (
          <li key={day.date} className="py-3">
            <p className="text-sm font-medium">
              <Link
                href={`/plan/${day.date}`}
                className="inline-flex min-h-11 items-center underline"
              >
                {WEEKDAY.format(utc(day.date))} {DATE.format(utc(day.date))}
              </Link>
            </p>

            {day.main === null && day.side === null && day.extras.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {day.planned ? day.status : "Nothing planned"}
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {[day.main, day.side, ...day.extras]
                  .filter((recipe) => recipe !== null)
                  .map((recipe) => (
                    <li key={recipe.recipeId} className="text-sm">
                      <Link href={`/recipes/${recipe.recipeId}`}>{recipe.title}</Link>
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 hidden grid-cols-7 gap-3 lg:grid">
        {week.days.map((day) => {
          const weather = byDate.get(day.date);

          return (
            <section key={day.date} className="flex flex-col gap-2">
              <header>
                <h2 className="text-sm font-medium">
                  <Link href={`/plan/${day.date}`} className="underline">
                    {WEEKDAY.format(utc(day.date))}{" "}
                    <span className="text-muted-foreground font-normal">
                      {DATE.format(utc(day.date))}
                    </span>
                  </Link>
                </h2>

                <p className="text-muted-foreground text-xs">
                  {weather === undefined
                    ? "—"
                    : `${weather.high === null ? "?" : Math.round(weather.high)}° ${weather.conditions}`}
                </p>
              </header>

              <RecipePicker
                label="Main"
                value={chosen(day, "main")}
                recipes={recipes}
                disabled={saving.has(day.date)}
                onChange={(recipeId) => swap(day, "main", recipeId)}
              />

              <RecipePicker
                label="Side"
                value={chosen(day, "side")}
                recipes={recipes}
                disabled={saving.has(day.date)}
                onChange={(recipeId) => swap(day, "side", recipeId)}
              />

              {day.extras.length === 0 ? null : (
                <ul className="text-muted-foreground space-y-0.5 text-xs">
                  {day.extras.map((extra) => (
                    <li key={extra.recipeId}>{extra.title}</li>
                  ))}
                </ul>
              )}

              <p className="text-muted-foreground mt-auto pt-1 font-mono text-xs">
                {day.planned ? `${day.servings} sv` : "—"}
              </p>

              {day.planned ? (
                <button
                  type="button"
                  disabled={saving.has(day.date)}
                  onClick={() => clear(day)}
                  className="text-muted-foreground hover:text-destructive text-left text-xs underline disabled:opacity-50"
                >
                  Clear
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}

function RecipePicker({
  label,
  value,
  recipes,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  recipes: RecipeChoice[];
  disabled: boolean;
  onChange: (recipeId: string | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-muted-foreground text-xs">{label}</span>

      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className="border-muted-foreground bg-background focus-visible:ring-ring mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
      >
        <option value="">None</option>

        {recipes.map((recipe) => (
          <option key={recipe.recipeId} value={recipe.recipeId}>
            {recipe.title}
          </option>
        ))}
      </select>
    </label>
  );
}

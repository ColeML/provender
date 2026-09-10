import type { RecipeSummary } from "@server/services/recipes";
import type { WeekPlanDay } from "@server/services/week-plan";
import Link from "next/link";

export interface DayWeather {
  high: number | null;
  low: number | null;
  precipChance: number | null;
  conditions: string;
}

interface Props {
  planId: string;
  day: WeekPlanDay;
  weather: DayWeather | null;
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function utc(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

interface Dish {
  role: string;
  recipe: RecipeSummary;
}

function dishesOf(day: WeekPlanDay, potluck: boolean): Dish[] {
  const dishes: Dish[] = [];

  if (day.main !== null) {
    dishes.push({ role: "Main", recipe: day.main });
  }

  if (day.side !== null) {
    dishes.push({ role: "Side", recipe: day.side });
  }

  for (const extra of day.extras) {
    dishes.push({ role: "Extra", recipe: extra });
  }

  // On a potluck nothing is a main, a side or an afterthought — every dish is what you carry to
  // someone else's table, so labeling one of them "Side" contradicts the heading above it.
  return potluck ? dishes.map((dish) => ({ ...dish, role: "Bringing" })) : dishes;
}

function summarizeWeather({ high, low, precipChance, conditions }: DayWeather) {
  const temperatures = [high, low]
    .filter((value) => value !== null)
    .map((value) => `${Math.round(value)}°`)
    .join(" / ");

  return [temperatures, conditions, precipChance === null ? null : `${precipChance}% rain`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One day's whole meal, read at the counter rather than at a desk.
 *
 * Sized like `/shop` rather than `/plan`: the question it answers — "what are we eating tonight,
 * and what am I cooking" — is asked with a phone in one hand.
 */
export function DayView({ planId, day, weather }: Props) {
  if (!day.planned) {
    return (
      <main className="mx-auto max-w-2xl p-4 pb-16">
        <DayHeading planId={planId} date={day.date} />

        {/* The forecast still shows: on an unplanned day it is the input for what to plan. */}
        {weather === null ? null : (
          <dl className="mt-8">
            <Fact label="Forecast">{summarizeWeather(weather)}</Fact>
          </dl>
        )}

        <p className="mt-8 text-base">
          Nothing is planned for this day.{" "}
          <Link href={`/plan?week=${planId}`} className="underline">
            Plan the week
          </Link>
          .
        </p>
      </main>
    );
  }

  const potluck = day.main === null && day.extras.length > 0;
  const dishes = dishesOf(day, potluck);
  const timed = dishes.filter((dish) => dish.recipe.totalMin !== null);
  const totalMin = timed.reduce((total, dish) => total + (dish.recipe.totalMin ?? 0), 0);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <DayHeading planId={planId} date={day.date} />

      <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-6">
        <Fact label="Servings">
          <span className="font-mono">{day.servings ?? "—"}</span>
        </Fact>

        <Fact label="Status">{day.status}</Fact>

        <Fact label="Total time">
          {timed.length === 0 ? (
            "—"
          ) : (
            <>
              <span className="font-mono">{totalMin}</span> min
            </>
          )}
        </Fact>

        <Fact label="Forecast">{weather === null ? "—" : summarizeWeather(weather)}</Fact>
      </dl>

      {timed.length === 0 || timed.length === dishes.length ? null : (
        <p className="text-muted-foreground mt-2 text-xs">
          {dishes.length - timed.length} of {dishes.length} dishes have no time recorded.
        </p>
      )}

      {day.notes === null || day.notes.trim() === "" ? null : (
        <section aria-labelledby="notes" className="mt-8">
          <h2 id="notes" className="text-muted-foreground text-xs">
            Notes
          </h2>

          <p className="mt-1 text-base whitespace-pre-line">{day.notes}</p>
        </section>
      )}

      <section aria-labelledby="menu" className="mt-8">
        <h2 id="menu" className="text-muted-foreground text-xs">
          {potluck ? "Potluck" : "Menu"}
        </h2>

        {potluck ? (
          <p className="mt-1 text-sm">No main tonight — the meal is what you are bringing.</p>
        ) : null}

        {dishes.length === 0 ? (
          <p className="mt-1 text-base">This day is planned, but no dishes are chosen yet.</p>
        ) : (
          <ul className="divide-border mt-1 divide-y">
            {dishes.map((dish) => (
              <li key={`${dish.role}-${dish.recipe.recipeId}`}>
                <Link
                  href={`/recipes/${dish.recipe.recipeId}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground block text-xs">{dish.role}</span>
                    <span className="text-lg">{dish.recipe.title}</span>
                  </span>

                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {dish.recipe.totalMin === null ? "" : `${dish.recipe.totalMin} min`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function DayHeading({ planId, date }: { planId: string; date: string }) {
  return (
    <>
      <Link href={`/plan?week=${planId}`} className="text-muted-foreground text-sm underline">
        {planId}
      </Link>

      <h1 className="mt-2 text-3xl font-semibold">{WEEKDAY.format(utc(date))}</h1>

      <p className="text-muted-foreground mt-1 text-sm">{FULL_DATE.format(utc(date))}</p>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-lg">{children}</dd>
    </div>
  );
}

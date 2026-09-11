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
  date: string;
  /** Every meal planned on this date, in the order they are eaten. Empty when nothing is. */
  slots: WeekPlanDay[];
  weather: DayWeather | null;
}

const SLOT_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

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

function dishesOf(day: WeekPlanDay): Dish[] {
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

  return dishes;
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

export function DayView({ planId, date, slots, weather }: Props) {
  if (slots.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-4 pb-16">
        <DayHeading planId={planId} date={date} />

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

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <DayHeading planId={planId} date={date} />

      <dl className="mt-8">
        <Fact label="Forecast">{weather === null ? "—" : summarizeWeather(weather)}</Fact>
      </dl>

      {slots.map((slot) => (
        <Meal key={slot.mealSlot} slot={slot} />
      ))}
    </main>
  );
}

/** One meal on the day. Named even when it is the only one, so a second is not a surprise. */
function Meal({ slot }: { slot: WeekPlanDay }) {
  const dishes = dishesOf(slot);
  // A single dish and no main is a potluck whether it was stored as the side or as an extra.
  const potluck = slot.main === null && dishes.length > 0;
  const timed = dishes.filter((dish) => dish.recipe.totalMin !== null);
  const totalMin = timed.reduce((total, dish) => total + (dish.recipe.totalMin ?? 0), 0);
  const label = SLOT_LABELS[slot.mealSlot] ?? slot.mealSlot;

  return (
    <section aria-label={label} className="border-border mt-8 border-t pt-6">
      <h2 className="text-xl font-semibold">
        {label}
        {potluck ? <span className="text-muted-foreground font-normal">{" · potluck"}</span> : null}
      </h2>

      {potluck ? (
        <p className="mt-1 text-sm">No main — the meal is what you are bringing.</p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6">
        <Fact label="Servings">
          <span className="font-mono">{slot.servings ?? "—"}</span>
        </Fact>

        <Fact label="Status">{slot.status}</Fact>

        <Fact label="Total time">
          {timed.length === 0 ? (
            "—"
          ) : (
            <>
              <span className="font-mono">{totalMin}</span> min
            </>
          )}
        </Fact>
      </dl>

      {timed.length === dishes.length ? null : (
        <p className="text-muted-foreground mt-2 text-xs">
          {dishes.length - timed.length} of {dishes.length} dishes have no time recorded.
        </p>
      )}

      {slot.notes === null || slot.notes.trim() === "" ? null : (
        <section className="mt-6">
          <h3 className="text-muted-foreground text-xs">Notes</h3>

          <p className="mt-1 text-base whitespace-pre-line">{slot.notes}</p>
        </section>
      )}

      {dishes.length === 0 ? (
        <p className="mt-6 text-base">This meal is planned, but no dishes are chosen yet.</p>
      ) : (
        <ul className="divide-border mt-6 divide-y">
          {dishes.map((dish, position) => (
            // Keyed by position: nothing stops a meal from listing the same recipe as its side
            // and again as an extra, and the list is never reordered or edited in place.
            <li key={`${position}-${dish.recipe.recipeId}`}>
              <Link
                href={`/recipes/${dish.recipe.recipeId}`}
                className="flex min-h-11 items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0">
                  <span className="text-muted-foreground block text-xs">
                    {/* "Side" on a potluck contradicts the heading saying there is no main. */}
                    {potluck ? "Bringing" : dish.role}
                  </span>
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

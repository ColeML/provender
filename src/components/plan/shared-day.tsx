import { LogoMark } from "@/components/ui/logo-mark";
import { Wordmark } from "@/components/ui/wordmark";
import { RecipeSections, type SharedIngredient } from "@/components/recipes/shared-recipe";

export interface SharedDish {
  role: "Main" | "Side" | "Extra";
  title: string;
  baseServings: number;
  totalMin: number | null;
  instructions: string[];
  ingredients: SharedIngredient[];
}

/**
 * What a stranger holding a day link may see.
 *
 * Narrow on purpose, like `SharedRecipeView`: no cost, status, forecast, or recipe id, so a
 * household-only field cannot reach this component even if a caller hands it a database row.
 */
export interface SharedDayView {
  date: string;
  meals: { mealSlot: string; notes: string | null; dishes: SharedDish[] }[];
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

/** The read-only day behind `/d/{token}`. Like `SharedRecipe`, nothing here links into the app. */
export function SharedDay({ day }: { day: SharedDayView }) {
  const date = new Date(`${day.date}T00:00:00Z`);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-16">
      <p className="text-muted-foreground mb-6 flex items-center gap-2 text-sm">
        <LogoMark height={28} className="rounded-md dark:p-0.5" />
        <Wordmark />
      </p>

      <h1 className="font-display text-3xl font-semibold">{WEEKDAY.format(date)}</h1>

      <p className="text-muted-foreground mt-1 text-sm">{FULL_DATE.format(date)}</p>

      {day.meals.length === 0 ? <p className="mt-8 text-base">Nothing planned</p> : null}

      {day.meals.map((meal) => {
        const label = SLOT_LABELS[meal.mealSlot] ?? meal.mealSlot;

        return (
          <section
            key={meal.mealSlot}
            aria-label={label}
            className="border-border mt-8 border-t pt-6"
          >
            <h2 className="text-xl font-semibold">{label}</h2>

            {meal.notes === null || meal.notes.trim() === "" ? null : (
              <section aria-label="Notes" className="mt-4">
                <h3 className="text-muted-foreground text-xs">Notes</h3>

                <p className="mt-1 text-base whitespace-pre-line">{meal.notes}</p>
              </section>
            )}

            {meal.dishes.length === 0 ? (
              <p className="mt-6 text-base">This meal is planned, but no dishes are chosen yet.</p>
            ) : null}

            {meal.dishes.map((dish, position) => (
              // Keyed by position: a meal can list the same recipe twice.
              <article key={`${position}-${dish.title}`} className="mt-8">
                <h3 className="font-display text-2xl font-semibold">
                  <span className="text-muted-foreground block font-sans text-xs font-normal">
                    {dish.role}
                  </span>
                  {dish.title}
                </h3>

                <p className="text-muted-foreground mt-1 text-sm">
                  Serves {dish.baseServings}
                  {dish.totalMin === null ? null : ` · ${dish.totalMin} min`}
                </p>

                <RecipeSections
                  ingredients={dish.ingredients}
                  instructions={dish.instructions}
                  headingLevel={4}
                />
              </article>
            ))}
          </section>
        );
      })}
    </main>
  );
}

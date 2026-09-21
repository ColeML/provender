import { formatQuantity } from "@/lib/quantity";

export interface SharedIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

/**
 * What a stranger holding a share link may see.
 *
 * Narrower than `CookRecipe` on purpose, and not by accident of what the page happens to pass:
 * there is no cost, no plan, and no recipe id, so a household-specific field cannot reach this
 * component even if a future caller hands it a whole database row.
 */
export interface SharedRecipeView {
  title: string;
  baseServings: number;
  totalMin: number | null;
  sourceUrl: string | null;
  instructions: string[];
  ingredients: SharedIngredient[];
}

interface Props {
  recipe: SharedRecipeView;
}

/**
 * The read-only recipe behind `/r/{token}`.
 *
 * A server component with no interactivity — `CookView` cannot be reused here because its serving
 * stepper calls tRPC to rescale, which answers UNAUTHORIZED to a visitor with no session. Nothing
 * on this page links back into the app: the only route a stranger can reach is this one.
 */
export function SharedRecipe({ recipe }: Props) {
  const time = recipe.totalMin === null ? null : `${recipe.totalMin} min`;

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-3xl font-semibold">{recipe.title}</h1>

      <p className="text-muted-foreground mt-1 text-sm">
        <span>Serves {recipe.baseServings}</span>
        {time === null ? null : <span> · {time}</span>}
        {recipe.sourceUrl === null ? null : (
          <span>
            {" · "}
            <a
              href={recipe.sourceUrl}
              rel="noreferrer noopener"
              target="_blank"
              className="underline"
            >
              source
            </a>
          </span>
        )}
      </p>

      <section aria-labelledby="ingredients" className="mt-8">
        <h2 id="ingredients" className="text-muted-foreground text-xs">
          Ingredients
        </h2>

        <ul aria-label="Ingredients" className="divide-border mt-1 divide-y">
          {recipe.ingredients.map((ingredient) => (
            <li key={ingredient.id} className="flex justify-between gap-4 py-2 text-lg">
              <span>
                {ingredient.name}
                {ingredient.notes === null ? null : (
                  <span className="text-muted-foreground text-sm"> {ingredient.notes}</span>
                )}
              </span>

              <span className="shrink-0 font-mono">
                {formatQuantity(ingredient.quantity, ingredient.unit)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {recipe.instructions.length === 0 ? null : (
        <section aria-labelledby="method" className="mt-8">
          <h2 id="method" className="text-muted-foreground text-xs">
            Method
          </h2>

          <ol aria-labelledby="method" className="mt-2 space-y-5">
            {/* Keyed on position, as in `cook-view`: steps repeat and the list is never reordered. */}
            {recipe.instructions.map((instruction, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden
                  className="text-muted-foreground w-6 shrink-0 pt-0.5 text-right font-mono text-base"
                >
                  {index + 1}
                </span>

                <span className="text-xl leading-snug">{instruction}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

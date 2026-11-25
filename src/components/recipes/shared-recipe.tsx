import { parseStep } from "@server/lib/step-quantities";

import { LogoMark } from "@/components/ui/logo-mark";
import { Wordmark } from "@/components/ui/wordmark";
import { formatQuantity } from "@/lib/quantity";

import { StepText } from "./step-text";

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
  /** Unlike the notes, the dish's own: what anyone cooking it has to start the night before. */
  prepAhead: string[];
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
      {/* Where the recipe came from. Not a link: this page never leads a stranger into the app. */}
      <p className="text-muted-foreground mb-6 flex items-center gap-2 text-sm">
        <LogoMark height={28} className="rounded-md dark:p-0.5" />
        <Wordmark />
      </p>

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

      {recipe.prepAhead.length === 0 ? null : (
        <section aria-label="Prep ahead" className="mt-6">
          <h2 className="text-muted-foreground text-xs">Prep ahead</h2>

          <ul
            aria-label="Prep ahead"
            className="divide-border border-border mt-1 divide-y border-y"
          >
            {/* Keyed on position: the list is never reordered, and two tasks may read the same. */}
            {recipe.prepAhead.map((task, index) => (
              <li key={index} className="py-2.5 text-base break-words whitespace-pre-line">
                {task}
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecipeSections ingredients={recipe.ingredients} instructions={recipe.instructions} />
    </main>
  );
}

/**
 * The ingredients as stored and the numbered steps, shared by `/r` and `/d`.
 *
 * Labeled by `aria-label` rather than heading ids, because `/d` shows several recipes on one page.
 */
export function RecipeSections({
  ingredients,
  instructions,
  headingLevel = 2,
}: {
  ingredients: SharedIngredient[];
  instructions: string[];
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as const;

  return (
    <>
      <section aria-label="Ingredients" className="mt-8">
        <Heading className="text-muted-foreground text-xs">Ingredients</Heading>

        <ul aria-label="Ingredients" className="divide-border mt-1 divide-y">
          {ingredients.map((ingredient) => (
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

      {instructions.length === 0 ? null : (
        <section aria-label="Method" className="mt-8">
          <Heading className="text-muted-foreground text-xs">Method</Heading>

          <ol aria-label="Method" className="mt-2 space-y-5">
            {/* Keyed on position, as in `cook-view`: steps repeat and the list is never reordered. */}
            {instructions.map((instruction, index) => (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden
                  className="text-muted-foreground w-6 shrink-0 pt-0.5 text-right font-mono text-base"
                >
                  {index + 1}
                </span>

                <StepText parts={parseStep(instruction)} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useWakeLock } from "@/hooks/use-wake-lock";
import { formatQuantity } from "@/lib/quantity";
import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export interface CookIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
}

export interface CookRecipe {
  recipeId: string;
  title: string;
  baseServings: number;
  totalMin: number | null;
  sourceUrl: string | null;
  instructions: string[];
  ingredients: CookIngredient[];
}

export function CookView({ recipe }: { recipe: CookRecipe }) {
  const trpc = useTRPC();
  const [servings, setServings] = useState(recipe.baseServings);

  useWakeLock(true);

  const scaled = useQuery({
    ...trpc.recipes.scale.queryOptions({ recipeId: recipe.recipeId, targetServings: servings }),
    enabled: servings !== recipe.baseServings,
  });

  // The stored list until a different count is asked for, so the first paint needs no request.
  const ingredients =
    servings === recipe.baseServings
      ? recipe.ingredients
      : (scaled.data?.ingredients.map((ingredient, index) => ({
          id: `${ingredient.name}-${index}`,
          ...ingredient,
        })) ?? recipe.ingredients);

  // The amounts on screen belong to a different serving count than the one displayed. Saying so
  // matters more here than anywhere else in the app: these are numbers someone measures by.
  const stale = servings !== recipe.baseServings && !scaled.isSuccess;

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-3xl font-semibold">{recipe.title}</h1>

      <p className="text-muted-foreground mt-1 text-sm">
        {recipe.totalMin === null ? null : <>{recipe.totalMin} min · </>}
        {recipe.sourceUrl === null ? null : (
          <a
            href={recipe.sourceUrl}
            rel="noreferrer noopener"
            target="_blank"
            className="underline"
          >
            source
          </a>
        )}
      </p>

      <section aria-labelledby="servings" className="mt-6">
        <h2 id="servings" className="text-muted-foreground text-xs">
          Servings
        </h2>

        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer servings"
            disabled={servings <= 1}
            onClick={() => setServings((current) => Math.max(current - 1, 1))}
            className="border-border size-11 rounded-lg border text-xl disabled:opacity-40"
          >
            −
          </button>

          <span className="w-16 text-center font-mono text-xl">{servings}</span>

          <button
            type="button"
            aria-label="More servings"
            onClick={() => setServings((current) => Math.min(current + 1, 500))}
            className="border-border size-11 rounded-lg border text-xl"
          >
            +
          </button>

          {servings === recipe.baseServings ? null : (
            <button
              type="button"
              onClick={() => setServings(recipe.baseServings)}
              className="text-muted-foreground text-sm underline"
            >
              Reset to {recipe.baseServings}
            </button>
          )}
        </div>

        {scaled.isError ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            Could not scale that. Showing the stored amounts.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="ingredients" className="mt-8">
        <h2 id="ingredients" className="text-muted-foreground text-xs">
          Ingredients
          {stale ? (
            <span className="text-destructive"> — still for {recipe.baseServings}, scaling…</span>
          ) : null}
        </h2>

        <ul
          aria-busy={stale}
          aria-label="Ingredients"
          className={cn("divide-border mt-1 divide-y", stale && "opacity-40")}
        >
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

      {recipe.instructions.length === 0 ? null : (
        <section aria-labelledby="method" className="mt-8">
          <h2 id="method" className="text-muted-foreground text-xs">
            Method
          </h2>

          <ol aria-label="Method" className="mt-2 space-y-5">
            {recipe.instructions.map((instruction, index) => (
              <li key={instruction} className="flex gap-3">
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

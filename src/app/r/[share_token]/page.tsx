import { getSharedRecipe } from "@server/services/shares";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedRecipe } from "@/components/recipes/shared-recipe";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

/**
 * A shared recipe, readable without a session.
 *
 * The token in the path is the whole key, and this page must never accept a recipe id instead —
 * the slugs are words like `ziti`, so that would turn the library into something a stranger could
 * walk by guessing. `getSharedRecipe` is where that rule is enforced.
 */
export const metadata: Metadata = {
  // A share link handed to one person should not turn up in a search result for the household.
  robots: { index: false, follow: false },
};

export default async function Shared({ params }: { params: Promise<{ share_token: string }> }) {
  const { share_token } = await params;
  const shared = await getSharedRecipe(share_token);

  // Revoked, never minted, and recipe-since-deleted are deliberately the same answer: telling
  // them apart would confirm to a guesser that a token was once real.
  if (shared === null) {
    notFound();
  }

  return (
    <SharedRecipe
      recipe={{
        title: shared.recipe.title,
        baseServings: shared.recipe.baseServings,
        totalMin: shared.recipe.totalMin,
        sourceUrl: shared.recipe.sourceUrl,
        instructions: shared.recipe.instructions,
        ingredients: shared.ingredients.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          quantity: ingredient.quantity === null ? null : Number(ingredient.quantity),
          unit: ingredient.unit,
          notes: ingredient.notes,
        })),
      }}
    />
  );
}

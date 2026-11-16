import type { RecipeSummary } from "@server/services/recipes";
import { getSharedDay } from "@server/services/day-shares";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedDay, type SharedDish } from "@/components/plan/shared-day";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

/**
 * A shared day, readable without a session.
 *
 * The token in the path is the whole key, and this page must never accept a date instead, or any
 * household's days could be read by guessing. `getSharedDay` is where that rule is enforced.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function Shared({ params }: { params: Promise<{ share_token: string }> }) {
  const { share_token } = await params;
  const shared = await getSharedDay(share_token);

  // Expired and never minted are deliberately the same answer, so a guesser learns nothing.
  if (shared === null) {
    notFound();
  }

  const dish = (role: SharedDish["role"], summary: RecipeSummary | null): SharedDish[] => {
    const recipe = summary === null ? undefined : shared.recipes[summary.recipeId];

    if (recipe === undefined) {
      return [];
    }

    return [
      {
        role,
        title: recipe.title,
        baseServings: recipe.baseServings,
        totalMin: recipe.totalMin,
        instructions: recipe.instructions,
        ingredients: recipe.ingredients.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          quantity: ingredient.quantity === null ? null : Number(ingredient.quantity),
          unit: ingredient.unit,
          notes: ingredient.notes,
        })),
      },
    ];
  };

  return (
    <SharedDay
      day={{
        date: shared.date,
        meals: shared.slots.map((slot) => ({
          mealSlot: slot.mealSlot,
          notes: slot.notes,
          dishes: [
            ...dish("Main", slot.main),
            ...dish("Side", slot.side),
            ...slot.extras.flatMap((extra) => dish("Extra", extra)),
          ],
        })),
      }}
    />
  );
}

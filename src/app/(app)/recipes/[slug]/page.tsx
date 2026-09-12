import { householdForSession } from "@server/auth/household";
import { getRecipe, listIngredients, RecipeNotFoundError } from "@server/services/recipes";
import { notFound, redirect } from "next/navigation";

import { CookView } from "@/components/recipes/cook-view";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export default async function Recipe({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const { slug } = await params;

  const recipe = await getRecipe(householdId, slug).catch((error: unknown) => {
    if (error instanceof RecipeNotFoundError) {
      return null;
    }

    throw error;
  });

  if (recipe === null) {
    notFound();
  }

  const ingredients = await listIngredients(householdId, slug);

  return (
    <CookView
      recipe={{
        recipeId: recipe.id,
        title: recipe.title,
        baseServings: recipe.baseServings,
        totalMin: recipe.totalMin,
        sourceUrl: recipe.sourceUrl,
        instructions: recipe.instructions,
        ingredients: ingredients.map((ingredient) => ({
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

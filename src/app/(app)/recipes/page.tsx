import { householdForSession } from "@server/auth/household";
import { allRecipes } from "@server/services/recipes";
import { redirect } from "next/navigation";

import { RecipeLibrary } from "@/components/recipes/recipe-library";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Recipes — Provender" };

export default async function Recipes() {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const recipes = await allRecipes(householdForSession(session));

  return (
    <RecipeLibrary
      recipes={recipes.map((recipe) => ({
        recipeId: recipe.id,
        title: recipe.title,
        baseServings: recipe.baseServings,
        totalMin: recipe.totalMin,
        tags: recipe.tags,
      }))}
    />
  );
}

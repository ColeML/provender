"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface LibraryRecipe {
  recipeId: string;
  title: string;
  baseServings: number;
  totalMin: number | null;
  tags: string[];
}

/** Matches on title and tags, so "quick" and "instant pot" both find something. */
function matches(recipe: LibraryRecipe, query: string) {
  const haystack = `${recipe.title} ${recipe.tags.join(" ")}`.toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function RecipeLibrary({ recipes }: { recipes: LibraryRecipe[] }) {
  const [query, setQuery] = useState("");
  const found = useMemo(() => recipes.filter((recipe) => matches(recipe, query)), [recipes, query]);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">Recipes</h1>

      <label className="mt-4 block">
        <span className="sr-only">Search recipes</span>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or tag"
          className="border-border bg-background focus-visible:ring-ring h-11 w-full rounded-lg border px-3 text-base focus-visible:ring-3 focus-visible:outline-none"
        />
      </label>

      <p className="text-muted-foreground mt-2 text-sm">
        {found.length === recipes.length
          ? `${recipes.length} recipes`
          : `${found.length} of ${recipes.length}`}
      </p>

      {found.length === 0 ? (
        <p className="mt-8 text-sm">Nothing matches “{query}”.</p>
      ) : (
        <ul className="divide-border mt-4 divide-y">
          {found.map((recipe) => (
            <li key={recipe.recipeId}>
              <Link
                href={`/recipes/${recipe.recipeId}`}
                className="hover:bg-muted flex min-h-14 items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-base">{recipe.title}</span>

                  {recipe.tags.length === 0 ? null : (
                    <span className="text-muted-foreground block truncate text-xs">
                      {recipe.tags.join(" · ")}
                    </span>
                  )}
                </span>

                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {recipe.baseServings} sv
                  {recipe.totalMin === null ? "" : ` · ${recipe.totalMin}m`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

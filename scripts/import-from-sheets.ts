/**
 * Copy the v1 Google Sheet into the v2 API.
 *
 * Usage:
 *   PROVENDER_API_TOKEN=... pnpm tsx scripts/import-from-sheets.ts [--base-url URL] [--dry-run]
 *
 * Reads through the v1 CLI rather than talking to Google, so there is no Sheets client in this
 * codebase and no second copy of the credential handling. Writes through the API rather than the
 * database, so the import goes through the same validation every other caller does — if the import
 * succeeds, the API genuinely accepts this data.
 *
 * Safe to run repeatedly. Recipes, plans, history, prices and settings are all keyed on their own
 * identity, so a second run corrects rather than duplicates.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  category,
  csv,
  isoWeekFor,
  num,
  steps,
  str,
  V1_ONLY_CONFIG_KEYS,
} from "./sheet-transforms";

const run = promisify(execFile);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baseUrl = valueOf("--base-url") ?? "http://localhost:3000";
const token = process.env.PROVENDER_API_TOKEN;

function valueOf(flag: string) {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

/** Reads a JSON body from the API. */
async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/v1${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} → ${response.status}`);
  }

  return (await response.json()) as T;
}

/** Reads one v1 command's JSON. The CLI writes JSON to stdout for every command. */
async function v1<T>(...command: string[]): Promise<T> {
  const { stdout } = await run("uv", ["run", "--project", "python", "prov", ...command], {
    maxBuffer: 32 * 1024 * 1024,
  });

  return JSON.parse(stdout) as T;
}

/** Thrown for any non-2xx, carrying the status so callers compare a number, not a message. */
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api(method: string, path: string, body?: unknown) {
  if (dryRun) {
    return { status: 200 } as const;
  }

  const response = await fetch(`${baseUrl}/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new ApiError(
      response.status,
      `${method} ${path} → ${response.status}: ${detail.slice(0, 400)}`,
    );
  }

  return { status: response.status } as const;
}

interface V1Recipe {
  recipe_id: string;
  title: string;
  source_url?: string;
  image_url?: string;
  base_servings?: unknown;
  prep_min?: unknown;
  cook_min?: unknown;
  total_min?: unknown;
  cost_estimate?: unknown;
  tags?: string;
  instructions?: string;
}

interface V1Ingredient {
  recipe_id: string;
  name: string;
  qty?: unknown;
  unit?: string;
  category?: string;
  notes?: string;
}

interface V1HistoryRow {
  date: string;
  recipe_id: string;
  title: string;
  meal_slot?: string;
  rating?: unknown;
  notes?: string;
}

interface V1Price {
  ingredient: string;
  unit: string;
  price: unknown;
  store: string;
}

interface V1PlanDay {
  date: string;
  recipe_id?: string;
  servings?: unknown;
  day_prefs?: string;
  side_recipe_id?: string;
  extras_recipe_ids?: string;
  status?: string;
  meal_slot?: string;
}

async function main() {
  if (!token && !dryRun) {
    console.error("PROVENDER_API_TOKEN is required (or pass --dry-run)");
    process.exit(1);
  }

  console.log(`${dryRun ? "Dry run" : `Importing into ${baseUrl}`}\n`);

  const [config, recipes, ingredients, history, prices, plan] = await Promise.all([
    v1<Record<string, unknown>>("config"),
    v1<V1Recipe[]>("recipes"),
    v1<V1Ingredient[]>("ingredients"),
    v1<V1HistoryRow[]>("history"),
    v1<V1Price[]>("prices"),
    v1<V1PlanDay[]>("plan-read"),
  ]);

  const dropped = V1_ONLY_CONFIG_KEYS;
  const values = Object.fromEntries(
    Object.entries(config)
      .filter(([key]) => !dropped.has(key))
      .map(([key, value]) => [key, str(value)]),
  );

  await api("PATCH", "/config", { values });
  console.log(`config: ${Object.keys(values).length} settings (${dropped.size} v1-only dropped)`);

  const byRecipe = new Map<string, V1Ingredient[]>();

  for (const row of ingredients) {
    const list = byRecipe.get(row.recipe_id) ?? [];

    list.push(row);
    byRecipe.set(row.recipe_id, list);
  }

  let imported = 0;

  for (const recipe of recipes) {
    const body = {
      title: str(recipe.title),
      sourceUrl: str(recipe.source_url) || null,
      imageUrl: str(recipe.image_url) || null,
      baseServings: num(recipe.base_servings) ?? 4,
      prepMin: num(recipe.prep_min),
      cookMin: num(recipe.cook_min),
      totalMin: num(recipe.total_min),
      costEstimate: num(recipe.cost_estimate),
      tags: csv(recipe.tags),
      instructions: steps(recipe.instructions),
      ingredients: (byRecipe.get(recipe.recipe_id) ?? []).map((row) => ({
        ingredientName: str(row.name) || "unnamed",
        quantity: num(row.qty),
        unit: str(row.unit) || null,
        category: category(row.category),
        notes: str(row.notes) || null,
      })),
    };

    // Create first; a second run conflicts, and the update path replaces the ingredients too.
    try {
      await api("POST", `/recipes?recipeId=${encodeURIComponent(recipe.recipe_id)}`, body);
    } catch (error) {
      // Numerically, not by searching the message: the message embeds the response body, so a
      // validation failure mentioning 409 anywhere would be mistaken for a conflict.
      if (!(error instanceof ApiError) || error.status !== 409) {
        throw error;
      }

      await api(
        "PATCH",
        `/recipes/${encodeURIComponent(recipe.recipe_id)}?updateMask=${[
          "title",
          "sourceUrl",
          "imageUrl",
          "baseServings",
          "prepMin",
          "cookMin",
          "totalMin",
          "costEstimate",
          "tags",
          "instructions",
          "ingredients",
        ].join(",")}`,
        body,
      );
    }

    imported += 1;
  }

  console.log(`recipes: ${imported}, ingredients: ${ingredients.length}`);

  // The plan's days, grouped by the ISO week they belong to.
  const weeks = new Map<string, V1PlanDay[]>();

  for (const day of plan) {
    // A blank recipe_id is an unplanned day-slot, which v2 represents by having no row at all.
    if (!str(day.recipe_id)) {
      continue;
    }

    const week = isoWeekFor(day.date);
    const days = weeks.get(week) ?? [];

    days.push(day);
    weeks.set(week, days);
  }

  for (const [week, days] of weeks) {
    try {
      await api("POST", `/plans?planId=${week}`, {});
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) {
        throw error;
      }
    }

    for (const day of days) {
      await api(`PUT`, `/plans/${week}/days/${day.date}`, {
        servings: num(day.servings) ?? 4,
        status: str(day.status) || "planned",
        notes: str(day.day_prefs) || null,
        main: str(day.recipe_id),
        side: str(day.side_recipe_id) || null,
        extras: csv(day.extras_recipe_ids),
      });
    }

    console.log(`plan ${week}: ${days.length} days`);
  }

  let historyCount = 0;

  for (const row of history) {
    await api("POST", "/mealHistory", {
      date: row.date,
      recipeId: row.recipe_id,
      title: str(row.title) || row.recipe_id,
      mealSlot: str(row.meal_slot) === "lunch" ? "lunch" : "dinner",
      rating: num(row.rating),
      notes: str(row.notes) || null,
      // Deliberately unlinked: the entry outlives the plan it came from, and linking it would make
      // clearing that day delete a meal the household did eat.
    });

    historyCount += 1;
  }

  console.log(`history: ${historyCount}`);

  for (const price of prices) {
    await api("PUT", "/prices", {
      ingredient: str(price.ingredient),
      unit: str(price.unit) || "ea",
      store: str(price.store) || "unknown",
      price: num(price.price) ?? 0,
    });
  }

  console.log(`prices: ${prices.length}`);

  if (dryRun) {
    console.log("\nDry run: nothing written, nothing to verify.");

    return;
  }

  // Reading back, because everything above only proves what was *sent*. An endpoint that accepts
  // a request and stores less than it was given would otherwise pass silently, and the gap would
  // surface weeks later as a missing ingredient in a shopping list.
  console.log("\nVerifying against the API...");

  const problems: string[] = [];

  async function expect(label: string, actual: number, wanted: number) {
    console.log(`  ${actual === wanted ? "ok" : "MISMATCH"}  ${label}: ${actual}/${wanted}`);

    if (actual !== wanted) {
      problems.push(`${label}: API has ${actual}, the Sheet has ${wanted}`);
    }
  }

  const storedConfig = await apiGet<Record<string, string>>("/config");

  await expect("settings", Object.keys(storedConfig).length, Object.keys(values).length);

  // Paged, because the list caps at 200 and there are 97 today with room to grow.
  const storedRecipes: { recipeId: string }[] = [];
  let pageToken: string | undefined;

  do {
    const page = await apiGet<{ recipes: { recipeId: string }[]; nextPageToken?: string }>(
      `/recipes?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );

    storedRecipes.push(...page.recipes);
    pageToken = page.nextPageToken;
  } while (pageToken);

  await expect("recipes", storedRecipes.length, recipes.length);

  // Every recipe's ingredients, so a silently truncated list cannot hide inside a matching total.
  let storedIngredients = 0;

  for (const recipe of storedRecipes) {
    const { ingredients: rows } = await apiGet<{ ingredients: unknown[] }>(
      `/recipes/${encodeURIComponent(recipe.recipeId)}/ingredients`,
    );

    storedIngredients += rows.length;
  }

  await expect("ingredients", storedIngredients, ingredients.length);

  const storedHistory = await apiGet<{ entries: unknown[] }>("/mealHistory?withinDays=3650");

  await expect("history entries", storedHistory.entries.length, history.length);

  const storedPrices = await apiGet<{ prices: unknown[] }>("/prices");

  await expect("prices", storedPrices.prices.length, prices.length);

  for (const [week, days] of weeks) {
    const stored = await apiGet<{ days: unknown[] }>(`/plans/${week}`);

    await expect(`plan ${week} days`, stored.days.length, days.length);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} mismatch(es):`);

    for (const problem of problems) {
      console.error(`  ${problem}`);
    }

    process.exit(1);
  }

  console.log("\nDone. Everything the Sheet has, the API has.");
}

main().catch((error) => {
  console.error(`\nImport failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

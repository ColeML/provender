import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { resolveNoRepeatDays } from "@server/services/history";
import { eq } from "drizzle-orm";

/**
 * The cookbook, ranked for planning.
 *
 * One function rather than the caller joining recipes against history itself. Repeat-avoidance
 * used to be enforced by the shape of the data: a bare history read returned exactly
 * `no_repeat_days`, so the window never had to be named. Any caller that widens that read
 * silently turns the rule into "never repeat anything", so the window lives here instead.
 *
 * This reports and never enforces. A dish inside its window is still plannable — history records
 * what was planned, not what was eaten, so a skip is a suggestion the household can overrule.
 */
export type RotationTier = "unplanned" | "eligible" | "blocked";

export interface RotationEntry {
  recipeId: string;
  title: string;
  tags: string[];
  totalMin: number | null;
  costEstimate: number | null;
  baseServings: number;
  tier: RotationTier;
  lastPlanned: string | null;
  timesPlanned: number;
  daysUntilEligible: number | null;
  rating: number | null;
}

const TIER_ORDER: Record<RotationTier, number> = { unplanned: 0, eligible: 1, blocked: 2 };

function daysBetween(from: string, to: Date) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.floor((end - start) / 86_400_000);
}

export async function planningRotation(
  householdId: string,
  db: Database = defaultDb,
): Promise<RotationEntry[]> {
  const [recipes, history, noRepeatDays] = await Promise.all([
    db.select().from(schema.recipes).where(eq(schema.recipes.householdId, householdId)),
    db
      .select({
        recipeId: schema.mealHistory.recipeId,
        date: schema.mealHistory.date,
        rating: schema.mealHistory.rating,
      })
      .from(schema.mealHistory)
      .where(eq(schema.mealHistory.householdId, householdId)),
    resolveNoRepeatDays(householdId, db),
  ]);

  // `last` and `ratingDate` track different entries on purpose: lastPlanned is the most recent
  // entry regardless of rating, while rating comes from the most recent *rated* entry.
  const seen = new Map<
    string,
    { last: string; count: number; ratingDate: string | null; rating: number | null }
  >();

  for (const entry of history) {
    if (!entry.recipeId) continue;

    const prior = seen.get(entry.recipeId);
    let ratingDate = prior?.ratingDate ?? null;
    let rating = prior?.rating ?? null;

    if (entry.rating !== null && (ratingDate === null || entry.date > ratingDate)) {
      ratingDate = entry.date;
      rating = entry.rating;
    }

    seen.set(entry.recipeId, {
      last: prior && prior.last > entry.date ? prior.last : entry.date,
      count: (prior?.count ?? 0) + 1,
      ratingDate,
      rating,
    });
  }

  const today = new Date();

  const rows = recipes.map((recipe): RotationEntry => {
    const used = seen.get(recipe.id);
    const base = {
      recipeId: recipe.id,
      title: recipe.title,
      tags: recipe.tags,
      totalMin: recipe.totalMin,
      costEstimate: recipe.costEstimate === null ? null : Number(recipe.costEstimate),
      baseServings: recipe.baseServings,
    };

    if (!used) {
      return {
        ...base,
        tier: "unplanned",
        lastPlanned: null,
        timesPlanned: 0,
        daysUntilEligible: null,
        rating: null,
      };
    }

    const elapsed = daysBetween(used.last, today);
    const blocked = elapsed < noRepeatDays;

    return {
      ...base,
      tier: blocked ? "blocked" : "eligible",
      lastPlanned: used.last,
      timesPlanned: used.count,
      daysUntilEligible: blocked ? noRepeatDays - elapsed : null,
      rating: used.rating,
    };
  });

  return rows.sort((a, b) => {
    if (TIER_ORDER[a.tier] !== TIER_ORDER[b.tier]) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (a.lastPlanned && b.lastPlanned && a.lastPlanned !== b.lastPlanned) {
      return a.lastPlanned < b.lastPlanned ? -1 : 1;
    }

    return a.title.localeCompare(b.title);
  });
}

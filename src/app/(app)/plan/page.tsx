import { householdForSession } from "@server/auth/household";
import { isoWeekFor } from "@server/lib/iso-week";
import { getConfig } from "@server/services/config";
import { currentOrLatestPlan, InvalidPlanIdError, PlanNotFoundError } from "@server/services/plans";
import { listRecipes } from "@server/services/recipes";
import { getForecast } from "@server/services/weather";
import { weekPlan } from "@server/services/week-plan";
import { redirect } from "next/navigation";

import { WeekGrid, type DayForecast } from "@/components/plan/week-grid";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Plan — Provender" };

/**
 * Two adults and two kids eating dinner twice over, as lunches here are leftovers. Used only when
 * `people` is unset, so a swap on an unplanned day still has a servings count to write.
 */
const FALLBACK_SERVINGS = 8;

/** Never fails the page: a forecast is context for the week, not the point of it. */
async function forecastOrNothing(householdId: string): Promise<DayForecast[]> {
  try {
    return (await getForecast(householdId, { days: 16 })).days;
  } catch {
    return [];
  }
}

export default async function Plan({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const householdId = householdForSession(session);
  const { week } = await searchParams;
  const planId = week ?? (await currentOrLatestPlan(householdId))?.id;

  if (planId === undefined) {
    return <NoWeek />;
  }

  const [plan, config, library, forecast] = await Promise.all([
    // `?week=` is user-editable, so a typo is an empty state rather than a 500.
    weekPlan(householdId, planId).catch((error: unknown) => {
      if (error instanceof PlanNotFoundError || error instanceof InvalidPlanIdError) {
        return null;
      }

      throw error;
    }),
    getConfig(householdId),
    listRecipes(householdId, { pageSize: 200 }),
    forecastOrNothing(householdId),
  ]);

  if (plan === null) {
    return <NoWeek planId={planId} />;
  }

  const people = Number(config.people);

  return (
    <WeekGrid
      week={plan}
      recipes={library.recipes.map((recipe) => ({
        recipeId: recipe.id,
        title: recipe.title,
      }))}
      forecast={forecast}
      defaultServings={Number.isFinite(people) && people > 0 ? people * 2 : FALLBACK_SERVINGS}
    />
  );
}

function NoWeek({ planId }: { planId?: string } = {}) {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">
        {planId ?? isoWeekFor(new Date().toISOString().slice(0, 10))}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        This week is not planned yet. Ask Claude Code to plan it — the grid edits a week that
        exists, and choosing a menu is the agent&rsquo;s job.
      </p>
    </main>
  );
}

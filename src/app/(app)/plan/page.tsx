import { householdForSession } from "@server/auth/household";
import { isoWeekFor, parseIsoWeek } from "@server/lib/iso-week";
import { getConfig } from "@server/services/config";
import { currentOrLatestPlan, InvalidPlanIdError, PlanNotFoundError } from "@server/services/plans";
import { listRecipes } from "@server/services/recipes";
import { getForecast } from "@server/services/weather";
import { weekPlan } from "@server/services/week-plan";
import { redirect } from "next/navigation";

import { WeekGrid, type DayForecast } from "@/components/plan/week-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { WeekNav } from "@/components/ui/week-nav";
import { loginUrl } from "@/lib/login-url";

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
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const { week } = await searchParams;
  const currentPlanId = isoWeekFor(new Date().toISOString().slice(0, 10));
  // `?week=` is user-editable, so a typo falls back to the default view rather than stranding the
  // reader on a week the nav cannot step out of.
  const asked = week !== undefined && parseIsoWeek(week) !== undefined ? week : undefined;
  const planId = asked ?? (await currentOrLatestPlan(householdId))?.id ?? currentPlanId;

  const [plan, config, library, forecast] = await Promise.all([
    // An unplanned week is an empty state, not a 500. `planId` is a valid ISO week by here, so
    // `InvalidPlanIdError` can only fire if that stops being true.
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
    return <NoWeek planId={planId} atDefault={asked === undefined} />;
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
      atDefault={asked === undefined}
    />
  );
}

function NoWeek({ planId, atDefault }: { planId: string; atDefault: boolean }) {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold">{planId}</h1>
        <WeekNav basePath="/plan" planId={planId} atDefault={atDefault} showWeek={false} />
      </div>
      <EmptyState hint="Ask Claude Code to plan it — the grid edits a week that exists, and choosing a menu is the agent’s job.">
        That week is not planned yet.
      </EmptyState>
    </main>
  );
}

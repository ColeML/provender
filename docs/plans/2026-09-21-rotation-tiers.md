# Planning Rotation Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /planning/rotation`, a read-only view sorting every recipe into `unplanned`, `eligible` or `blocked`, so `plan-week` stops re-picking a dish the week it turns 30 days old.

**Architecture:** A new service `server/services/planning.ts` joins `recipes` against `mealHistory` to compute a tier per recipe. A thin route exposes it. The `plan-week` skill reads it in place of separate recipe and history calls, so no skill prose performs date or set arithmetic over history — the failure mode behind three prior regressions.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM, Postgres (Neon), Hono + `@hono/zod-openapi`, Vitest.

**Spec:** `docs/specs/2026-09-21-rotation-design.md`

## Global Constraints

- All logic lives in `server/services/*`; routes and Server Components are thin callers (AGENTS.md).
- Every service function takes `householdId` as its first parameter and filters on it. A missing filter returns every household's rows and looks normal in review.
- Every service function takes `db: Database = defaultDb` as its last parameter so tests can pass a stub.
- The endpoint reports only. Nothing may block a plan write on `tier`.
- `numeric` columns come back as strings from Drizzle; convert with `Number(...)` at the service boundary, as `server/services/recipes.ts:274` does.
- Comments: default to none. Only a non-obvious *why* earns one, one or two lines (CLAUDE.md).
- American English spelling in all prose and comments.

---

### Task 1: The rotation service

**Files:**
- Create: `server/services/planning.ts`
- Create: `server/services/planning.test.ts`
- Modify: `server/services/history.ts` — export the existing private `resolveNoRepeatDays` (around line 146)

**Interfaces:**
- Consumes: `resolveNoRepeatDays(householdId, db)` from `@server/services/history`; `schema.recipes`, `schema.mealHistory` from `@server/db/schema`.
- Produces: `planningRotation(householdId: string, db?: Database): Promise<RotationEntry[]>`, plus exported types `RotationTier = "unplanned" | "eligible" | "blocked"` and `RotationEntry`.

- [ ] **Step 1: Export the no-repeat helper**

In `server/services/history.ts`, change the declaration from `async function resolveNoRepeatDays(` to:

```ts
export async function resolveNoRepeatDays(householdId: string, db: Database) {
```

Leave the body and the `DEFAULT_NO_REPEAT_DAYS` constant untouched.

- [ ] **Step 2: Write the failing tests**

Create `server/services/planning.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { createRecipe } from "@server/services/recipes";
import { recordMeal } from "@server/services/history";

import { planningRotation } from "./planning";

const H = "loewer";
const OTHER = "other-household";

let db: Database;
let close: () => Promise<void>;

/** A date `days` ago, so tests do not depend on the calendar. */
function daysAgo(days: number) {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - days);

  return date.toISOString().slice(0, 10);
}

async function recipe(householdId: string, id: string, title: string) {
  await createRecipe(householdId, id, { title, baseServings: 4, totalMin: 30 }, [], db);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "no_repeat_days", "30", db);
});

afterEach(async () => {
  await close();
});

async function tierOf(recipeId: string) {
  const rows = await planningRotation(H, db);

  return rows.find((row) => row.recipeId === recipeId);
}

describe("planningRotation", () => {
  it("puts a recipe with no history in the unplanned tier", async () => {
    await recipe(H, "ziti", "Baked Ziti");

    expect(await tierOf("ziti")).toMatchObject({
      tier: "unplanned",
      lastPlanned: null,
      timesPlanned: 0,
      daysUntilEligible: null,
    });
  });

  it("treats a dish planned exactly no_repeat_days ago as eligible", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(30), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({
      tier: "eligible",
      lastPlanned: daysAgo(30),
      timesPlanned: 1,
      daysUntilEligible: null,
    });
  });

  it("blocks a dish planned one day inside the window, and says when it frees up", async () => {
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recordMeal(H, { date: daysAgo(29), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    expect(await tierOf("pizza")).toMatchObject({
      tier: "blocked",
      lastPlanned: daysAgo(29),
      daysUntilEligible: 1,
    });
  });

  it("counts every planning of a dish and reports the most recent", async () => {
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recordMeal(H, { date: daysAgo(90), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);
    await recordMeal(H, { date: daysAgo(45), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    expect(await tierOf("pizza")).toMatchObject({
      tier: "eligible",
      lastPlanned: daysAgo(45),
      timesPlanned: 2,
    });
  });

  it("counts a breakfast or lunch entry, not just dinner", async () => {
    await recipe(H, "pancakes", "Buttermilk Pancakes");
    await recordMeal(
      H,
      { date: daysAgo(5), recipeId: "pancakes", title: "Buttermilk Pancakes", mealSlot: "breakfast" },
      db,
    );

    expect(await tierOf("pancakes")).toMatchObject({ tier: "blocked", lastPlanned: daysAgo(5) });
  });

  it("ignores a history entry naming a recipe that no longer exists", async () => {
    await recipe(H, "ziti", "Baked Ziti");
    await recordMeal(H, { date: daysAgo(1), recipeId: "deleted-dish", title: "Gone" }, db);

    const rows = await planningRotation(H, db);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipeId: "ziti", tier: "unplanned" });
  });

  it("orders unplanned first, then eligible oldest-first, then blocked", async () => {
    await recipe(H, "ziti", "Baked Ziti");
    await recipe(H, "tacos", "Tacos");
    await recipe(H, "pizza", "Sheet Pan Pizza");
    await recipe(H, "chili", "Chili");
    await recordMeal(H, { date: daysAgo(31), recipeId: "tacos", title: "Tacos" }, db);
    await recordMeal(H, { date: daysAgo(90), recipeId: "chili", title: "Chili" }, db);
    await recordMeal(H, { date: daysAgo(2), recipeId: "pizza", title: "Sheet Pan Pizza" }, db);

    const rows = await planningRotation(H, db);

    expect(rows.map((row) => row.recipeId)).toEqual(["ziti", "chili", "tacos", "pizza"]);
  });

  it("carries the fields a planner needs, so it needs no second catalog call", async () => {
    await createRecipe(
      H,
      "ziti",
      { title: "Baked Ziti", baseServings: 8, totalMin: 65, costEstimate: 16.84, tags: ["italian"] },
      [],
      db,
    );

    expect(await tierOf("ziti")).toMatchObject({
      title: "Baked Ziti",
      tags: ["italian"],
      totalMin: 65,
      costEstimate: 16.84,
    });
  });

  it("will not let another household's history change this household's tiers", async () => {
    await recipe(H, "tacos", "Tacos");
    await recipe(OTHER, "tacos", "Tacos");
    await recordMeal(OTHER, { date: daysAgo(1), recipeId: "tacos", title: "Tacos" }, db);

    expect(await tierOf("tacos")).toMatchObject({ tier: "unplanned", timesPlanned: 0 });
  });

  it("will not return another household's recipes", async () => {
    await recipe(OTHER, "ziti", "Baked Ziti");

    expect(await planningRotation(H, db)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run server/services/planning.test.ts`
Expected: FAIL — cannot resolve `./planning`.

- [ ] **Step 4: Write the service**

Create `server/services/planning.ts`:

```ts
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
  tier: RotationTier;
  lastPlanned: string | null;
  timesPlanned: number;
  daysUntilEligible: number | null;
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
      .select({ recipeId: schema.mealHistory.recipeId, date: schema.mealHistory.date })
      .from(schema.mealHistory)
      .where(eq(schema.mealHistory.householdId, householdId)),
    resolveNoRepeatDays(householdId, db),
  ]);

  const seen = new Map<string, { last: string; count: number }>();

  for (const entry of history) {
    if (!entry.recipeId) continue;

    const prior = seen.get(entry.recipeId);

    seen.set(entry.recipeId, {
      last: prior && prior.last > entry.date ? prior.last : entry.date,
      count: (prior?.count ?? 0) + 1,
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
    };

    if (!used) {
      return { ...base, tier: "unplanned", lastPlanned: null, timesPlanned: 0, daysUntilEligible: null };
    }

    const elapsed = daysBetween(used.last, today);
    const blocked = elapsed < noRepeatDays;

    return {
      ...base,
      tier: blocked ? "blocked" : "eligible",
      lastPlanned: used.last,
      timesPlanned: used.count,
      daysUntilEligible: blocked ? noRepeatDays - elapsed : null,
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run server/services/planning.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Lint, format and typecheck**

Run: `pnpm lint && pnpm fmt:check && pnpm typecheck`
Expected: all clean. If `fmt:check` complains, run `pnpm fmt` and re-check.

- [ ] **Step 7: Commit**

```bash
git add server/services/planning.ts server/services/planning.test.ts server/services/history.ts
git commit -m "feat(planning): tier the cookbook into unplanned, eligible and blocked

Repeat-avoidance was enforced by the shape of the data rather than by a
rule: a bare history read returns exactly no_repeat_days, so the window
never had to be named. That makes any caller who widens the read turn the
rule into never-repeat-anything. planningRotation owns the window instead
and reports a tier per recipe."
```

---

### Task 2: The endpoint

**Files:**
- Create: `server/api/routes/planning.ts`
- Create: `server/api/routes/planning.test.ts`
- Modify: `server/api/app.ts` — add the import beside the others (around line 2-9) and the mount beside the others (around line 128-135)

**Interfaces:**
- Consumes: `planningRotation`, `RotationEntry` from `@server/services/planning`.
- Produces: `planningRoutes`, an `OpenAPIHono<ApiEnv>` serving `GET /planning/rotation`.

- [ ] **Step 1: Write the failing test**

Create `server/api/routes/planning.test.ts`. The `vi.mock` getter below is load-bearing: the app module is imported once, but each service call re-reads `db`, so every test gets the database made in its own `beforeEach`. This mirrors `server/api/routes/recipes.test.ts`.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";

let testDb: Database;

vi.mock("@server/db", async () => {
  const actual = await vi.importActual<typeof import("@server/db")>("@server/db");

  return {
    ...actual,
    get db() {
      return testDb;
    },
  };
});

const { api } = await import("@server/api/app");

const authed = { Authorization: "Bearer test-token" };

function get(path: string, headers: Record<string, string> = authed) {
  return api.request(path, { method: "GET", headers });
}

function post(path: string, body: unknown) {
  return api.request(path, {
    method: "POST",
    headers: { ...authed, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  ({ db: testDb } = await createTestDb());
});

describe("GET /v1/planning/rotation", () => {
  it("returns every recipe with a tier", async () => {
    await post("/v1/recipes?recipeId=ziti", {
      title: "Baked Ziti",
      baseServings: 8,
      totalMin: 65,
      tags: ["italian"],
      ingredients: [],
    });

    const response = await get("/v1/planning/rotation");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipes: [
        {
          name: "recipes/ziti",
          recipeId: "ziti",
          title: "Baked Ziti",
          tier: "unplanned",
          lastPlanned: null,
          timesPlanned: 0,
          daysUntilEligible: null,
        },
      ],
    });
  });

  it("refuses an unauthenticated request", async () => {
    const response = await get("/v1/planning/rotation", {});

    expect(response.status).toBe(401);
  });
});
```

Creating the recipe through the API rather than the service keeps the household implicit in the bearer token, which is how the rest of this file works.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/api/routes/planning.test.ts`
Expected: FAIL — 404, the path is not mounted.

- [ ] **Step 3: Write the route**

Create `server/api/routes/planning.ts`:

```ts
import type { ApiEnv } from "@server/api/middleware/bearer";
import { planningRotation, type RotationEntry } from "@server/services/planning";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

function toResource(entry: RotationEntry) {
  return {
    name: `recipes/${entry.recipeId}`,
    recipeId: entry.recipeId,
    title: entry.title,
    tags: entry.tags,
    totalMin: entry.totalMin,
    costEstimate: entry.costEstimate,
    tier: entry.tier,
    lastPlanned: entry.lastPlanned,
    timesPlanned: entry.timesPlanned,
    daysUntilEligible: entry.daysUntilEligible,
  };
}

const RotationEntrySchema = z
  .object({
    name: z.string().openapi({ example: "recipes/baked-ziti" }),
    recipeId: z.string(),
    title: z.string(),
    tags: z.array(z.string()),
    totalMin: z.number().int().nullable(),
    costEstimate: z.number().nullable(),
    tier: z.enum(["unplanned", "eligible", "blocked"]),
    lastPlanned: z.string().nullable().openapi({ example: "2026-08-31" }),
    timesPlanned: z.number().int(),
    daysUntilEligible: z.number().int().nullable(),
  })
  .openapi("RotationEntry");

export const planningRoutes = new OpenAPIHono<ApiEnv>().openapi(
  createRoute({
    method: "get",
    path: "/planning/rotation",
    summary: "The cookbook ranked for planning",
    description:
      "Every recipe, tiered. `unplanned` has never been planned, `eligible` is outside " +
      "`no_repeat_days`, `blocked` is inside it and carries `daysUntilEligible`. Rows are sorted " +
      "for readability but `tier` is the contract — position within a tier means nothing. " +
      "This reports only: a blocked dish is still plannable on request.",
    responses: {
      200: {
        description: "The ranked cookbook",
        content: {
          "application/json": {
            schema: z.object({ recipes: z.array(RotationEntrySchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const rows = await planningRotation(c.get("householdId"));

    return c.json({ recipes: rows.map(toResource) }, 200);
  },
);
```

- [ ] **Step 4: Mount it**

In `server/api/app.ts`, add beside the other route imports:

```ts
import { planningRoutes } from "@server/api/routes/planning";
```

and beside the other mounts:

```ts
api.route("/", planningRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run server/api/routes/planning.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Confirm it reaches the generated spec**

Run: `pnpm vitest run && pnpm lint && pnpm typecheck && pnpm build`
Expected: all pass. `pnpm build` catches prerender failures the other commands miss.

- [ ] **Step 7: Commit**

```bash
git add server/api/routes/planning.ts server/api/routes/planning.test.ts server/api/app.ts
git commit -m "feat(api): serve the ranked cookbook at GET /planning/rotation"
```

---

### Task 3: Point plan-week at it

**Files:**
- Modify: `.claude/skills/plan-week/SKILL.md`

**Interfaces:**
- Consumes: `GET /planning/rotation` from Task 2.
- Produces: nothing code-level.

- [ ] **Step 1: Replace the step 1 reads**

In the step 1 bash block, drop the `./scripts/prov GET /mealHistory` line and replace the recipe listing so the block reads:

```bash
./scripts/prov GET /config
./scripts/prov GET /weather
./scripts/prov GET /planning/rotation
```

- [ ] **Step 2: Explain what the tiers mean**

Immediately after that block's surrounding prose, add:

```markdown
`rotation` is every recipe, tiered. `unplanned` has never been planned, `eligible` is outside
`no_repeat_days`, `blocked` is inside it and says when it frees up. The tier is the answer — do
not recompute it from dates.
```

- [ ] **Step 3: Rewrite the selection rules**

Replace rule 6 and the novelty quota (rule 7) with:

```markdown
6. **Repeat-avoidance, mains only.** Do not plan a `blocked` main. Offer them as a list the
   household can pull from — history records what was *planned*, not what was eaten. Sides may
   repeat freely.
7. **Novelty quota.** Plan `new_mains_per_week` mains from the `unplanned` tier. Absent that key,
   it is a third of the week's mains, rounded up — 2 of 5, 3 of 7. A saved `unplanned` recipe
   counts: work through the household's own unused dishes before scraping, and scrape only when
   that tier runs dry or they ask for something off the web.
8. **Rotation for the rest.** Fill the remaining slots from `eligible`, oldest `lastPlanned`
   first. Within a tier, order carries no meaning — choose on weather, time and overlap.
```

Renumber the rules that follow so ratings and ingredient overlap become 9 and 10.

- [ ] **Step 4: Drop the stale catalog read in step 3**

In "Source the recipes", remove the `./scripts/prov GET '/recipes?pageSize=200'` call and any prose telling the agent to read the catalog — step 1 now carries it. Keep the source rotation table and the scraping instructions unchanged.

- [ ] **Step 5: Verify no date arithmetic survives**

Run: `grep -nE "withinDays|mealHistory\?|pageSize=200|days ago|no_repeat_days" .claude/skills/plan-week/SKILL.md`
Expected: the only `no_repeat_days` hits are the config key list and the tier explanation. No `withinDays`, no `pageSize=200`.

- [ ] **Step 6: Verify the skill still plans a sensible week**

Build a fixture the way #147 did: a prompt file carrying the household config, a weather forecast, the `GET /planning/rotation` response for the live household, and the rewritten step 2, then dispatch 5 subagents that each return their five mains labeled with the tier they came from.

Expected across 5 reps: every rep meets the novelty quota from `unplanned`, and no rep plans a `blocked` main. If a rep plans a `blocked` main, the rule is not binding — fix the wording, do not accept the run.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/plan-week/SKILL.md
git commit -m "feat(plan-week): plan from rotation tiers instead of raw history

The skill read recipes and history separately and did its own window
arithmetic, which is what regressed three times. It now reads one tiered
view and never sees a history window. The novelty quota counts the
household's own unused recipes, so the 46 dishes carried over from the v1
Sheet get used before anything is scraped."
```

---

### Task 4: Close the issue

- [ ] **Step 1: Open the pull request**

```bash
git push -u origin feat/rotation-tiers
gh pr create --base main --title "feat(planning): rank the cookbook into rotation tiers" --body "Closes the rotation half of #149. Spec in docs/specs/2026-09-21-rotation-design.md."
```

- [ ] **Step 2: Open the follow-up issue for sides**

Sides repeat far more than mains — across the three surviving weeks of plans, mains were 20 distinct over 20 slots while sides were 14 over 18, with `simple-green-salad` in all three. They cannot be rotated yet because `mealHistory` records mains only, so sides have no durable log. File an issue proposing that every role be recorded in history, noting it amends a stated AGENTS.md invariant.


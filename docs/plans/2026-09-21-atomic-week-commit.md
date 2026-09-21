# Atomic Week Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /plans/{plan}:commit`, which writes an approved week's new recipes, plan, days and history entries in one transaction, and move `plan-week`'s scraping into draft files held until the approval gate.

**Architecture:** Three transaction steps are extracted from existing services into functions that take `db: Queryable` and open no transaction of their own, following the pattern `detachHistoryFromDay` already establishes. A new service `server/services/week-commit.ts` composes them inside a single `db.transaction`, so the forced write order (plan → recipes → days → history) lives in tested code instead of skill prose. `add-recipe` splits at the write boundary into a draft half and a save half; `plan-week` uses only the draft half and sends one commit call after approval.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM, Postgres (Neon; PGlite in tests), Hono + `@hono/zod-openapi`, Vitest.

**Spec:** `docs/specs/2026-09-21-approval-gate-design.md`

## Global Constraints

- All logic lives in `server/services/*`; routes and Server Components are thin callers (AGENTS.md).
- Every service function takes `householdId` as its first parameter and filters on it. A missing filter returns every household's rows and looks normal in review.
- Every service function takes the database as its last parameter with a default: `db: Database = defaultDb`, or `db: Queryable = defaultDb` when it may run inside a caller's transaction.
- A function that takes `Queryable` must not open a transaction of its own. No nested transactions anywhere in this plan.
- `numeric` columns come back as strings from Drizzle; convert with `Number(...)` at the service boundary.
- Comments: default to none. Only a non-obvious *why* earns one, one or two lines (CLAUDE.md).
- American English spelling in all prose and comments.
- Conventional commits. Branch is `feat/commit-week`, already created.
- Before pushing: `pnpm lint`, `pnpm fmt:check`, `pnpm typecheck`, `pnpm vitest run`, `pnpm build`. `docker compose up -d` first if the database is not running.
- The API service interface uses `IngredientInput.name`; the HTTP schema uses `ingredientName`. The mapping between them is the route's job.

---

### Task 1: Widen shared reads and extract the transaction steps

A refactor with one addition. Existing tests are the gate: none of them may change, because none of this task changes behavior for any current caller. The addition is `upsertPlan`, which `createPlan` cannot become without losing its 409.

**Files:**
- Modify: `server/services/config.ts` — `getConfig` signature
- Modify: `server/services/history.ts` — `recordMeal` signature
- Modify: `server/services/recipes.ts` — `recipesByIds` signature; extract `insertRecipe` from `createRecipe` (around line 288)
- Modify: `server/services/plans.ts` — extract `prepareDay` and `writePlanDay` from `setPlanDay` (around line 326); add `upsertPlan` and `resolveBudgetTarget`; refactor `createPlan` onto the latter (around line 263)
- Test: `server/services/plans.test.ts` — new `upsertPlan` cases

**Interfaces:**
- Produces, all importable by Task 2:
  - `getConfig(householdId: string, db?: Queryable): Promise<Config>` — widened
  - `recordMeal(householdId: string, input: MealHistoryInput, db?: Queryable): Promise<MealHistoryEntry>` — widened
  - `recipesByIds(householdId: string, ids: string[], db?: Queryable): Promise<Map<string, RecipeSummary>>` — widened
  - `insertRecipe(householdId: string, recipeId: string, input: RecipeInput, ingredients?: IngredientInput[], db?: Queryable)` — throws `RecipeExistsError`
  - `prepareDay(householdId: string, planId: string, date: string, mealSlot: MealSlot, input: PlanDayInput): PreparedDay` — synchronous; throws `InvalidDateError`, `DateOutsidePlanError`, `InvalidPlanIdError`, `DuplicateRecipeError`
  - `writePlanDay(householdId: string, planId: string, prepared: PreparedDay, db?: Queryable): Promise<PlanDayWithRecipes>` — throws `PlanNotFoundError`
  - `upsertPlan(householdId: string, planId: string, budgetTarget: number | null | undefined, db?: Queryable): Promise<Plan>`
  - `export interface PreparedDay { date: string; mealSlot: MealSlot; input: PlanDayInput; rows: (typeof schema.planDayRecipes.$inferInsert)[] }`

- [ ] **Step 1: Widen the three read signatures**

In `server/services/config.ts`, add `Queryable` to the existing import and change `getConfig` only:

```ts
import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";

export async function getConfig(householdId: string, db: Queryable = defaultDb): Promise<Config> {
```

Leave `setConfigValue` on `Database`. Nothing in this plan calls it inside a transaction.

In `server/services/history.ts`, change `recordMeal`'s last parameter (around line 47) from `db: Database = defaultDb` to `db: Queryable = defaultDb`. `Queryable` is already imported there. `recordMeal` opens no transaction today, so its body needs no change.

In `server/services/recipes.ts`, add `type Queryable` to the `@server/db` import and change `recipesByIds`'s last parameter (around line 249) to `db: Queryable = defaultDb`.

- [ ] **Step 2: Run the suite to confirm the widening changed nothing**

Run: `pnpm vitest run`
Expected: PASS, every test, unchanged. A failure here means a signature was widened that also had its body edited — revert and redo Step 1 as signatures only.

- [ ] **Step 3: Extract `insertRecipe`**

In `server/services/recipes.ts`, replace `createRecipe` (starting around line 288, keeping the existing doc comment above it) with:

```ts
/**
 * Create a recipe, optionally with its ingredients, in one transaction.
 *
 * Ingredients are accepted inline rather than requiring a POST per ingredient: saving a scraped
 * recipe is otherwise seventeen calls, and a failure halfway leaves a recipe with half its
 * ingredients. The sub-collection still exists for editing one later.
 */
export async function createRecipe(
  householdId: string,
  recipeId: string,
  input: RecipeInput,
  ingredients: IngredientInput[] = [],
  db: Database = defaultDb,
) {
  return db.transaction((tx) => insertRecipe(householdId, recipeId, input, ingredients, tx));
}

/** The write itself, so a caller committing a whole week can run it in its own transaction. */
export async function insertRecipe(
  householdId: string,
  recipeId: string,
  input: RecipeInput,
  ingredients: IngredientInput[] = [],
  db: Queryable = defaultDb,
) {
  // Insert-then-check rather than check-then-insert: a SELECT followed by an INSERT lets two
  // concurrent callers both find nothing and both insert, so the loser fails on the primary key
  // with an error this function does not recognise and the caller sees 500 instead of 409.
  const [recipe] = await db
    .insert(schema.recipes)
    .values({
      householdId,
      id: recipeId,
      title: input.title,
      sourceUrl: input.sourceUrl ?? null,
      imageUrl: input.imageUrl ?? null,
      baseServings: input.baseServings,
      prepMin: input.prepMin ?? null,
      cookMin: input.cookMin ?? null,
      totalMin: input.totalMin ?? null,
      costEstimate:
        input.costEstimate === null || input.costEstimate === undefined
          ? null
          : String(input.costEstimate),
      tags: input.tags ?? [],
      instructions: input.instructions ?? [],
    })
    .onConflictDoNothing({ target: [schema.recipes.householdId, schema.recipes.id] })
    .returning();

  if (!recipe) {
    throw new RecipeExistsError(recipeId);
  }

  if (ingredients.length > 0) {
    await db.insert(schema.ingredients).values(ingredientRows(householdId, recipeId, ingredients));
  }

  return recipe;
}
```

- [ ] **Step 4: Extract `prepareDay` and `writePlanDay`**

In `server/services/plans.ts`, add `type Queryable` to the `@server/db` import. Then replace `setPlanDay` (starting around line 326, keeping the existing doc comment) with:

```ts
/** A validated day and the recipe rows it will write. */
export interface PreparedDay {
  date: string;
  mealSlot: MealSlot;
  input: PlanDayInput;
  rows: (typeof schema.planDayRecipes.$inferInsert)[];
}

/**
 * Validate a day and build its recipe rows, touching no database.
 *
 * Separate from the write so a rejected request never takes a write lock first, and so a caller
 * writing several days can reject a bad one before any of them are written.
 */
export function prepareDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  input: PlanDayInput,
): PreparedDay {
  assertDateInPlan(planId, date);

  return { date, mealSlot, input, rows: recipeRows(householdId, planId, date, mealSlot, input) };
}

/**
 * Write one day and everything on it, replacing whatever was there.
 *
 * A day is edited as a whole — its main, side and extras change together — so this replaces the
 * recipe rows rather than reconciling them. All of it is one transaction: a day left with its old
 * main and its new side is worse than a failed request.
 */
export async function setPlanDay(
  householdId: string,
  planId: string,
  date: string,
  mealSlot: MealSlot,
  input: PlanDayInput,
  db: Database = defaultDb,
) {
  const prepared = prepareDay(householdId, planId, date, mealSlot, input);

  return db.transaction((tx) => writePlanDay(householdId, planId, prepared, tx));
}

/** The write itself, so a caller committing a whole week can run it in its own transaction. */
export async function writePlanDay(
  householdId: string,
  planId: string,
  prepared: PreparedDay,
  db: Queryable = defaultDb,
): Promise<PlanDayWithRecipes> {
  const { date, mealSlot, input, rows } = prepared;

  const [plan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(and(eq(schema.plans.householdId, householdId), eq(schema.plans.id, planId)));

  if (!plan) {
    throw new PlanNotFoundError(planId);
  }

  const [day] = await db
    .insert(schema.planDays)
    .values({
      householdId,
      planId,
      date,
      mealSlot,
      servings: input.servings,
      status: input.status ?? "planned",
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.planDays.householdId,
        schema.planDays.planId,
        schema.planDays.date,
        schema.planDays.mealSlot,
      ],
      set: {
        servings: input.servings,
        status: input.status ?? "planned",
        notes: input.notes ?? null,
        // The database's clock, matching the column defaults — see the same note in
        // `recipes.ts`. Mixing in the Node process's clock lets skew produce an updateTime
        // earlier than the row's own createTime.
        updateTime: sql`now()`,
      },
    })
    .returning();

  const dayMatch = and(
    eq(schema.planDayRecipes.householdId, householdId),
    eq(schema.planDayRecipes.planId, planId),
    eq(schema.planDayRecipes.date, date),
    eq(schema.planDayRecipes.mealSlot, mealSlot),
  );

  await db.delete(schema.planDayRecipes).where(dayMatch);

  if (rows.length > 0) {
    await db.insert(schema.planDayRecipes).values(rows);
  }

  return { ...day, ...groupRecipes(rows) };
}
```

- [ ] **Step 5: Run the suite to confirm both extractions are behavior-neutral**

Run: `pnpm vitest run`
Expected: PASS, every test, unchanged.

- [ ] **Step 6: Write the failing `upsertPlan` tests**

Append to `server/services/plans.test.ts`, matching the file's existing imports and `beforeEach`:

```ts
describe("upsertPlan", () => {
  it("creates the week with the configured default budget", async () => {
    const plan = await upsertPlan("loewer", "2026-W36", undefined, db);

    expect(plan).toMatchObject({ id: "2026-W36", budgetTarget: "120.00" });
  });

  it("stores the caller's budget over the configured default", async () => {
    const plan = await upsertPlan("loewer", "2026-W36", 95, db);

    expect(plan.budgetTarget).toBe("95.00");
  });

  it("returns the existing week instead of raising, unlike createPlan", async () => {
    await upsertPlan("loewer", "2026-W36", 95, db);

    const again = await upsertPlan("loewer", "2026-W36", undefined, db);

    expect(again.id).toBe("2026-W36");
  });

  it("leaves the stored budget alone when the caller names none", async () => {
    await upsertPlan("loewer", "2026-W36", 95, db);
    await upsertPlan("loewer", "2026-W36", undefined, db);

    expect((await upsertPlan("loewer", "2026-W36", undefined, db)).budgetTarget).toBe("95.00");
  });

  it("replaces the stored budget when the caller names one", async () => {
    await upsertPlan("loewer", "2026-W36", 95, db);

    expect((await upsertPlan("loewer", "2026-W36", 140, db)).budgetTarget).toBe("140.00");
  });

  it("rejects an id that is not an ISO week", async () => {
    await expect(upsertPlan("loewer", "not-a-week", undefined, db)).rejects.toThrow(
      InvalidPlanIdError,
    );
  });
});
```

If `plans.test.ts` does not already set `default_budget` to `120` in its `beforeEach`, add
`await setConfigValue("loewer", "default_budget", "120", db);` there and import `setConfigValue`
from `@server/services/config`. Add `upsertPlan` and `InvalidPlanIdError` to the existing
`@server/services/plans` import. Check the household id the file already uses and match it rather
than introducing `"loewer"` if it differs.

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `pnpm vitest run server/services/plans.test.ts -t upsertPlan`
Expected: FAIL — `upsertPlan is not a function`.

- [ ] **Step 8: Add `upsertPlan` and share the budget fallback**

In `server/services/plans.ts`, add above `createPlan`:

```ts
/**
 * `null` and `undefined` both mean "use the household default" on a create. They differ only on a
 * conflict, which is `upsertPlan`'s business, not this function's.
 */
async function resolveBudgetTarget(
  householdId: string,
  budgetTarget: number | null | undefined,
  db: Queryable,
) {
  const fallback = budgetTarget ?? Number((await getConfig(householdId, db)).default_budget);

  return Number.isFinite(fallback) ? String(fallback) : null;
}
```

Replace `createPlan`'s body so it uses the helper, keeping its `onConflictDoNothing` and its throw:

```ts
export async function createPlan(
  householdId: string,
  planId: string,
  budgetTarget?: number | null,
  db: Database = defaultDb,
) {
  requireIsoWeek(planId);

  // Falls back to the household's configured default so a plan always has something to show a
  // running total against, and stores it so editing the default later does not move the target of
  // a week already planned.
  const resolved = await resolveBudgetTarget(householdId, budgetTarget, db);

  const [plan] = await db
    .insert(schema.plans)
    .values({ householdId, id: planId, budgetTarget: resolved })
    .onConflictDoNothing({ target: [schema.plans.householdId, schema.plans.id] })
    .returning();

  if (!plan) {
    throw new PlanExistsError(planId);
  }

  return plan;
}

/**
 * Create the week, or return the one already there.
 *
 * Separate from `createPlan` rather than replacing it: `POST /plans` promises 409 on a week that
 * exists, and a committed week has to be retryable after a rolled-back attempt. An absent
 * `budgetTarget` on a conflict leaves the stored number alone — a re-commit that omits it must
 * not reset the target the week was planned against.
 */
export async function upsertPlan(
  householdId: string,
  planId: string,
  budgetTarget: number | null | undefined,
  db: Queryable = defaultDb,
) {
  requireIsoWeek(planId);

  const resolved = await resolveBudgetTarget(householdId, budgetTarget, db);

  const [plan] = await db
    .insert(schema.plans)
    .values({ householdId, id: planId, budgetTarget: resolved })
    .onConflictDoUpdate({
      target: [schema.plans.householdId, schema.plans.id],
      set:
        budgetTarget === undefined
          ? { updateTime: sql`now()` }
          : { budgetTarget: resolved, updateTime: sql`now()` },
    })
    .returning();

  return plan;
}
```

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `pnpm vitest run server/services/plans.test.ts`
Expected: PASS, including the pre-existing `createPlan` cases.

- [ ] **Step 10: Verify and commit**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run
git add server/services/config.ts server/services/history.ts server/services/plans.ts server/services/plans.test.ts server/services/recipes.ts
git commit -m "refactor(services): extract the plan, recipe and day writes from their transactions

So a caller committing a whole week can run all of them in one. Follows
detachHistoryFromDay: a function that may run inside a caller's transaction
takes Queryable and opens none of its own.

Refs: #149"
```

---

### Task 2: The `commitWeek` service

**Files:**
- Create: `server/services/week-commit.ts`
- Create: `server/services/week-commit.test.ts`
- Modify: `server/services/isolation.test.ts` — add a `commitWeek` case

**Interfaces:**
- Consumes, all from Task 1: `insertRecipe`, `recipesByIds` from `@server/services/recipes`; `prepareDay`, `writePlanDay`, `upsertPlan`, types `MealSlot`, `Plan`, `PlanDayInput`, `PlanDayWithRecipes`, `PreparedDay` from `@server/services/plans`; `recordMeal` from `@server/services/history`.
- Produces: `commitWeek(householdId: string, planId: string, input: WeekCommitInput, db?: Database): Promise<WeekCommitResult>`, the input and result types below, and four error classes: `DuplicateCommitDayError`, `DuplicateCommitRecipeError`, `UnknownRecipeError`, `DaysAlreadyPlannedError`.

- [ ] **Step 1: Write the failing tests**

Create `server/services/week-commit.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb } from "@server/db/testing";
import type { Database } from "@server/db";
import { setConfigValue } from "@server/services/config";
import { getPlanDay } from "@server/services/plans";
import { createRecipe, getRecipe, RecipeNotFoundError } from "@server/services/recipes";
import { listHistory, rateMeal } from "@server/services/history";

import {
  commitWeek,
  DaysAlreadyPlannedError,
  DuplicateCommitDayError,
  DuplicateCommitRecipeError,
  UnknownRecipeError,
} from "./week-commit";

const H = "loewer";
const WEEK = "2026-W36";
const MONDAY = "2026-08-31";
const TUESDAY = "2026-09-01";

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());

  await setConfigValue(H, "default_budget", "120", db);
  await setConfigValue(H, "no_repeat_days", "30", db);
});

afterEach(async () => {
  await close();
});

/** A payload with one new recipe on Monday, which most cases start from. */
function oneDay(overrides: Partial<Parameters<typeof commitWeek>[2]> = {}) {
  return {
    budgetTarget: 95,
    recipes: [
      {
        recipeId: "gnocchi",
        title: "Sheet-Pan Gnocchi",
        baseServings: 8,
        totalMin: 30,
        ingredients: [{ name: "gnocchi", quantity: 32, unit: "oz", category: "pantry" as const }],
      },
    ],
    days: [{ date: MONDAY, servings: 8, main: "gnocchi", notes: "58F and wet" }],
    ...overrides,
  };
}

describe("commitWeek", () => {
  it("writes the plan, the recipes, the days and the derived history in one call", async () => {
    const result = await commitWeek(H, WEEK, oneDay(), db);

    expect(result.plan).toMatchObject({ id: WEEK, budgetTarget: "95.00" });
    expect(result.createdRecipeIds).toEqual(["gnocchi"]);
    expect(result.days).toHaveLength(1);

    const day = await getPlanDay(H, WEEK, MONDAY, "dinner", db);
    expect(day).toMatchObject({ servings: 8, main: "gnocchi", notes: "58F and wet" });

    const history = await listHistory(H, {}, db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      date: MONDAY,
      recipeId: "gnocchi",
      title: "Sheet-Pan Gnocchi",
      mealSlot: "dinner",
      planId: WEEK,
    });
  });

  it("records history only for the main, not the side or the extras", async () => {
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);
    await createRecipe(H, "brownies", { title: "Brownies", baseServings: 12 }, [], db);

    await commitWeek(
      H,
      WEEK,
      oneDay({
        days: [
          { date: MONDAY, servings: 8, main: "gnocchi", side: "salad", extras: ["brownies"] },
        ],
      }),
      db,
    );

    expect((await listHistory(H, {}, db)).map((entry) => entry.recipeId)).toEqual(["gnocchi"]);
  });

  it("writes no history for a day with no main", async () => {
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    const result = await commitWeek(
      H,
      WEEK,
      oneDay({ recipes: [], days: [{ date: MONDAY, servings: 8, side: "salad" }] }),
      db,
    );

    expect(result.historyEntryIds).toEqual([]);
    expect(await listHistory(H, {}, db)).toHaveLength(0);
  });

  it("rolls the whole commit back when a later recipe id is taken", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [
            { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
            { recipeId: "tacos", title: "Tacos Again", baseServings: 8 },
          ],
          days: [
            { date: MONDAY, servings: 8, main: "gnocchi" },
            { date: TUESDAY, servings: 8, main: "tacos" },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(/tacos/);

    // The first recipe, the plan, the days and the history are all absent: one transaction.
    await expect(getRecipe(H, "gnocchi", db)).rejects.toThrow(RecipeNotFoundError);
    expect(await listHistory(H, {}, db)).toHaveLength(0);
    expect(await db.query.plans.findFirst()).toBeUndefined();
    expect(await db.query.planDays.findFirst()).toBeUndefined();
  });

  it("leaves the existing recipe untouched when a commit collides with it", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [{ recipeId: "tacos", title: "Tacos Again", baseServings: 4 }],
          days: [{ date: MONDAY, servings: 8, main: "tacos" }],
        }),
        db,
      ),
    ).rejects.toThrow();

    expect(await getRecipe(H, "tacos", db)).toMatchObject({ title: "Tacos", baseServings: 8 });
  });

  it("refuses a day already in the plan, and writes nothing else in the payload", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    await expect(
      commitWeek(
        H,
        WEEK,
        {
          recipes: [{ recipeId: "chili", title: "Chili", baseServings: 8 }],
          days: [
            { date: MONDAY, servings: 4, main: "salad", notes: "overwritten" },
            { date: TUESDAY, servings: 8, main: "chili" },
          ],
        },
        db,
      ),
    ).rejects.toThrow(DaysAlreadyPlannedError);

    const monday = await getPlanDay(H, WEEK, MONDAY, "dinner", db);
    expect(monday).toMatchObject({ servings: 8, main: "gnocchi", notes: "58F and wet" });

    await expect(getRecipe(H, "chili", db)).rejects.toThrow(RecipeNotFoundError);
    await expect(getPlanDay(H, WEEK, TUESDAY, "dinner", db)).rejects.toThrow();
  });

  it("overwrites a day when the caller opts in", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "salad", { title: "Green Salad", baseServings: 10 }, [], db);

    await commitWeek(
      H,
      WEEK,
      {
        replaceExistingDays: true,
        days: [{ date: MONDAY, servings: 4, main: "salad", notes: "swapped" }],
      },
      db,
    );

    expect(await getPlanDay(H, WEEK, MONDAY, "dinner", db)).toMatchObject({
      servings: 4,
      main: "salad",
      notes: "swapped",
    });
  });

  it("accepts a day the plan does not have without the flag, and leaves the others alone", async () => {
    await commitWeek(H, WEEK, oneDay(), db);
    await createRecipe(H, "chili", { title: "Chili", baseServings: 8 }, [], db);

    await commitWeek(H, WEEK, { days: [{ date: TUESDAY, servings: 8, main: "chili" }] }, db);

    expect(await getPlanDay(H, WEEK, MONDAY, "dinner", db)).toMatchObject({ main: "gnocchi" });
    expect(await getPlanDay(H, WEEK, TUESDAY, "dinner", db)).toMatchObject({ main: "chili" });
  });

  it("succeeds on a retry after a rolled-back attempt, with no flag", async () => {
    await createRecipe(H, "tacos", { title: "Tacos", baseServings: 8 }, [], db);

    const doomed = oneDay({
      recipes: [
        { recipeId: "gnocchi", title: "Sheet-Pan Gnocchi", baseServings: 8 },
        { recipeId: "tacos", title: "Tacos Again", baseServings: 8 },
      ],
      days: [{ date: MONDAY, servings: 8, main: "gnocchi" }],
    });

    await expect(commitWeek(H, WEEK, doomed, db)).rejects.toThrow();

    // The failed attempt left no plan and no days, so the retry needs no replaceExistingDays.
    const result = await commitWeek(H, WEEK, oneDay(), db);

    expect(result.days).toHaveLength(1);
  });

  it("keeps a rating given between two commits of the same week", async () => {
    const first = await commitWeek(H, WEEK, oneDay(), db);

    await rateMeal(H, first.historyEntryIds[0], { rating: 5 }, ["rating"], db);
    await commitWeek(H, WEEK, { replaceExistingDays: true, days: oneDay().days }, db);

    expect((await listHistory(H, {}, db))[0]).toMatchObject({ rating: 5 });
  });

  it("leaves the stored budget alone when a re-commit names none", async () => {
    await commitWeek(H, WEEK, oneDay(), db);

    const again = await commitWeek(
      H,
      WEEK,
      { replaceExistingDays: true, days: oneDay().days },
      db,
    );

    expect(again.plan.budgetTarget).toBe("95.00");
  });

  it("names the dish when a day references a recipe that does not exist", async () => {
    await expect(
      commitWeek(H, WEEK, { recipes: [], days: [{ date: MONDAY, servings: 8, main: "ghost" }] }, db),
    ).rejects.toThrow(UnknownRecipeError);

    expect(await db.query.plans.findFirst()).toBeUndefined();
  });

  it("accepts a day referencing a recipe created in the same commit", async () => {
    const result = await commitWeek(H, WEEK, oneDay(), db);

    expect(result.days[0].main).toBe("gnocchi");
  });

  it("rejects a date outside the plan's own week", async () => {
    await expect(
      commitWeek(H, WEEK, oneDay({ days: [{ date: "2026-09-08", servings: 8 }] }), db),
    ).rejects.toThrow(/2026-W37/);
  });

  it("rejects two days sharing a date and slot", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          days: [
            { date: MONDAY, servings: 8, main: "gnocchi" },
            { date: MONDAY, servings: 4 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(DuplicateCommitDayError);
  });

  it("allows two slots on the same date", async () => {
    await createRecipe(H, "oats", { title: "Oats", baseServings: 4 }, [], db);

    const result = await commitWeek(
      H,
      WEEK,
      oneDay({
        days: [
          { date: MONDAY, servings: 8, main: "gnocchi" },
          { date: MONDAY, mealSlot: "breakfast" as const, servings: 4, main: "oats" },
        ],
      }),
      db,
    );

    expect(result.days).toHaveLength(2);
    expect(result.historyEntryIds).toHaveLength(2);
  });

  it("rejects two recipes sharing an id", async () => {
    await expect(
      commitWeek(
        H,
        WEEK,
        oneDay({
          recipes: [
            { recipeId: "gnocchi", title: "One", baseServings: 8 },
            { recipeId: "gnocchi", title: "Two", baseServings: 8 },
          ],
        }),
        db,
      ),
    ).rejects.toThrow(DuplicateCommitRecipeError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/services/week-commit.test.ts`
Expected: FAIL — `Cannot find module './week-commit'`.

- [ ] **Step 3: Write the service**

Create `server/services/week-commit.ts`:

```ts
import "server-only";

import { db as defaultDb, schema, type Database, type Queryable } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";

import { recordMeal } from "./history";
import {
  prepareDay,
  upsertPlan,
  writePlanDay,
  type MealSlot,
  type Plan,
  type PlanDayInput,
  type PlanDayWithRecipes,
  type PreparedDay,
} from "./plans";
import { insertRecipe, type IngredientInput, type RecipeInput } from "./recipes";

/**
 * Write an approved week in one transaction.
 *
 * `householdId` is the required first parameter on every exported function — see the note in
 * `server/services/recipes.ts`.
 *
 * The four calls this replaces had a write order forced on them by the schema — a day needs its
 * plan and its recipes, and a history entry needs its day — and no transaction around it, so a
 * failure part-way left a real plan with days missing. That order lives here now instead of in the
 * planning workflow's prose.
 */

export interface CommitRecipeInput extends RecipeInput {
  recipeId: string;
  ingredients?: IngredientInput[];
}

export interface CommitDayInput extends PlanDayInput {
  date: string;
  mealSlot?: MealSlot;
}

export interface WeekCommitInput {
  budgetTarget?: number | null;
  recipes?: CommitRecipeInput[];
  days: CommitDayInput[];
  /** Permits overwriting days already in the plan. Absent means refuse. */
  replaceExistingDays?: boolean;
}

export interface WeekCommitResult {
  plan: Plan;
  createdRecipeIds: string[];
  days: PlanDayWithRecipes[];
  historyEntryIds: string[];
}

export class DuplicateCommitDayError extends Error {
  constructor(
    readonly date: string,
    readonly mealSlot: MealSlot,
  ) {
    super(`${date} appears more than once as a ${mealSlot}; a date holds one meal per slot`);
  }
}

export class DuplicateCommitRecipeError extends Error {
  constructor(readonly recipeId: string) {
    super(`${recipeId} appears more than once in recipes`);
  }
}

export class UnknownRecipeError extends Error {
  constructor(readonly recipeIds: string[]) {
    super(
      `No saved or committed recipe named ${recipeIds.join(", ")}; ` +
        "a day can only name a recipe that exists or that this commit creates",
    );
  }
}

export class DaysAlreadyPlannedError extends Error {
  constructor(readonly dates: string[]) {
    super(
      `Already planned: ${dates.join(", ")}. ` +
        "Pass replaceExistingDays to overwrite, which discards whatever is on those days.",
    );
  }
}

function assertNoDuplicateRecipes(recipes: CommitRecipeInput[]) {
  const seen = new Set<string>();

  for (const recipe of recipes) {
    if (seen.has(recipe.recipeId)) {
      throw new DuplicateCommitRecipeError(recipe.recipeId);
    }

    seen.add(recipe.recipeId);
  }
}

function assertNoDuplicateDays(days: PreparedDay[]) {
  const seen = new Set<string>();

  for (const day of days) {
    const key = `${day.date}-${day.mealSlot}`;

    if (seen.has(key)) {
      throw new DuplicateCommitDayError(day.date, day.mealSlot);
    }

    seen.add(key);
  }
}

/**
 * Every recipe a day names, so both checks that need them run over one list.
 *
 * A day's own duplicate-role check is `prepareDay`'s; this is only about which ids have to exist.
 */
function referencedRecipeIds(days: PreparedDay[]) {
  return [
    ...new Set(
      days.flatMap((day) => [day.input.main, day.input.side, ...(day.input.extras ?? [])]),
    ),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function assertRecipesResolve(
  householdId: string,
  committed: CommitRecipeInput[],
  days: PreparedDay[],
  db: Queryable,
) {
  const creating = new Set(committed.map((recipe) => recipe.recipeId));
  const wanted = referencedRecipeIds(days).filter((id) => !creating.has(id));

  if (wanted.length === 0) {
    return;
  }

  const found = await db
    .select({ id: schema.recipes.id })
    .from(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), inArray(schema.recipes.id, wanted)));

  const have = new Set(found.map((row) => row.id));
  const missing = wanted.filter((id) => !have.has(id));

  if (missing.length > 0) {
    throw new UnknownRecipeError(missing);
  }
}

async function assertDaysUnplanned(
  householdId: string,
  planId: string,
  days: PreparedDay[],
  db: Queryable,
) {
  const existing = await db
    .select({ date: schema.planDays.date, mealSlot: schema.planDays.mealSlot })
    .from(schema.planDays)
    .where(and(eq(schema.planDays.householdId, householdId), eq(schema.planDays.planId, planId)));

  const taken = new Set(existing.map((row) => `${row.date}-${row.mealSlot}`));
  const clashes = days
    .filter((day) => taken.has(`${day.date}-${day.mealSlot}`))
    .map((day) => day.date);

  if (clashes.length > 0) {
    throw new DaysAlreadyPlannedError(clashes);
  }
}

export async function commitWeek(
  householdId: string,
  planId: string,
  input: WeekCommitInput,
  db: Database = defaultDb,
): Promise<WeekCommitResult> {
  const recipes = input.recipes ?? [];

  // Shape checks first. They need no database, and a rejected request should not have taken a
  // write lock — the same reason `setPlanDay` prepares its rows before opening its transaction.
  assertNoDuplicateRecipes(recipes);

  const prepared = input.days.map((day) =>
    prepareDay(householdId, planId, day.date, day.mealSlot ?? "dinner", day),
  );

  assertNoDuplicateDays(prepared);

  return db.transaction(async (tx) => {
    // The two checks that read stored state are the transaction's first reads rather than queries
    // ahead of it: both decide whether to write based on what is already there.
    await assertRecipesResolve(householdId, recipes, prepared, tx);

    if (!input.replaceExistingDays) {
      await assertDaysUnplanned(householdId, planId, prepared, tx);
    }

    const plan = await upsertPlan(householdId, planId, input.budgetTarget, tx);

    for (const recipe of recipes) {
      const { recipeId, ingredients, ...fields } = recipe;

      await insertRecipe(householdId, recipeId, fields, ingredients ?? [], tx);
    }

    const days: PlanDayWithRecipes[] = [];

    for (const day of prepared) {
      days.push(await writePlanDay(householdId, planId, day, tx));
    }

    // After the days, so the foreign key from a history entry to its day is already satisfied —
    // which is why `recordMeal` needs no special case here.
    const titles = await recipeTitles(householdId, prepared, tx);
    const historyEntryIds: string[] = [];

    for (const day of prepared) {
      const main = day.input.main;

      if (!main) continue;

      const entry = await recordMeal(
        householdId,
        {
          date: day.date,
          recipeId: main,
          title: titles.get(main) ?? main,
          mealSlot: day.mealSlot,
          planId,
        },
        tx,
      );

      historyEntryIds.push(entry.id);
    }

    return { plan, createdRecipeIds: recipes.map((recipe) => recipe.recipeId), days, historyEntryIds };
  });
}

/** Read after the recipes are inserted, so a dish created by this commit has a title too. */
async function recipeTitles(householdId: string, days: PreparedDay[], db: Queryable) {
  const mains = [...new Set(days.map((day) => day.input.main))].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  if (mains.length === 0) {
    return new Map<string, string>();
  }

  const rows = await db
    .select({ id: schema.recipes.id, title: schema.recipes.title })
    .from(schema.recipes)
    .where(and(eq(schema.recipes.householdId, householdId), inArray(schema.recipes.id, mains)));

  return new Map(rows.map((row) => [row.id, row.title]));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/services/week-commit.test.ts`
Expected: PASS, all cases.

If the rollback case fails by finding rows after the error, the cause is a nested transaction: check that `insertRecipe`, `writePlanDay`, `upsertPlan` and `recordMeal` all received `tx` and that none of them opens a transaction of its own.

- [ ] **Step 5: Add the household isolation case**

In `server/services/isolation.test.ts`, add `commitWeek` to the imports from a new
`@server/services/week-commit` import, and add a case alongside the existing ones:

```ts
it("commitWeek does not see another household's recipes or days", async () => {
  await setConfigValue(OTHER, "default_budget", "80", db);
  await createRecipe(OTHER, "theirs", { title: "Theirs", baseServings: 8 }, [], db);

  // Their recipe must not satisfy our day's reference.
  await expect(
    commitWeek(H, "2026-W36", { days: [{ date: "2026-08-31", servings: 8, main: "theirs" }] }, db),
  ).rejects.toThrow(UnknownRecipeError);

  // Their planned day must not block ours.
  await commitWeek(
    OTHER,
    "2026-W36",
    {
      recipes: [{ recipeId: "ours", title: "Ours", baseServings: 8 }],
      days: [{ date: "2026-08-31", servings: 8, main: "ours" }],
    },
    db,
  );
  await createRecipe(H, "mine", { title: "Mine", baseServings: 8 }, [], db);

  const result = await commitWeek(
    H,
    "2026-W36",
    { days: [{ date: "2026-08-31", servings: 8, main: "mine" }] },
    db,
  );

  expect(result.days[0].main).toBe("mine");
  expect(await listHistory(OTHER, {}, db)).toHaveLength(1);
  expect(await listHistory(H, {}, db)).toHaveLength(1);
});
```

Match the file's own constants for the two household ids and its `beforeEach` setup rather than
introducing new ones; if it has no `OTHER` config for `default_budget`, the `setConfigValue` line
above covers it.

- [ ] **Step 6: Run the isolation suite**

Run: `pnpm vitest run server/services/isolation.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify and commit**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run
git add server/services/week-commit.ts server/services/week-commit.test.ts server/services/isolation.test.ts
git commit -m "feat(plans): commit a whole week in one transaction

commitWeek writes an approved week's new recipes, plan, days and derived
history together, so a failure part-way leaves nothing rather than a plan
with days missing. A day already in the plan is refused unless the caller
opts in: the household edits days after planning, and a later whole-week
write would discard that silently.

Refs: #149"
```

---

### Task 3: The `POST /plans/{plan}:commit` route

**Files:**
- Modify: `server/api/schemas.ts` — move `toIngredientInput` here and add the commit request schema
- Modify: `server/api/routes/recipes.ts` — import `toIngredientInput` instead of declaring it
- Modify: `server/api/routes/plans.ts` — the new route and its error mapping
- Test: `server/api/routes/plans.test.ts`

**Interfaces:**
- Consumes: `commitWeek` and its four error classes from `@server/services/week-commit` (Task 2).
- Produces: `POST /v1/plans/{plan}:commit`. Response body: `{ plan: Plan, createdRecipeIds: string[], historyEntryIds: string[] }` where `Plan` is the existing `PlanSchema` resource, carrying the written days. Also exports `toIngredientInput` from `@server/api/schemas`.

- [ ] **Step 1: Write the failing route tests**

Append to `server/api/routes/plans.test.ts`:

```ts
describe("POST /v1/plans/{plan}:commit", () => {
  const body = {
    budgetTarget: 95,
    recipes: [
      {
        recipeId: "gnocchi",
        title: "Sheet-Pan Gnocchi",
        baseServings: 8,
        ingredients: [
          { ingredientName: "gnocchi", quantity: 32, unit: "oz", category: "pantry" },
        ],
      },
    ],
    days: [{ date: MONDAY, servings: 8, main: "gnocchi", notes: "58F and wet" }],
  };

  it("writes the week and reports what it wrote", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: {
        name: `plans/${WEEK}`,
        planId: WEEK,
        budgetTarget: 95,
        days: [{ date: MONDAY, main: "gnocchi", servings: 8 }],
      },
      createdRecipeIds: ["gnocchi"],
      historyEntryIds: [`${MONDAY}-gnocchi`],
    });
  });

  it("maps a taken recipe id to ALREADY_EXISTS", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      ...body,
      recipes: [{ recipeId: "fajitas", title: "Fajitas", baseServings: 8 }],
      days: [{ date: MONDAY, servings: 8, main: "fajitas" }],
    });

    expect(response.status).toBe(409);
  });

  it("maps a day already planned to ALREADY_EXISTS", async () => {
    await send("POST", `/v1/plans/${WEEK}:commit`, body);

    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: MONDAY, servings: 4, main: "pico" }],
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "ALREADY_EXISTS", message: expect.stringContaining(MONDAY) },
    });
  });

  it("overwrites that day when the caller opts in", async () => {
    await send("POST", `/v1/plans/${WEEK}:commit`, body);

    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      replaceExistingDays: true,
      recipes: [],
      days: [{ date: MONDAY, servings: 4, main: "pico" }],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: { days: [{ date: MONDAY, main: "pico", servings: 4 }] },
    });
  });

  it("maps an unknown recipe on a day to INVALID_ARGUMENT", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: MONDAY, servings: 8, main: "ghost" }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { status: "INVALID_ARGUMENT", message: expect.stringContaining("ghost") },
    });
  });

  it("maps a date outside the week to INVALID_ARGUMENT", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, {
      recipes: [],
      days: [{ date: "2026-09-08", servings: 8, main: "fajitas" }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects an empty days array before reaching the service", async () => {
    const response = await send("POST", `/v1/plans/${WEEK}:commit`, { recipes: [], days: [] });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/api/routes/plans.test.ts -t commit`
Expected: FAIL with 404 responses — the route does not exist.

- [ ] **Step 3: Move `toIngredientInput` into the shared schema module**

In `server/api/schemas.ts`, add the import and the function below `IngredientInputSchema`:

```ts
import type { IngredientInput } from "@server/services/recipes";

/** The HTTP field is `ingredientName`; the service field is `name`. One place converts. */
export function toIngredientInput(input: z.infer<typeof IngredientInputSchema>): IngredientInput {
  return {
    name: input.ingredientName,
    quantity: input.quantity,
    unit: input.unit,
    category: input.category,
    notes: input.notes,
  };
}
```

In `server/api/routes/recipes.ts`, delete the local `toIngredientInput` declaration (around lines
74-88) and add `toIngredientInput` to the existing `@server/api/schemas` import. Leave every call
site as it is.

- [ ] **Step 4: Add the commit request schema**

In `server/api/schemas.ts`, below `PlanDayInputSchema`:

```ts
export const CommitDayInputSchema = PlanDayInputSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealSlot: MealSlotSchema.default("dinner"),
}).openapi("CommitDayInput");

export const CommitRecipeInputSchema = RecipeInputSchema.extend({
  recipeId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
}).openapi("CommitRecipeInput");

export const WeekCommitRequestSchema = z
  .object({
    budgetTarget: z.number().nonnegative().nullish(),
    recipes: z.array(CommitRecipeInputSchema).optional(),
    // At least one day: a commit that writes nothing is a caller mistake, not an empty success.
    days: z.array(CommitDayInputSchema).min(1),
    replaceExistingDays: z.boolean().optional(),
  })
  .openapi("WeekCommitRequest");

export const WeekCommitResponseSchema = z
  .object({
    plan: PlanSchema,
    createdRecipeIds: z.array(z.string()),
    historyEntryIds: z.array(z.string()),
  })
  .openapi("WeekCommitResponse");
```

`CommitRecipeInputSchema` keeps `RecipeInputSchema`'s own `ingredients` field, so a recipe arrives
with its ingredients inline exactly as it does on `POST /recipes`.

- [ ] **Step 5: Add the route**

In `server/api/routes/plans.ts`, extend the imports:

```ts
import {
  MealSlotSchema,
  PlanDayInputSchema,
  PlanDaySchema,
  PlanSchema,
  toIngredientInput,
  WeekCommitRequestSchema,
  WeekCommitResponseSchema,
} from "@server/api/schemas";
import { RecipeExistsError } from "@server/services/recipes";
import {
  commitWeek,
  DaysAlreadyPlannedError,
  DuplicateCommitDayError,
  DuplicateCommitRecipeError,
  UnknownRecipeError,
} from "@server/services/week-commit";
```

Extend `planError` so the commit's own failures map without a second handler. Add these to the
existing `INVALID_ARGUMENT` branch's condition:

```ts
  if (
    error instanceof InvalidPlanIdError ||
    error instanceof DateOutsidePlanError ||
    error instanceof InvalidDateError ||
    error instanceof DuplicateRecipeError ||
    error instanceof DuplicateCommitDayError ||
    error instanceof DuplicateCommitRecipeError ||
    error instanceof UnknownRecipeError
  ) {
    return apiError(c, "INVALID_ARGUMENT", error.message);
  }

  if (
    error instanceof PlanExistsError ||
    error instanceof RecipeExistsError ||
    error instanceof DaysAlreadyPlannedError
  ) {
    return apiError(c, "ALREADY_EXISTS", error.message);
  }
```

Then append the route at the end of the file:

```ts
plansRoutes.openapi(
  createRoute({
    method: "post",
    // A custom verb, matching `/recipes/{recipe}:scale` and `/recipes:scrape`. The week is not a
    // resource being replaced: the body carries recipes to create as well as days to write.
    path: "/plans/{plan}:commit",
    summary: "Write an approved week in one transaction",
    description:
      "Creates the recipes, upserts the plan, writes the days and records one history entry per " +
      "day's main, all or nothing. Recipes are create-only: an id that already exists fails the " +
      "commit rather than updating it. A day already in the plan is refused unless " +
      "`replaceExistingDays` is set, because it may carry edits made after the week was planned.",
    request: {
      params: PlanParam,
      body: { content: { "application/json": { schema: WeekCommitRequestSchema } } },
    },
    responses: {
      200: {
        description: "What was written",
        content: { "application/json": { schema: WeekCommitResponseSchema } },
      },
      409: { description: "A recipe id is taken, or a day is already planned" },
      ...ERRORS,
    },
  }),
  async (c) => {
    const { plan } = c.req.valid("param");
    const request = c.req.valid("json");

    try {
      const result = await commitWeek(c.get("householdId"), plan, {
        budgetTarget: request.budgetTarget,
        replaceExistingDays: request.replaceExistingDays,
        recipes: (request.recipes ?? []).map(({ ingredients, ...recipe }) => ({
          ...recipe,
          ingredients: (ingredients ?? []).map(toIngredientInput),
        })),
        days: request.days,
      });

      return c.json(
        {
          plan: toPlanResource(result.plan, result.days),
          createdRecipeIds: result.createdRecipeIds,
          historyEntryIds: result.historyEntryIds,
        },
        200,
      );
    } catch (error) {
      return planError(c, error);
    }
  },
);
```

`toPlanResource(result.plan, result.days)` reports the days this commit wrote, not the whole week.
A caller wanting the full week reads `GET /plans/{plan}` after.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run server/api/routes/plans.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 7: Confirm the endpoint reached the spec**

```bash
pnpm typecheck
pnpm vitest run
```

Then check the generated spec carries the verb, since AGENTS.md makes `openapi.json` the endpoint
reference:

```bash
pnpm dev &
sleep 8 && curl -s localhost:3000/v1/openapi.json | grep -c 'plans/{plan}:commit'
```

Expected: `1` or more. Stop the dev server afterwards. If the route is absent, it was appended
outside `plansRoutes.openapi(...)`.

- [ ] **Step 8: Verify and commit**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
git add server/api/schemas.ts server/api/routes/plans.ts server/api/routes/recipes.ts server/api/routes/plans.test.ts
git commit -m "feat(api): add POST /plans/{plan}:commit

One call for an approved week, so a workflow cannot leave a half-written
one behind. Moves toIngredientInput to the shared schema module, which two
routes now need.

Refs: #149"
```

---

### Task 4: Hold scraped recipes as drafts in add-recipe

Splits `add-recipe` at the write boundary. No service or route changes.

**Files:**
- Modify: `.gitignore` — the draft directory
- Modify: `.claude/skills/add-recipe/SKILL.md` — step headings, a new step 4, the old step 4 renumbered

**Interfaces:**
- Produces: the draft file convention `.provender/drafts/<slug>.json`, holding the exact body `POST /recipes` takes, which `plan-week` (Task 5) assembles its commit payload from.

- [ ] **Step 1: Ignore the draft directory**

Add to `.gitignore`, under the `# Node / Next` block:

```
# Recipe drafts held between a scrape and an approval
.provender/
```

- [ ] **Step 2: Add the draft step to add-recipe**

In `.claude/skills/add-recipe/SKILL.md`, insert a new section between the current step 3
("Set the servings the household will cook") and step 4 ("Save"):

```markdown
## 4. Write the draft

```bash
mkdir -p .provender/drafts
cat > .provender/drafts/<slug>.json <<'JSON'
{ "title": "...", "baseServings": 8, "ingredients": [ ... ] }
JSON
```

The slug is the title, lowercase and hyphenated. The file holds exactly the body `POST /recipes`
takes — nothing is written to the library yet.

A caller that owns an approval gate stops here and hands the draft to that gate: **plan-week** does,
because a week the household rejects must leave no recipes behind. On its own, `add-recipe` carries
straight on to step 5 — the user pasting a link *was* the approval, so there is no gate to wait for.
```

Renumber the existing "## 4. Save" to "## 5. Save", and change its first code block's create call
to read the draft rather than an unnamed file:

```bash
./scripts/prov GET '/recipes?pageSize=200'
./scripts/prov POST '/recipes?recipeId=<slug>' @.provender/drafts/<slug>.json
./scripts/prov GET /recipes/<slug>/ingredients
```

Leave the rest of that section exactly as it is, including `ALREADY_EXISTS`, the PATCH branch and
the read-to-exhaustion instruction. That branch is reached only when the user chose the URL.

- [ ] **Step 3: Check the skill still reads as one flow**

Run: `sed -n '1,200p' .claude/skills/add-recipe/SKILL.md`
Expected: steps numbered 1-5 with no gaps, one "Save" section, and the PATCH instruction still
inside it.

- [ ] **Step 4: Commit**

```bash
git add .gitignore .claude/skills/add-recipe/SKILL.md
git commit -m "feat(add-recipe): write a scraped recipe to a draft before saving it

A caller with an approval gate stops at the draft. add-recipe itself still
saves, because the user pasting a link was the approval.

Refs: #149"
```

---

### Task 5: Route plan-week through drafts and one commit

**Files:**
- Modify: `.claude/skills/plan-week/SKILL.md` — step 3 gains the collision check, step 6 becomes one call
- Modify: `AGENTS.md` — one invariant line

**Interfaces:**
- Consumes: the draft convention from Task 4, and `POST /plans/{plan}:commit` from Task 3.

- [ ] **Step 1: Rewrite step 3's sourcing instructions**

In `.claude/skills/plan-week/SKILL.md`, replace the first paragraph of "## 3. Source the recipes"
with:

```markdown
A dish the household already has is the cheaper choice, and re-scraping one saves it twice. For
each new main the quota calls for, find a real URL and follow **add-recipe** through its draft step
— steps 1 to 4. Stop there. Nothing is saved until the household approves the week.

Then check the draft's slug against the `recipes` list from step 1, which is the whole catalog:

- **Already there.** The dish was never new. Delete the draft. If that recipe is in the `unplanned`
  tier, plan the saved one instead — that is what the novelty quota wanted. Otherwise choose a
  different dish.
- **Not there.** Keep the draft. It will be committed with the week in step 6.

Never `PATCH` a recipe from here. A slug that collides belongs to a dish the household already
owns, and rewriting it changes something nobody asked to change.
```

Leave the site rotation table and the paragraph below it untouched.

- [ ] **Step 2: Replace step 6 with the commit call**

Replace everything under "## 6. Save, once approved" down to (not including) "## 7. Hand off" with:

```markdown
Store every recipe at the servings that will be cooked, so the shopping list never has to scale.
A day's `servings` is the main's `baseServings` from step 1, not a number derived from household
size. Where that yield will not cover the leftovers the household expects, say so rather than
writing a larger number the recipe cannot back.

Build one payload and send it once:

```bash
./scripts/prov POST '/plans/<iso-week>:commit' @week.json
```

`week.json` carries the whole week:

- `budgetTarget` — the number the week was costed against.
- `recipes` — the drafts held from step 3, each with its `recipeId` and its ingredients inline.
  Build this list by walking the approved days' `main`, `side` and `extras`: a draft no approved day
  names does not belong in the payload. A dish the household swapped out during review therefore
  drops out on its own.
- `days` — one entry per planned day, carrying `date`, `servings`, `status`, `notes`, `main`, `side`
  and `extras`. The plan id is the ISO week (`2026-W37`) and every date must fall inside it.

The call is one transaction: it writes the recipes, the plan, the days and the history together, or
it writes nothing. There is no half-written week to clean up, and a retry after a failure is the
same call again.

`mealSlot` defaults to `dinner`, which is what a week of planning writes — lunches here are
leftovers. Pass `breakfast` or `lunch` only when the user asks for that meal specifically; a date
holds one of each.

**Every side and dessert is a saved recipe, linked by id.** A dish named only in prose is invisible
to the shopping list.

History is recorded for you, one entry per day's main. Do not call `POST /mealHistory`.

**`ALREADY_EXISTS` naming dates means those days are already planned.** Show the dates to the
household and ask. They may have been edited since the week was planned, and `replaceExistingDays`
discards whatever is on them — so set it only when the household says to.
```

- [ ] **Step 3: Record the invariant in AGENTS.md**

In the "## Invariants (don't break these)" list, add after the shopping-list `PUT` entry:

```markdown
- **An approved week is written by one call.** `POST /plans/{plan}:commit` creates the recipes,
  upserts the plan, writes the days and records history in one transaction, so a rejected or failed
  plan leaves nothing behind. Scraped recipes wait in `.provender/drafts/` until then. A day already
  in the plan is refused unless the caller opts in, because it may carry edits made after planning.
```

- [ ] **Step 4: Check the skill's own claim is now true**

Run: `grep -n "POST /recipes\|POST /mealHistory\|prov POST" .claude/skills/plan-week/SKILL.md`
Expected: exactly one `prov POST` line, the `:commit` call. No `POST /recipes` and no
`POST /mealHistory` anywhere in the file — those are what "Nothing is written until the user
approves" was contradicted by.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/plan-week/SKILL.md AGENTS.md
git commit -m "feat(plan-week): hold drafts to the gate and commit the week in one call

The skill promised nothing was written before approval while step 4 of
add-recipe did a real POST /recipes against production. Drafts now wait,
and step 6 is a single transaction instead of four ordered calls.

Refs: #149"
```

---

### Task 6: Verify the skills with fixture reps

Reading a skill is not evidence it fires. A rule that read correctly fired zero times out of five on
the previous attempt at this issue, so both changed skills get measured.

**Files:**
- Create: `docs/plans/verification/2026-09-21-commit-reps.md` — the prompt and the scores

**Interfaces:**
- Consumes: the finished Tasks 3, 4 and 5.

- [ ] **Step 1: Capture real fixture data**

```bash
./scripts/prov GET /config > /tmp/config.json
./scripts/prov GET /planning/rotation > /tmp/rotation.json
./scripts/prov GET /weather > /tmp/weather.json
```

These read production, which is safe — all three are reads. Do not run any write against
production during this task.

- [ ] **Step 2: Write the rep prompt**

Create `docs/plans/verification/2026-09-21-commit-reps.md` holding a prompt that:

- States the task as the household would: "plan my week, $120, 5 dinners, quick Monday".
- Inlines the three fixture payloads verbatim, labeled as the responses to
  `GET /config`, `GET /planning/rotation` and `GET /weather`, so the subagent needs no network.
- Instructs the subagent to follow `.claude/skills/plan-week/SKILL.md` and to print every
  `./scripts/prov` command it would run, in order, without executing any of them.
- Says the household **rejects** the proposed week at step 5 in reps 1-3, and **approves** it in
  reps 4-5. Both branches need measuring: rejection is where a pre-approval write shows up, and
  approval is where the commit shape does.

- [ ] **Step 3: Run five reps**

Dispatch five subagents with that prompt, one per rep, using the general-purpose agent type. Record
each transcript's command list in the same file.

- [ ] **Step 4: Score them**

For each rep, mark pass or fail on:

1. **No write before approval.** No `POST /recipes`, `POST /plans`, `PUT /plans/...`, or
   `POST /mealHistory` appears before the week is presented. Reps 1-3 must show no write at all.
2. **One commit call.** Reps 4-5 issue exactly one `prov POST '/plans/<week>:commit'` and no
   per-day `PUT`, no `POST /recipes`, no `POST /mealHistory`.
3. **Drafts held.** A scrape is followed by a write to `.provender/drafts/`, not by `POST /recipes`.
4. **Collision handling.** If a derived slug matches a `recipeId` in the rotation fixture, the rep
   drops it or plans the saved recipe. No `PATCH /recipes/...` in any rep.
5. **Payload assembled from the approved days.** In reps 4-5, `recipes[]` contains only drafts the
   committed days name.

Write the five scores into the file with a one-line note per failure.

- [ ] **Step 5: Act on the scores, not on the prose**

Any criterion failing in 2 or more of 5 reps means the skill text is not carrying the rule. Fix the
text and re-run all five — **a verification run that contradicts the change means the change loses,
not the test.** If a rule cannot be made to fire from prose, move the deterministic part into the
service or the endpoint and leave only judgment in the skill, which is what worked for the rotation
half in #154.

- [ ] **Step 6: Commit the results**

```bash
git add docs/plans/verification/2026-09-21-commit-reps.md
git commit -m "test(plan-week): record five fixture reps for the approval gate

Refs: #149"
```

---

### Task 7: Full verification and review

- [ ] **Step 1: Run everything**

```bash
docker compose up -d
pnpm db:migrate
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
pnpm test:e2e
```

Paste the output. Every one must pass before the branch is offered for review. There is no migration
in this plan — no schema changed — so `pnpm db:generate` should produce nothing; if it produces a
migration, something in a schema file was edited by mistake.

- [ ] **Step 2: Dispatch an independent reviewer on the branch diff**

Self-review missed real defects three rounds running on #154, so this is not optional. Dispatch a
subagent with the full diff (`git diff main...HEAD`), the spec, and no knowledge of the
implementation reasoning. Ask it specifically about:

- A query inside `week-commit.ts` or the extracted steps missing its `householdId` filter.
- Any path where a `Queryable` function opens a transaction, which would make the rollback
  test's guarantee false in production even while passing under PGlite.
- Whether `commitWeek`'s rollback holds for a failure in each of the four stages, not just the
  recipe stage the test exercises.
- Whether `upsertPlan`'s conflict branch can reset a stored `budgetTarget` on any input.
- Whether the route's error mapping can return 500 for an input the service rejects deliberately.

- [ ] **Step 3: Address the findings, then ask before merging**

Bring the findings back for a decision rather than implementing them unreviewed — a reviewer can be
wrong, and a suggestion that contradicts the spec is a spec question. Do not merge without asking.

# Recipe Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 1–5 rating from `meal_history` to `recipes`, and let the household set it from the cook view and see it in the recipe library.

**Architecture:** One new column, `recipes.rating`, backfilled from history in the same migration. `updateRecipe` gains a `rating` mask field, which the REST PATCH and a new tRPC `recipes.setRating` both call. `planningRotation` reads the column. History drops `rating` from its API and from the drizzle definition in PR 1; the database column is dropped in PR 2, after PR 1 is deployed.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM + drizzle-kit, Postgres (Neon; PGlite in tests), Hono + `@hono/zod-openapi`, tRPC + TanStack Query, Vitest + Testing Library, lucide-react.

**Spec:** `docs/specs/2026-09-28-recipe-ratings-design.md`

## Global Constraints

- All logic lives in `server/services/*`; tRPC procedures, REST handlers and Server Components are thin callers (AGENTS.md).
- Every service function takes `householdId` first and filters on it.
- Ratings are integers 1–5, or null for unrated. Enforced by zod at both entry points and by `CHECK (rating BETWEEN 1 AND 5)` in the database.
- `PATCH` bodies follow AIP-134: only fields named in `updateMask` change; a named field omitted from the body is cleared.
- Tap targets in the cook view are at least 44px (`size-11`). Colors come from tokens only; no gold on the rating control (DESIGN.md).
- Comments: default to none. Only a non-obvious why earns one, one or two lines.
- American English in all prose and comments.
- Conventional commits, `Refs: #161` footer. PR 1 branch is `feat/recipe-ratings` (already created; the spec commit is on it). PR 2 branch is `feat/drop-history-rating`.
- Between PR 1 merging and PR 2's migration, no other migration may be generated: `pnpm db:generate` would pick up the `meal_history.rating` drop early.
- Before pushing: `docker compose up -d`, then `pnpm lint`, `pnpm fmt:check`, `pnpm typecheck`, `pnpm vitest run`, `pnpm build`.

---

## PR 1: expand

### Task 1: `recipes.rating` column and backfill migration

**Files:**
- Modify: `server/db/schema/recipes.ts`
- Create: `server/db/migrations/0012_add_recipe_rating.sql` (generated, then appended to)
- Generated: `server/db/migrations/meta/0012_snapshot.json`, `server/db/migrations/meta/_journal.json`
- Test: `server/db/migrations.test.ts`

**Interfaces:**
- Produces: `schema.recipes.rating` (`integer`, nullable). `Recipe` (`typeof schema.recipes.$inferSelect`) gains `rating: number | null`.

- [ ] **Step 1: Write the failing migration test**

Append to `server/db/migrations.test.ts`. It reuses the file's `migrationFiles` and `apply` helpers:

```ts
describe("the recipe rating migration", () => {
  it("copies each recipe's most recent rating, within its own household", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const rating = files.findIndex((file) => file.includes("add_recipe_rating"));

    expect(rating).toBeGreaterThan(0);

    for (const file of files.slice(0, rating)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO households (id, name) VALUES ('loewer', 'Loewer'), ('other', 'Other');
      INSERT INTO recipes (household_id, id, title, base_servings) VALUES
        ('loewer', 'tacos', 'Tacos', 4),
        ('loewer', 'ziti', 'Ziti', 4),
        ('other', 'tacos', 'Their Tacos', 4);
      INSERT INTO meal_history (household_id, id, date, recipe_id, title, rating) VALUES
        ('loewer', '2026-06-01-tacos', '2026-06-01', 'tacos', 'Tacos', 2),
        ('loewer', '2026-08-01-tacos', '2026-08-01', 'tacos', 'Tacos', 5),
        ('loewer', '2026-09-01-tacos', '2026-09-01', 'tacos', 'Tacos', NULL),
        ('loewer', '2026-08-01-ziti', '2026-08-01', 'ziti', 'Ziti', NULL),
        ('other', '2026-07-01-tacos', '2026-07-01', 'tacos', 'Their Tacos', 1);
    `);

    await apply(client, files[rating]);

    const recipes = await client.query<{ household_id: string; id: string; rating: number | null }>(
      "SELECT household_id, id, rating FROM recipes ORDER BY household_id, id",
    );

    // Latest *rated* entry wins (5, not the unrated 09-01), and the other household's 1 stays theirs.
    expect(recipes.rows).toEqual([
      { household_id: "loewer", id: "tacos", rating: 5 },
      { household_id: "loewer", id: "ziti", rating: null },
      { household_id: "other", id: "tacos", rating: 1 },
    ]);

    await client.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run server/db/migrations.test.ts`
Expected: FAIL on `expect(rating).toBeGreaterThan(0)`, received `-1`.

- [ ] **Step 3: Add the column to the drizzle schema**

In `server/db/schema/recipes.ts`, add `check` to the `drizzle-orm/pg-core` import and `sql` to the `drizzle-orm` import:

```ts
import { relations, sql } from "drizzle-orm";
```

Add the column after `instructions`:

```ts
    /** 1–5. Null means unrated, not low-rated. */
    rating: integer("rating"),
```

Add the constraint to the table's extra-config array, after `recipes_title_idx`:

```ts
    check("recipes_rating_range", sql`${table.rating} BETWEEN 1 AND 5`),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate --name add_recipe_rating`
Expected: creates `server/db/migrations/0012_add_recipe_rating.sql` containing exactly:

```sql
ALTER TABLE "recipes" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_rating_range" CHECK ("recipes"."rating" BETWEEN 1 AND 5);
```

If the file contains any other statement, stop. The schema has drifted from the snapshot, and that needs its own investigation before this migration ships.

- [ ] **Step 5: Append the backfill**

Append to `server/db/migrations/0012_add_recipe_rating.sql`:

```sql
--> statement-breakpoint
UPDATE "recipes" AS r
SET "rating" = h."rating"
FROM (
  SELECT DISTINCT ON ("household_id", "recipe_id") "household_id", "recipe_id", "rating"
  FROM "meal_history"
  WHERE "rating" IS NOT NULL AND "recipe_id" IS NOT NULL
  ORDER BY "household_id", "recipe_id", "date" DESC
) AS h
WHERE r."household_id" = h."household_id" AND r."id" = h."recipe_id";
```

- [ ] **Step 6: Run the migration test and the full suite**

Run: `pnpm vitest run server/db/migrations.test.ts`
Expected: PASS, 3 tests.

Run: `pnpm vitest run`
Expected: PASS. `createTestDb` applies every migration, so every service test now runs against the new column.

- [ ] **Step 7: Commit**

```bash
git add server/db/schema/recipes.ts server/db/migrations server/db/migrations.test.ts
git commit -m "feat(recipes): add a rating column, backfilled from history" -m "Refs: #161"
```

---

### Task 2: Set a rating through `updateRecipe` and `PATCH /recipes/{recipe}`

**Files:**
- Modify: `server/services/recipes.ts` (`updateRecipe`, around line 348)
- Modify: `server/api/schemas.ts` (`RecipeSchema`, line 49)
- Modify: `server/api/routes/recipes.ts` (`toRecipeResource`, `UPDATABLE_FIELDS`, the PATCH route's body schema)
- Test: `server/services/recipes.test.ts`, `server/services/isolation.test.ts`, `server/api/routes/recipes.test.ts`

**Interfaces:**
- Consumes: `schema.recipes.rating` (Task 1).
- Produces: `updateRecipe(householdId: string, recipeId: string, updateMask: string[], input: Partial<RecipeInput> & { rating?: number | null }, ingredients: IngredientInput[] | undefined, db?: Database): Promise<Recipe>`. `"rating"` is a valid mask field. The REST `Recipe` resource has `rating: number | null`.

`rating` is deliberately not added to `RecipeInput`, so `POST /recipes` and the week commit do not accept one. A rating follows cooking the dish, not saving it.

- [ ] **Step 1: Write the failing service tests**

In `server/services/recipes.test.ts`, inside `describe("updateRecipe", ...)`:

```ts
  it("sets a rating and clears it", async () => {
    await updateRecipe(HOUSEHOLD, "fajitas", ["rating"], { rating: 4 }, undefined, db);

    expect((await getRecipe(HOUSEHOLD, "fajitas", db)).rating).toBe(4);

    await updateRecipe(HOUSEHOLD, "fajitas", ["rating"], { rating: null }, undefined, db);

    expect((await getRecipe(HOUSEHOLD, "fajitas", db)).rating).toBeNull();
  });

  it("refuses a rating outside 1–5 at the database", async () => {
    await expect(
      updateRecipe(HOUSEHOLD, "fajitas", ["rating"], { rating: 6 }, undefined, db),
    ).rejects.toThrow();
  });
```

In `server/services/isolation.test.ts`, inside `describe("recipes", ...)`, after "will not let one household's update change another's recipe of the same id":

```ts
  it("will not let one household's rating change another's recipe of the same id", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    await updateRecipe(B, "fajitas", ["rating"], { rating: 1 }, undefined, db);

    await expect(getRecipe(A, "fajitas", db)).resolves.toMatchObject({ rating: null });
    await expect(getRecipe(B, "fajitas", db)).resolves.toMatchObject({ rating: 1 });
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/services/recipes.test.ts server/services/isolation.test.ts`
Expected: typecheck-level failure on `{ rating: 4 }` not assignable to `Partial<RecipeInput>`, or, if Vitest runs without type checking, "sets a rating" FAILS with `expected null to be 4`.

- [ ] **Step 3: Implement in `updateRecipe`**

In `server/services/recipes.ts`, change the `input` parameter of `updateRecipe`:

```ts
  input: Partial<RecipeInput> & { rating?: number | null },
```

Add after the `instructions` line in the patch block:

```ts
    if (fields.has("rating")) patch.rating = input.rating ?? null;
```

- [ ] **Step 4: Run the service tests**

Run: `pnpm vitest run server/services/recipes.test.ts server/services/isolation.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route tests**

In `server/api/routes/recipes.test.ts`, inside `describe("PATCH /v1/recipes/{recipe}", ...)`, which already defines `patch(query, body)`:

```ts
  it("sets a rating named in the mask, and returns it", async () => {
    const response = await patch("updateMask=rating", { rating: 5 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ rating: 5 });
  });

  it("rejects a rating outside 1–5", async () => {
    const response = await patch("updateMask=rating", { rating: 6 });

    expect(response.status).toBe(400);
  });
```

In the same file, extend the "creates the recipe and returns an AIP resource name" expectation in `describe("POST /v1/recipes", ...)` with `rating: null`.

- [ ] **Step 6: Run them to confirm they fail**

Run: `pnpm vitest run server/api/routes/recipes.test.ts`
Expected: FAIL. The first test gets 400 "Unknown field(s) in updateMask: rating"; the POST test has no `rating` in the body.

- [ ] **Step 7: Implement in the route and schemas**

In `server/api/schemas.ts`, add to `RecipeSchema` after `instructions`:

```ts
    rating: z.number().int().min(1).max(5).nullable(),
```

In `server/api/routes/recipes.ts`:
- `toRecipeResource`: add `rating: recipe.rating,` after `instructions`.
- `UPDATABLE_FIELDS`: add `"rating",` after `"instructions",`.
- The PATCH route's body schema becomes:

```ts
      body: {
        content: {
          "application/json": {
            schema: RecipeInputSchema.partial().extend({
              rating: z.number().int().min(1).max(5).nullish(),
            }),
          },
        },
      },
```

Run `pnpm typecheck`. Any other producer of `RecipeSchema` now fails to compile for a missing `rating`; add `rating: recipe.rating` there too.

- [ ] **Step 8: Run the route tests and the full suite**

Run: `pnpm vitest run server/api/routes/recipes.test.ts`
Expected: PASS.

Run: `pnpm vitest run`
Expected: PASS. `server/api/app.test.ts` reads `/v1/openapi.json`; the document now carries `rating` on `Recipe`.

- [ ] **Step 9: Commit**

```bash
git add server/services/recipes.ts server/api/schemas.ts server/api/routes/recipes.ts server/services/recipes.test.ts server/services/isolation.test.ts server/api/routes/recipes.test.ts
git commit -m "feat(recipes): set a rating through PATCH /recipes/{recipe}" -m "Refs: #161"
```

---

### Task 3: Rotation reads the recipe's rating

**Files:**
- Modify: `server/services/planning.ts` (`planningRotation`, lines 43–125)
- Test: `server/services/planning.test.ts` (rating tests, lines 182–220)

**Interfaces:**
- Consumes: `schema.recipes.rating` (Task 1), `updateRecipe` with a `rating` mask (Task 2).
- Produces: `RotationEntry.rating` unchanged in type (`number | null`), now sourced from `recipes.rating`. `GET /planning/rotation` does not change shape.

- [ ] **Step 1: Replace the rating tests**

In `server/services/planning.test.ts`, add `updateRecipe` to the `@server/services/recipes` import. Delete these four tests, which set ratings through history:

- "reports no rating for a recipe with history but no rating on any entry"
- "reports the rating from a recipe's only entry"
- "reports the rating from the more recent of two rated entries"
- "falls back to an older rated entry when the most recent entry is unrated, without disturbing lastPlanned"

Keep "reports no rating for a recipe with no history". Add:

```ts
  it("reports the recipe's own rating", async () => {
    await recipe(H, "tacos", "Tacos");
    await recordMeal(H, { date: daysAgo(10), recipeId: "tacos", title: "Tacos" }, db);
    await updateRecipe(H, "tacos", ["rating"], { rating: 5 }, undefined, db);

    expect(await tierOf("tacos")).toMatchObject({ rating: 5, lastPlanned: daysAgo(10) });
  });

  it("reports a rating for a recipe that has never been planned", async () => {
    await recipe(H, "ziti", "Baked Ziti");
    await updateRecipe(H, "ziti", ["rating"], { rating: 2 }, undefined, db);

    expect(await tierOf("ziti")).toMatchObject({ tier: "unplanned", rating: 2 });
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/services/planning.test.ts`
Expected: both new tests FAIL with `rating: null`, because rotation still reads history.

- [ ] **Step 3: Implement**

In `server/services/planning.ts`, inside `planningRotation`:

History select drops `rating`:

```ts
    db
      .select({ recipeId: schema.mealHistory.recipeId, date: schema.mealHistory.date })
      .from(schema.mealHistory)
      .where(eq(schema.mealHistory.householdId, householdId)),
```

Replace the `seen` map, its comment and its loop with:

```ts
  const seen = new Map<string, { last: string; count: number }>();

  for (const entry of history) {
    if (!entry.recipeId) continue;

    const prior = seen.get(entry.recipeId);

    seen.set(entry.recipeId, {
      last: prior && prior.last > entry.date ? prior.last : entry.date,
      count: (prior?.count ?? 0) + 1,
    });
  }
```

Add `rating: recipe.rating,` to `base`, and remove `rating: null,` from the unplanned return and `rating: used.rating,` from the planned return.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run server/services/planning.test.ts server/api/routes/planning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/planning.ts server/services/planning.test.ts
git commit -m "feat(planning): rank on the recipe's own rating" -m "Refs: #161"
```

---

### Task 4: History stops carrying a rating

Precondition: Task 1's migration is committed. This task edits the drizzle `mealHistory` definition and must **not** generate a migration. The database column stays until PR 2.

**Files:**
- Modify: `server/db/schema/history.ts` (remove `rating`, lines 51–52)
- Modify: `server/services/history.ts` (`MealHistoryInput`, `recordMeal`, `rateMeal` → `annotateMeal`)
- Modify: `server/api/routes/history.ts` (resource, POST body, PATCH route)
- Modify: `server/services/week-commit.ts` (`clearSupersededHistory` comment, line 175)
- Test: `server/services/history.test.ts`, `server/services/week-commit.test.ts`, `server/services/isolation.test.ts`

**Interfaces:**
- Produces: `annotateMeal(householdId: string, id: string, fields: { notes?: string | null }, updateMask: string[], db?: Database): Promise<MealHistoryEntry>`. `rateMeal` no longer exists. `MealHistoryInput` has no `rating`. `MealHistoryEntry` has no `rating`. `PATCH /mealHistory/{entry}` accepts only `notes` in its mask; a mask naming `rating` gets 400.

- [ ] **Step 1: Update the tests**

`server/services/history.test.ts`:
- Import `annotateMeal` in place of `rateMeal`.
- Delete "keeps an existing rating when a re-plan does not mention one" and "applies a rating the caller actually sent, rather than ignoring it".
- Replace `describe("rateMeal", ...)` with:

```ts
describe("annotateMeal", () => {
  beforeEach(async () => {
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);
  });

  it("records notes", async () => {
    const entry = await annotateMeal(
      H,
      `${MONDAY}-fajitas`,
      { notes: "kids loved it" },
      ["notes"],
      db,
    );

    expect(entry.notes).toBe("kids loved it");
  });

  it("keeps notes through a re-plan that does not mention them", async () => {
    await annotateMeal(H, `${MONDAY}-fajitas`, { notes: "first" }, ["notes"], db);
    await recordMeal(H, { date: MONDAY, recipeId: "fajitas", title: "Fajitas" }, db);

    expect((await getHistoryEntry(H, `${MONDAY}-fajitas`, db)).notes).toBe("first");
  });

  it("reports a missing entry rather than creating one", async () => {
    await expect(
      annotateMeal(H, "nope", { notes: "x" }, ["notes"], db),
    ).rejects.toBeInstanceOf(MealHistoryNotFoundError);
  });
});
```

`server/services/week-commit.test.ts`: import `annotateMeal` in place of `rateMeal`, and replace "keeps a rating given between two commits of the same week" with:

```ts
  it("keeps notes given between two commits of the same week", async () => {
    const first = await commitWeek(H, WEEK, oneDay(), db);

    await annotateMeal(H, first.historyEntryIds[0], { notes: "kids loved it" }, ["notes"], db);
    await commitWeek(H, WEEK, { replaceExistingDays: true, days: oneDay().days }, db);

    const history = await listHistory(H, {}, db);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ notes: "kids loved it" });
  });
```

`server/services/isolation.test.ts`: import `annotateMeal` in place of `rateMeal`, and replace "will not let one household rate another's meal" with:

```ts
  it("will not let one household annotate another's meal", async () => {
    await expect(
      annotateMeal(B, `${MONDAY}-fajitas`, { notes: "hijacked" }, ["notes"], db),
    ).rejects.toBeInstanceOf(MealHistoryNotFoundError);

    await expect(getHistoryEntry(A, `${MONDAY}-fajitas`, db)).resolves.toMatchObject({
      notes: null,
    });
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/services/history.test.ts server/services/week-commit.test.ts server/services/isolation.test.ts`
Expected: FAIL, `annotateMeal` is not exported from `./history`.

- [ ] **Step 3: Remove `rating` from the drizzle definition**

In `server/db/schema/history.ts`, delete:

```ts
    /** 1–5. Null is the common case: 4 of v1's 61 rows are rated. */
    rating: integer("rating"),
```

Remove `integer` from the `drizzle-orm/pg-core` import if nothing else in the file uses it.

- [ ] **Step 4: Update the service**

In `server/services/history.ts`:
- Delete `rating?: number | null;` from `MealHistoryInput`.
- In `recordMeal`'s `.values({...})`, delete `rating: input.rating ?? null,`.
- In `onConflictDoUpdate`'s `set`, delete the `rating` spread. Replace the second paragraph of the comment above `set` with:

```ts
      // Notes are carried over only when the caller sent them: a re-plan must not wipe notes it
      // knows nothing about.
```

- Replace `rateMeal` and its docstring with:

```ts
export async function annotateMeal(
  householdId: string,
  id: string,
  fields: { notes?: string | null },
  updateMask: string[],
  db: Database = defaultDb,
) {
  const patch: Record<string, unknown> = { updateTime: sql`now()` };

  if (updateMask.includes("notes")) {
    patch.notes = fields.notes ?? null;
  }

  const [entry] = await db
    .update(schema.mealHistory)
    .set(patch)
    .where(and(eq(schema.mealHistory.householdId, householdId), eq(schema.mealHistory.id, id)))
    .returning();

  if (!entry) {
    throw new MealHistoryNotFoundError(id);
  }

  return entry;
}
```

- [ ] **Step 5: Update the route**

In `server/api/routes/history.ts`:
- Import `annotateMeal` in place of `rateMeal`.
- `toResource`: delete `rating: entry.rating,`.
- `EntrySchema`: delete `rating: z.number().int().nullable(),`.
- POST `/mealHistory` body: delete the `rating` line.
- PATCH `/mealHistory/{entry}`: `summary: "Annotate a meal"`, query example `"notes"`, body schema `z.object({ notes: z.string().nullish() })`, the unknown-field filter becomes `fields.filter((field) => field !== "notes")`, and the call becomes `annotateMeal(c.get("householdId"), entry, c.req.valid("json"), fields)`.

- [ ] **Step 6: Fix the `clearSupersededHistory` comment**

In `server/services/week-commit.ts`, line 175, change "the row whose rating this is trying to preserve" to "the row whose notes this is trying to preserve".

- [ ] **Step 7: Confirm no migration was generated and nothing still names the history rating**

Run: `git status --short server/db/migrations`
Expected: no output.

Run: `grep -rn "rateMeal\|mealHistory.rating" server src; grep -n "rating" server/services/history.ts server/api/routes/history.ts server/db/schema/history.ts`
Expected: no output. (`rating: entry.rating` in `server/api/routes/planning.ts` is the rotation resource and stays.)

- [ ] **Step 8: Run the suite and typecheck**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS. The test database still has a `meal_history.rating` column from the migrations; drizzle no longer names it, which is the state production will be in between PR 1 and PR 2.

- [ ] **Step 9: Commit**

```bash
git add server/db/schema/history.ts server/services/history.ts server/api/routes/history.ts server/services/week-commit.ts server/services/history.test.ts server/services/week-commit.test.ts server/services/isolation.test.ts
git commit -m "feat(history)!: move ratings off meal history" -m "PATCH /mealHistory/{entry} accepts only notes, and history entries no longer carry a rating. Rate the recipe with PATCH /recipes/{recipe}?updateMask=rating instead." -m "BREAKING CHANGE: rating is removed from POST /mealHistory, PATCH /mealHistory/{entry} and the MealHistoryEntry resource." -m "Refs: #161"
```

---

### Task 5: Rate from the cook view

**Files:**
- Modify: `server/trpc/routers/index.ts` (add `recipes.setRating`)
- Create: `src/components/recipes/recipe-rating.tsx`
- Create: `src/components/recipes/recipe-rating.test.tsx`
- Modify: `src/components/recipes/cook-view.tsx` (`CookRecipe`, render)
- Modify: `src/components/recipes/cook-view.test.tsx` (fixture and tRPC mock)
- Modify: `src/app/(app)/recipes/[slug]/page.tsx` (pass `rating`)

**Interfaces:**
- Consumes: `updateRecipe` with a `rating` mask (Task 2).
- Produces: tRPC `recipes.setRating` mutation, input `{ recipeId: string; rating: number | null }`. `RecipeRating({ recipeId, initialRating }: { recipeId: string; initialRating: number | null })`. `CookRecipe.rating: number | null`.

- [ ] **Step 1: Add the procedure**

In `server/trpc/routers/index.ts`, add `updateRecipe` to the `@server/services/recipes` import, and add to the `recipes` router after `scale`:

```ts
    setRating: protectedProcedure
      .input(
        z.object({
          recipeId: z.string().min(1),
          rating: z.number().int().min(1).max(5).nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        updateRecipe(
          ctx.householdId,
          input.recipeId,
          ["rating"],
          { rating: input.rating },
          undefined,
          ctx.db,
        ),
      ),
```

- [ ] **Step 2: Write the failing component test**

Create `src/components/recipes/recipe-rating.test.tsx`:

```tsx
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeRating } from "./recipe-rating";

const mutate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  useTRPC: () => ({
    recipes: { setRating: { mutationOptions: () => ({ mutationFn: mutate }) } },
  }),
}));

function renderRating(initialRating: number | null) {
  const user = userEvent.setup();

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <RecipeRating recipeId="fajitas" initialRating={initialRating} />
    </QueryClientProvider>,
  );

  return user;
}

function star(count: number) {
  return screen.getByRole("button", { name: count === 1 ? "1 star" : `${count} stars` });
}

beforeEach(() => {
  mutate.mockReset().mockResolvedValue({});
});

afterEach(cleanup);

describe("rating a recipe", () => {
  it("shows the stored rating as the pressed star", () => {
    renderRating(4);

    expect(star(4)).toHaveAttribute("aria-pressed", "true");
    expect(star(5)).toHaveAttribute("aria-pressed", "false");
  });

  it("applies a tapped star before the request finishes", async () => {
    mutate.mockReturnValue(new Promise(() => {}));
    const user = renderRating(null);

    await user.click(star(3));

    expect(star(3)).toHaveAttribute("aria-pressed", "true");
    expect(mutate.mock.calls[0][0]).toEqual({ recipeId: "fajitas", rating: 3 });
  });

  it("clears the rating when the current star is tapped again", async () => {
    const user = renderRating(3);

    await user.click(star(3));

    expect(star(3)).toHaveAttribute("aria-pressed", "false");
    expect(mutate.mock.calls[0][0]).toEqual({ recipeId: "fajitas", rating: null });
  });

  it("puts the old rating back and says so when the write fails", async () => {
    mutate.mockRejectedValue(new Error("offline"));
    const user = renderRating(2);

    await user.click(star(5));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save that rating.");
    expect(star(2)).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm vitest run src/components/recipes/recipe-rating.test.tsx`
Expected: FAIL, cannot resolve `./recipe-rating`.

- [ ] **Step 4: Implement `RecipeRating`**

Create `src/components/recipes/recipe-rating.tsx`:

```tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";

import { useTRPC } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const STARS = [1, 2, 3, 4, 5] as const;

export function RecipeRating({
  recipeId,
  initialRating,
}: {
  recipeId: string;
  initialRating: number | null;
}) {
  const trpc = useTRPC();
  const [rating, setRating] = useState(initialRating);
  const [failed, setFailed] = useState(false);
  const save = useMutation(trpc.recipes.setRating.mutationOptions());

  function onRate(next: number | null) {
    const previous = rating;

    setRating(next);

    // Callbacks passed to `mutate` fire only for the latest call, so an older failed tap cannot
    // revert a newer one.
    save.mutate(
      { recipeId, rating: next },
      {
        onError: () => {
          setRating(previous);
          setFailed(true);
        },
        onSuccess: () => setFailed(false),
      },
    );
  }

  return (
    <section aria-labelledby="rating" className="mt-6">
      <h2 id="rating" className="text-muted-foreground text-xs">
        Rating
      </h2>

      <div className="mt-1 flex gap-1">
        {STARS.map((star) => (
          <button
            key={star}
            type="button"
            aria-label={star === 1 ? "1 star" : `${star} stars`}
            aria-pressed={rating === star}
            onClick={() => onRate(rating === star ? null : star)}
            className="focus-visible:ring-ring flex size-11 items-center justify-center rounded-lg focus-visible:ring-3 focus-visible:outline-none"
          >
            <Star
              aria-hidden
              className={cn(
                "size-7",
                rating !== null && star <= rating
                  ? "fill-primary text-primary"
                  : "text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>

      {failed ? (
        <p role="alert" className="text-destructive mt-2 text-sm">
          Could not save that rating.
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Run the component test**

Run: `pnpm vitest run src/components/recipes/recipe-rating.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Place it in the cook view**

In `src/components/recipes/cook-view.tsx`:
- Import `RecipeRating` from `./recipe-rating`.
- Add `rating: number | null;` to `CookRecipe` after `sourceUrl`.
- Render `<RecipeRating recipeId={recipe.recipeId} initialRating={recipe.rating} />` between the meta-line block and `<section aria-labelledby="servings" ...>`.

In `src/components/recipes/cook-view.test.tsx`:
- Add `rating: null,` to `RECIPE`.
- Add `setRating: { mutationOptions: () => ({ mutationFn: vi.fn() }) },` beside `scale` in the mocked `recipes`.

In `src/app/(app)/recipes/[slug]/page.tsx`, add `rating: recipe.rating,` to the `CookView` `recipe` prop after `sourceUrl`.

- [ ] **Step 7: Run the recipe component tests and typecheck**

Run: `pnpm vitest run src/components/recipes && pnpm typecheck`
Expected: PASS. `metaLine()` in `cook-view.test.tsx` reads the element after the `h1`; the rating section comes after the meta line, so that helper is unaffected.

- [ ] **Step 8: Commit**

```bash
git add server/trpc/routers/index.ts src/components/recipes/recipe-rating.tsx src/components/recipes/recipe-rating.test.tsx src/components/recipes/cook-view.tsx src/components/recipes/cook-view.test.tsx "src/app/(app)/recipes/[slug]/page.tsx"
git commit -m "feat(recipes): rate a recipe from the cook view" -m "Refs: #161"
```

---

### Task 6: Show ratings in the library

**Files:**
- Modify: `src/components/recipes/recipe-library.tsx`
- Modify: `src/components/recipes/recipe-library.test.tsx`
- Modify: `src/app/(app)/recipes/page.tsx`

**Interfaces:**
- Consumes: `Recipe.rating` (Task 1).
- Produces: `LibraryRecipe.rating: number | null`.

- [ ] **Step 1: Write the failing test**

In `src/components/recipes/recipe-library.test.tsx`, add `rating: 4` to the fajitas entry of `LIBRARY` and `rating: null` to teriyaki and ziti. Add inside `describe("the recipe library", ...)`:

```tsx
  it("shows a rated recipe's rating and leaves an unrated one bare", () => {
    renderLibrary();

    expect(screen.getByRole("link", { name: /Chicken Fajitas/ })).toHaveTextContent(
      "rated 4 of 5",
    );
    expect(screen.getByRole("link", { name: /Baked Ziti/ })).not.toHaveTextContent(/rated/);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run src/components/recipes/recipe-library.test.tsx`
Expected: FAIL, the fajitas link has no "rated 4 of 5".

- [ ] **Step 3: Implement**

In `src/components/recipes/recipe-library.tsx`:
- `import { Star } from "lucide-react";`
- Add `rating: number | null;` to `LibraryRecipe`.
- Replace the right-hand meta span with:

```tsx
                <span className="text-muted-foreground flex shrink-0 items-center font-mono text-xs">
                  {recipe.rating === null ? null : (
                    <>
                      <Star aria-hidden className="size-3" />
                      <span className="sr-only">rated </span>
                      {recipe.rating}
                      <span className="sr-only"> of 5</span>
                      <span aria-hidden>&nbsp;·&nbsp;</span>
                    </>
                  )}
                  {recipe.baseServings} sv
                  {recipe.totalMin === null ? "" : ` · ${recipe.totalMin}m`}
                </span>
```

In `src/app/(app)/recipes/page.tsx`, add `rating: recipe.rating,` to the mapped object.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run src/components/recipes/recipe-library.test.tsx && pnpm typecheck`
Expected: PASS, including the existing `toHaveTextContent(/8 sv$/)` check on the unrated ziti row.

- [ ] **Step 5: Commit**

```bash
git add src/components/recipes/recipe-library.tsx src/components/recipes/recipe-library.test.tsx "src/app/(app)/recipes/page.tsx"
git commit -m "feat(recipes): show each recipe's rating in the library" -m "Refs: #161"
```

---

### Task 7: plan-week reads the recipe's rating

**Files:**
- Modify: `.claude/skills/plan-week/SKILL.md` (step 8, lines 45–48)
- Create or modify: `.claude/skills/plan-week/evals/evals.json`

- [ ] **Step 1: Invoke `cml:writing-skills`** and follow its gates for this edit. This is a reference fact (where `rating` comes from), so it gets a regression case, not a pressure scenario.

- [ ] **Step 2: Replace step 8** with:

```markdown
8. **Ratings.** Each rotation row carries `rating`, the household's 1–5 rating of the recipe.
   Drop mains rated 1–2 from the pool unless the user asks for one; favor 4–5. `rating: null`
   means unrated, not low-rated.
```

- [ ] **Step 3: Add the regression case** the skill asks for: given a rotation row with `tier: "unplanned"` and `rating: 1`, the planner leaves that main out without being asked.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/plan-week
git commit -m "docs(plan-week): ratings come from the recipe" -m "Refs: #161"
```

---

### Task 8: Verify and open PR 1

- [ ] **Step 1: Run the full gate**

```bash
docker compose up -d
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Check it in the browser.** `pnpm db:migrate` on the local database, then start the dev server with `preview_start`. On `/recipes/<slug>`, tap a star, reload, and confirm it is still pressed. Confirm `/recipes` shows the rating on that row. Screenshot both.

- [ ] **Step 3: Review gate.** Invoke `cml:rigorous-review` on `main...feat/recipe-ratings`, since the diff has a migration and a breaking API change. Fix blocking findings and re-run Step 1.

- [ ] **Step 4: Push and open the PR.** Invoke `cml:git-workflow` first. Keep the description to a short summary (a few sentences), including the breaking change to `/mealHistory` and a note that PR 2 drops the column. Use `Refs #161`, not `Closes`, so the issue stays open until PR 2.

- [ ] **Step 5: After merge, confirm production.** The `migrate` job in `.github/workflows/web.yml` is green, and:

```bash
./scripts/prov GET /recipes/teriyaki
```

Expected: `"rating": 5`, carried over from the 2026-06-17 history entry. Repeat for `butter-chicken` (2), `cold-peanut-noodle-salad` (1) and `quickie-red-beans-and-rice` (4).

---

## PR 2: contract

### Task 9: Drop `meal_history.rating`

Start only after Task 8 Step 5 shows production has the backfilled ratings and the PR 1 deployment is live.

**Files:**
- Create: `server/db/migrations/0013_drop_meal_history_rating.sql` (generated)
- Generated: `server/db/migrations/meta/0013_snapshot.json`, `server/db/migrations/meta/_journal.json`

- [ ] **Step 1: Branch from an up-to-date `main`**

```bash
git switch main && git pull && git switch -c feat/drop-history-rating
```

- [ ] **Step 2: Generate the migration**

Invoke `cml:migrations` before generating. Then run: `pnpm db:generate --name drop_meal_history_rating`
Expected: `server/db/migrations/0013_drop_meal_history_rating.sql` contains exactly:

```sql
ALTER TABLE "meal_history" DROP COLUMN "rating";
```

Any other statement means a migration was generated between the two PRs. Stop and reconcile before continuing.

- [ ] **Step 3: Run the gate**

```bash
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: every command exits 0. The Task 1 migration test still passes, because it applies migrations only up to `0012`.

- [ ] **Step 4: Commit, review and open the PR**

```bash
git add server/db/migrations
git commit -m "feat(history): drop the unused meal_history.rating column" -m "Closes #161"
```

Invoke `cml:rigorous-review`, then `cml:git-workflow`, then open the PR with a short summary.

- [ ] **Step 5: After merge, confirm** the `migrate` job is green and `./scripts/prov GET '/mealHistory?withinDays=3650'` still returns 200.

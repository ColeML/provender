# Recipe ratings: rate a recipe in the app

A rating moves from `meal_history` to `recipes`, and the cook view at `/recipes/[slug]` gets a
1–5 star control. The library at `/recipes` shows each recipe's rating. Closes #161.

## Current state

Measured on production, 2026-09-28: 79 history entries, 4 rated, all with notes.

| Date       | Recipe                      | Rating |
| ---------- | --------------------------- | ------ |
| 2026-06-17 | teriyaki                    | 5      |
| 2026-06-23 | butter-chicken              | 2      |
| 2026-08-05 | cold-peanut-noodle-salad    | 1      |
| 2026-08-18 | quickie-red-beans-and-rice  | 4      |

Rating is only possible through `PATCH /v1/mealHistory/{entry}`. `planningRotation` reports each
recipe's rating as the one from its most recent *rated* history entry, tracked separately from
`lastPlanned`.

## Decisions

- **The rating belongs to the recipe.** Any recipe can be rated, including one never planned.
- **History keeps `notes`, loses `rating`.** Notes such as the red-beans can swap describe one
  cooking, so they stay on the entry.
- **Clearing is supported.** Tapping the current star sets `rating` to null.
- **Sorting or filtering the library by rating is out of scope.**

## Data and migration

The `migrate` job in `.github/workflows/web.yml` runs on push to `main`, concurrently with the
Vercel deploy. The outgoing deployment reads history with `select()`, which names
`meal_history.rating`, so dropping the column in the same release fails its requests until the new
deployment is live. The change ships in two PRs.

PR 1's code cannot run before its migration, because the Vercel deploy is live before the `migrate`
job runs, so migration 0013 is applied to production before PR 1 merges.

### PR 1: expand

Migration:

- Add `recipes.rating integer`, nullable, with `CHECK (rating BETWEEN 1 AND 5)`.
- Backfill from each recipe's most recent rated entry, joined on household as well as recipe id:

  ```sql
  UPDATE recipes r
  SET rating = h.rating
  FROM (
    SELECT DISTINCT ON (household_id, recipe_id) household_id, recipe_id, rating
    FROM meal_history
    WHERE rating IS NOT NULL AND recipe_id IS NOT NULL
    ORDER BY household_id, recipe_id, date DESC
  ) h
  WHERE r.household_id = h.household_id AND r.id = h.recipe_id;
  ```

  `(household_id, id)` is the history primary key and `id` is `<date>-<recipeId>`, so no two rows
  tie on date for one recipe.

Code, after which nothing reads or writes `meal_history.rating`:

- `recordMeal`, `rateMeal`, `POST /mealHistory` and `PATCH /mealHistory` drop `rating`. The PATCH
  accepts `notes` only and its summary becomes "Annotate a meal". `rateMeal` is renamed
  `annotateMeal`.
- History responses (`GET /mealHistory`, the entry view in `server/api/routes/history.ts`) drop
  `rating`.
- `rating` leaves the drizzle `mealHistory` definition, while the database column stays until
  PR 2. Drizzle names every column it knows in `select()`, `returning()` and `insert()` — an
  insert sends `default` for each one the caller omitted (`buildInsertQuery` in
  `drizzle-orm/pg-core/dialect.js`) — so the definition is the only place the column can leave
  queries. Order matters: generate this PR's migration first, then remove the column from the
  definition, so PR 2's `pnpm db:generate` produces the drop from the snapshot difference.
- `planningRotation` reads `recipes.rating` and drops the `ratingDate` tracking. The rotation
  response keeps its `rating` field, so `GET /planning/rotation` does not change shape.
- `updateRecipe` and `PATCH /recipes/{recipe}` accept `rating` in `updateMask`, 1–5 or null.
  `GET /recipes` and `GET /recipes/{recipe}` return it.

### PR 2: contract

After PR 1 is deployed: `pnpm db:generate` produces the migration that drops `meal_history.rating`.
No other migration may be generated between the two PRs, or it picks up the drop early.

## UI

- **tRPC.** `recipes.setRating({ recipeId, rating })`, `rating` an integer 1–5 or null, calls
  `updateRecipe` with `updateMask: ["rating"]`.
- **`RecipeRating`** in `src/components/recipes/recipe-rating.tsx`, placed in `CookView` below the
  time and source line, above Servings.
  - A `text-xs` "Rating" label and five lucide `Star` buttons, each at least 44px, labeled
    "1 star" to "5 stars" with `aria-pressed`. Buttons rather than a radio group, because
    unchecking a radio is not standard radio behavior.
  - Filled stars in `primary`; empty stars outlined in `muted-foreground`, which meets 3:1 against
    `background` (WCAG 1.4.11, #130). Not the `ring` gold, which DESIGN.md keeps to one element per
    screen; `primary` is the token every filled control uses.
  - Optimistic update. A failed write restores the previous rating and shows a `role="alert"`
    message.
- **Library.** `LibraryRecipe` gains `rating`. A rated row prefixes the mono meta with a small
  `Star` and the number (`★4 · 6 sv · 30m`), with "rated 4 of 5" for screen readers. An unrated
  row shows nothing extra.
- **Share page.** `/r/[share_token]` picks recipe fields by name, so the rating does not reach it.

## Docs

- `.claude/skills/plan-week/SKILL.md` step 8: `rating` is the recipe's own rating; remove the note
  about `lastPlanned` being newer than `rating`. Edited through `cml:writing-skills`.
- `server/services/week-commit.ts`: the `clearSupersededHistory` comment says it preserves a
  rating; it preserves the entry's notes.

## Testing

- Service, on `createTestDb`:
  - `updateRecipe` sets and clears `rating`; out-of-range values are rejected.
  - Isolation: household A cannot rate household B's `fajitas`, and B's rating is unchanged.
  - `planningRotation` reports `recipes.rating`, including for a recipe with no history.
  - The backfill picks the latest rated entry and does not cross households.
- The week-commit test "keeps a rating given between two commits of the same week" becomes the
  same test for notes, which is what `clearSupersededHistory`'s exclusion still protects. The
  history rating tests are removed.
- Component: setting a rating, clearing it, a failed write reverting with an alert, and the library
  showing and omitting the rating.
- No Playwright test. `playwright.config.ts` runs against a database that must stay empty for the
  empty-state tests, so a rating test would have to create and remove its own recipe through the
  bearer-token API. The service and component tests cover the same path.

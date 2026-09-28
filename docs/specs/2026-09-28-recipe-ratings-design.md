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
- The `meal_history.rating` column stays in the drizzle schema but no query names it. The four
  queries in `server/services/history.ts` that name every column implicitly — `select()` in
  `listHistory` and `getHistoryEntry`, `returning()` in `recordMeal` and `rateMeal` — switch to an
  explicit column list without `rating`, so the drop in PR 2 cannot break the outgoing deployment.
- `planningRotation` reads `recipes.rating` and drops the `ratingDate` tracking. The rotation
  response keeps its `rating` field, so `GET /planning/rotation` does not change shape.
- `updateRecipe` and `PATCH /recipes/{recipe}` accept `rating` in `updateMask`, 1–5 or null.
  `GET /recipes` and `GET /recipes/{recipe}` return it.

### PR 2: contract

After PR 1 is deployed: a migration drops `meal_history.rating`, and the column leaves the drizzle
schema.

## UI

- **tRPC.** `recipes.setRating({ recipeId, rating })`, `rating` an integer 1–5 or null, calls
  `updateRecipe` with `updateMask: ["rating"]`.
- **`RecipeRating`** in `src/components/recipes/recipe-rating.tsx`, placed in `CookView` below the
  time and source line, above Servings.
  - A `text-xs` "Rating" label and five lucide `Star` buttons, each at least 44px, labeled
    "1 star" to "5 stars" with `aria-pressed`. Buttons rather than a radio group, because
    unchecking a radio is not standard radio behavior.
  - Filled stars in `primary`; empty stars outlined in `muted-foreground`, which meets 3:1 against
    `background` (WCAG 1.4.11, #130). No gold: DESIGN.md allows gold on one element per screen.
  - Optimistic update. A failed write restores the previous rating and shows a `role="alert"`
    message.
- **Library.** `LibraryRecipe` gains `rating`. A rated row prefixes the mono meta with a small
  `Star` and the number (`★4 · 6 sv · 30m`), with "rated 4 of 5" for screen readers. An unrated
  row shows nothing extra.
- **Share page.** `/r/[share_token]` picks recipe fields by name, so the rating does not reach it.

## Docs

- `.claude/skills/plan-week/SKILL.md` step 8: `rating` is the recipe's own rating; remove the note
  about `lastPlanned` being newer than `rating`. Edited through `cml:writing-skills`.
- `server/db/schema/history.ts`: remove the `rating` column comment in PR 2.

## Testing

- Service, on `createTestDb`:
  - `updateRecipe` sets and clears `rating`; out-of-range values are rejected.
  - Isolation: household A cannot rate household B's `fajitas`, and B's rating is unchanged.
  - `planningRotation` reports `recipes.rating`, including for a recipe with no history.
  - The backfill picks the latest rated entry and does not cross households.
- Removed: the week-commit test "keeps a rating given between two commits of the same week" and
  the history rating tests. Re-planning no longer touches ratings.
- Component: setting a rating, clearing it, a failed write reverting with an alert, the library
  showing and omitting the rating, and the shared recipe view not rendering one.
- Playwright: rate a recipe, reload, and the rating persists.

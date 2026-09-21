# Commit a week in one transaction, and hold scraped recipes until then

Add `POST /plans/{plan}:commit`, which writes a whole approved week — new recipes, the plan, its
days and their history entries — in one transaction. `plan-week` scrapes into draft files before
the approval gate and sends one call after it, so a rejected week leaves nothing behind and a
failed write leaves nothing half-done.

Closes the writes-before-approval half of #149. The rotation half shipped in #154.

## Why this is now urgent rather than latent

`plan-week` opens with "Nothing is written until the user approves." `add-recipe` step 4 does
`POST /recipes`, a real write, and `scripts/prov` falls back to the production base URL when
`PROVENDER_BASE_URL` is unset — so a workflow run is live data by default.

Sourcing a new dish used to be rare: the planner scraped twice in its entire life. The novelty
quota shipped in #147 and the tiering in #154 make it near-weekly, and the unplanned tier is
shallow for mains — of 46 unplanned recipes, 33 are tagged `side` or `dessert` and only three of
the rest are arguably mains. A five-dinner week therefore draws roughly one main from the library
and scrapes the second. Every rejected week from now on leaves 1-3 recipes in the live library.

The second problem compounds the first. Step 6 is four sequential `prov` calls — recipe, plan, day,
history — in a forced order, and they are not a transaction. `prov` exits non-zero on the first
failure, so a stumble halfway leaves a real plan visible at `/plan/[date]` with days missing.
Moving recipe creation into that sequence makes the window wider, not narrower.

The write order is forced by the schema, not by preference:

- `plan_day_recipes` has a `RESTRICT` foreign key to `recipes`, so a day naming an unsaved recipe
  fails.
- `plan_days` has a foreign key to `plans`, so a day needs its week first.
- `recordMeal` returns 404 for a `planId` whose day does not exist
  (`server/services/history.ts:76`).
- `POST /plans` returns 409 when the week already exists (`server/services/plans.ts:288`).

That last one is the trap: a commit that fails after creating the plan cannot be retried, because
its own plan row now blocks it.

The codebase already holds this position. `db.transaction` has six call sites, and the comment on
the driver choice in `server/db/index.ts` says the WebSocket driver was taken over the cheaper
`neon-http` — against Neon's own guidance for serverless — specifically because writing a week's
plan has to be one transaction. This extends that decision to the whole week rather than one day.

## The endpoint

`POST /plans/{plan}:commit`, matching the custom-verb shape of `/recipes/{recipe}:scale`,
`/recipes:scrape` and `/units:convert`.

```json
{
  "budgetTarget": 120,
  "recipes": [
    {
      "recipeId": "sheet-pan-gnocchi",
      "title": "Sheet-Pan Gnocchi with Sausage",
      "baseServings": 8,
      "sourceUrl": "https://...",
      "totalMin": 30,
      "costEstimate": 14.5,
      "tags": ["quick", "sheet-pan"],
      "instructions": ["..."],
      "ingredients": [{ "ingredientName": "gnocchi", "quantity": 32, "unit": "oz", "category": "pantry" }]
    }
  ],
  "days": [
    {
      "date": "2026-09-22",
      "mealSlot": "dinner",
      "servings": 8,
      "status": "planned",
      "notes": "58F and wet; sheet pan, 30 min",
      "main": "sheet-pan-gnocchi",
      "side": "garlic-green-beans",
      "extras": []
    }
  ]
}
```

| field | meaning |
| --- | --- |
| `budgetTarget` | optional; applied when present |
| `recipes` | recipes to create, each with its ingredients inline. Create-only |
| `days` | the days to write. Same shape as `PUT /plans/{plan}/days/{day}` plus `date` and `mealSlot` |
| `replaceExistingDays` | optional, default `false`. Permits overwriting days already in the plan |

The response reports what was written: the plan, the created recipe ids, the days, and the history
entry ids.

### Semantics

**A re-commit is safe rather than blocked.** The plan is upserted instead of returning 409, and
history upserts on its existing `<date>-<recipeId>` key. A retry after a network stumble is
therefore the same call. This is the behavior that differs from the four calls it replaces, and it
is the point: the 409 on `POST /plans` is what makes today's half-written week unrecoverable
without manual cleanup.

**`recipes[]` is create-only.** A `recipeId` that already exists fails the whole commit with
`ALREADY_EXISTS` naming the collisions. There is deliberately no reuse-on-conflict and no PATCH
path. `add-recipe`'s collision branch PATCHes the existing recipe, which rewrites a saved recipe
nobody asked to change; that branch must be unreachable from planning, and making the endpoint
refuse is what guarantees it rather than skill prose promising it.

**A day absent from `days[]` is untouched.** An unplanned day is the absence of a row, so there is
no blank to write, and a late-planned day added to an existing week must not wipe the days already
there.

**A day already in the plan is refused, not overwritten.** Naming one fails the commit with an
error listing those dates unless the payload sets `replaceExistingDays`. The household edits days
after a week is planned — a note added during planning, or a swap made mid-week on finding a
missing ingredient or less time than expected — so a whole-week commit arriving later would
silently discard real work. The schema already takes this position for the same reason: the
`plan_day_recipes` foreign key to `recipes` is `RESTRICT` rather than `CASCADE` so a delete will
"fail loudly rather than silently empty a day someone is cooking from this week."

Atomicity is what makes refusing affordable. A commit that fails rolls back completely, so a retry
finds no days and needs no flag — the only call that has to opt in is a deliberate re-plan, which
is the case where discarding the old days is the intent.

**Omitting `budgetTarget` on a re-commit leaves the stored target alone.** On first create it falls
back to the household's `default_budget`, which is what `createPlan` does today and why the column
is copied rather than read live.

**History is derived, not supplied.** Each day's `main` produces one `mealHistory` entry, its title
taken from the recipe being written. Two reasons:

- The 404-on-missing-day failure disappears structurally. Days are written before history in the
  same transaction, so the day a history entry names always exists.
- "Record only mains in `mealHistory`, one per cooked day" stops being prose a skill can get
  wrong. It becomes a property of the endpoint.

This honors the invariants either way. Repeat-avoidance is mains-only, and only mains reach
history. `recordMeal`'s upsert carries `rating` and `notes` only when the caller sends them, and a
derived entry sends neither, so a rating given between two commits of the same week survives the
second.

**Shape checks run before the transaction opens**, following the note on `setPlanDay`: a rejected
request should not have taken a write lock first. These need no database:

- `plan` parses as an ISO week, and every `days[].date` falls inside it.
- No two `days[]` entries share a date and slot.
- No two `recipes[]` entries share a `recipeId`.

**The checks that read the database are the transaction's first reads**, not queries run ahead of
it. Both of them decide whether to write based on what is already stored, so running them outside
the transaction would leave a window where the answer changes underneath:

- Every `main`, `side` and `extras` id resolves to either an existing recipe row or an entry in
  `recipes[]`. Without this the `RESTRICT` foreign key rejects the write inside the driver, and the
  handler has no way to turn that into a 400 that names the dish.
- No `days[]` entry names a day already in the plan, unless `replaceExistingDays` is set.

## The service

New file `server/services/week-commit.ts`, the write counterpart to the read-only
`server/services/week-plan.ts`:

```ts
export async function commitWeek(
  householdId: string,
  planId: string,
  input: WeekCommitInput,
  db: Database = defaultDb,
): Promise<WeekCommitResult>
```

It validates, then opens exactly one `db.transaction` and performs the forced order inside it:
plan, recipes, days, history.

Composition follows the pattern `detachHistoryFromDay` already establishes — a function that may
run inside a caller's transaction takes `db: Queryable = defaultDb` and opens none of its own.
`Queryable` exists in `server/db/index.ts` for exactly this. Where a function today owns a
transaction, the write is extracted and the public function keeps its wrapper around the same step,
so no current caller or test changes behavior. Where it owns none, only the parameter widens:

| extracted from | step | note |
| --- | --- | --- |
| `recipes.ts:createRecipe` | `insertRecipe` | keeps the insert-then-check that turns a concurrent create into 409 rather than 500 |
| `plans.ts:createPlan` | `upsertPlan` | new: `onConflictDoUpdate` when `budgetTarget` is present, otherwise leave the row. `createPlan` keeps its 409 for `POST /plans` |
| `plans.ts:setPlanDay` | `writePlanDay` | its plan-existence check stays; inside a commit the plan was upserted in the same transaction, so it passes |
| `history.ts:recordMeal` | widened in place | it opens no transaction today, so only its parameter changes. Its day-existence check then runs against the caller's transaction and sees the day written moments earlier |

No nested transactions.

The route in `server/api/routes/plans.ts` is a thin caller: parse, call, map errors —
`ALREADY_EXISTS` to 409, an unresolvable recipe id or a date outside the week to 400.

## What changes in the skills

**`add-recipe` splits at the write boundary.** Steps 1-3 (scrape, judge what the page could not,
set the servings the household will cook) become the draft half. A new step 4 ends that half by
writing the draft to a file. Step 5 stays exactly as it was for `add-recipe`'s own use: the user
pasted a link, so their paste was the approval, and there is no gate to defer to. A closing note on
step 4 says that a caller which owns an approval gate stops there and hands the draft to that gate.

Both workflows then agree on when a write happens: at the point the user said yes. The
`ALREADY_EXISTS` and PATCH branch stays in step 5, reachable only from the user-pasted path.

**Drafts are files in a gitignored `.provender/drafts/<slug>.json`.** `prov` passes the body to
`curl --data`, which resolves `@file` against the working directory, so drafts written at the repo
root would dirty the tree on every plan. A directory inside the repo rather than an agent-specific
scratch location, because AGENTS.md serves Codex and `agy` as well and they have no equivalent.

No server-side draft storage. A `recipe_drafts` table would need expiry and cleanup, and it would
reintroduce a pre-approval write to a table we had agreed not to count.

**The slug-collision check moves earlier, not past the gate.** `GET /planning/rotation` returns
every recipe for the household unpaginated, with `recipeId` and `title`, and `plan-week` step 1
already fetches it. So the whole catalog is in hand before anything is scraped and the check costs
no call. After each scrape, `plan-week` derives the slug and compares it against rotation:

- A hit means the dish is already saved, so it was never novel. Discard the draft and choose
  another dish — or, when that recipe sits in the `unplanned` tier, plan the saved one directly,
  which is what the novelty rule wanted.
- `plan-week` therefore never sends an existing recipe id, and the endpoint refuses one anyway.

This also settles the `pageSize=200` concern in #149: rotation is not paginated, so there is no
library to read to exhaustion here.

**Step 6 becomes one call.**

```bash
./scripts/prov POST '/plans/2026-W39:commit' @week.json
```

The recipe-plan-day-history order leaves the prose entirely. There is no first failure for a
stumble to land on.

**The skill never sets `replaceExistingDays` on its own.** A refusal naming days already in the
plan gets shown to the user with those dates, because it means either the week was already planned
or those days were edited since. Overwriting them is their call, not the planner's.

**A stale draft cannot reach the library.** `week.json`'s `recipes[]` is assembled by walking the
approved days' `main`, `side` and `extras` ids and including only the drafts those ids name, but
`commitWeek` does not trust the skill to get that walk right: it refuses any `recipes[]` entry no
day names, so a leftover draft the payload includes by mistake fails the commit instead of landing
unapproved. So the re-source path — a draft that missed its day because the user rejected it, or
because the scraped `totalMin` failed the "quick Monday" check after costing — needs no cleanup
step to remember: scrape the replacement, write its draft, rebuild the payload from the approved
week.

This is the shape that worked in #154 and the shape that failed three times before it. Three
attempts to fix the earlier half in skill prose alone all regressed. What worked was moving the
deterministic part into a tested service function and leaving only judgment in the skill. Here the
judgment is the menu, the costing and the parsing; the determinism is the write order, the
referential checks, the history derivation and the collision refusal, all of which move into
`commitWeek`.

## Testing

Service-level vitest in `server/services/week-commit.test.ts`, on `createTestDb`. That helper is
PGlite rather than a stub for this reason: its own comment says a hand-written stub cannot exercise
a transaction rolling back, and that is the property this whole design exists for.

- A new week: five days, two new recipes, history derived from the mains.
- **Rollback.** A payload whose second recipe collides with a saved id. Assert `ALREADY_EXISTS`,
  then assert the first recipe, the plan row, every day and every history entry are absent.
- Re-commit naming an existing day without `replaceExistingDays`: refused, the day's stored
  servings, notes and recipes unchanged, and nothing else in the payload written either.
- Re-commit of the same payload with `replaceExistingDays`: no duplicate history, no second plan,
  and a rating set between the two commits survives.
- Re-commit adding one day the plan does not have: accepted without the flag, and the days already
  there and their recipes are untouched.
- A retry after a rolled-back commit succeeds without the flag, because the failed attempt left no
  days behind. This is the case the refusal must not break.
- Re-commit omitting `budgetTarget`: the stored target is unchanged.
- A day naming a recipe id that neither exists nor appears in `recipes[]`: a named error, nothing
  written.
- A date outside the plan's ISO week: rejected, nothing written.
- Two days sharing a date and slot, and two recipes sharing an id: rejected up front.
- Household isolation, in `server/services/isolation.test.ts` alongside the others. AGENTS.md names
  a missing household filter as the failure that looks normal in review.

Route test for the response shape and the error mapping.

Then fixture reps for the skills, using the harness from #147 — five subagents against a prompt
carrying real `/config`, `/planning/rotation` and `/weather` data. Scored on behavior, not on
reading: does a rejected week write nothing, does an approved week produce exactly one commit call,
and does a scraped slug that collides with a saved recipe get dropped rather than PATCHed. A rule
that reads correctly and fires zero times out of five is the failure mode this guards against.

## Out of scope

Named because #149 raises them and they stay open, not because they are unimportant.

- **The scraper's 503 divergence.** `add-recipe` says stop and ask the user, because there the user
  chose the URL. In `plan-week` the agent chose it, so the same rule halts a run over a link the
  user never saw. That is a judgment rule, not the write boundary.
- **Sides and desserts have no sourcing path** when the catalog lacks one, while every side must be
  a saved recipe linked by id.
- **Ratings ordering.** Ratings live on history entries, not recipes, so a rule ordering mains by
  recency has to avoid making "avoid 1-2" unreachable.
- **Side rotation**, deferred from #154: `mealHistory` records mains only, so sides have no durable
  log to rotate against. Changing that alters a stated AGENTS.md invariant.

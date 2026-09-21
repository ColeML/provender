# Planning rotation: tiers instead of a repeat window

Add `GET /planning/rotation`, a read-only view of the household's cookbook that sorts every
recipe into `unplanned`, `eligible` or `blocked`. `plan-week` reads it instead of fetching
recipes and history separately, and fills a week from `unplanned` first.

Closes the rotation half of #149. The write-before-approval half stays open.

## Why the current design produces a monthly rhythm

Measured on live data, 2026-09-21. 73 history entries, 2026-06-15 to 2026-09-27, 52 distinct
dishes. Gaps between repeats of the same dish, in days:

```
4, 7, 32, 32, 34, 36, 36, 37, 38, 43, 46, 46, 48, 50, 51, 52, 53, 60, 61, 75, 85
```

`no_repeat_days` is 30. Thirteen of the 21 repeats land between 32 and 53 days, so the planner
reaches for a dish as soon as it becomes legal. Meanwhile 46 of 96 saved recipes have never been
planned once — they arrived in the v1 Sheet import (97 recipes created inside 15 seconds on
2026-09-07, commit `eb15fe7`) and nothing has drawn on them since.

The household has been correcting this by hand, asking for different dishes during planning. The
clustering above is what survived those corrections, so the untreated pull is stronger than it
looks.

Three previous attempts to fix this in skill prose regressed. The root cause each time was the
same: a bare `GET /mealHistory` returns exactly `no_repeat_days` of history, so the repeat rule
never had to name a window — the data in hand *was* the exclusion set. Widening the fetch to
`withinDays=3650` removed that boundary and turned the rule into "skip any main ever planned",
which empties the eligible pool for a mature household. Any fix that leaves the window implicit
in prose is exposed to this.

## The endpoint

`GET /planning/rotation` returns every recipe for the household, unpaginated, each carrying:

| field | meaning |
| --- | --- |
| `recipeId`, `title`, `tags`, `totalMin`, `costEstimate` | so no second catalog call is needed |
| `baseServings` | the recipe's stored yield, required when writing a plan day |
| `tier` | `unplanned`, `eligible` or `blocked` |
| `lastPlanned` | ISO date, or `null` when never planned |
| `timesPlanned` | count across all history |
| `daysUntilEligible` | `null` unless `blocked` |
| `rating` | the rating from the most recent *rated* history entry, or `null` when never rated |

`rating` and `lastPlanned` can come from different entries: the latest planning of a dish is not
necessarily the one that was rated.

Tiers:

- **`unplanned`** — no `mealHistory` entry names this recipe. 46 of 96 today.
- **`eligible`** — planned before, and `lastPlanned` is older than `no_repeat_days`.
- **`blocked`** — planned within `no_repeat_days`.

Rows come back sorted (unplanned, then eligible oldest-first, then blocked) for readability, but
**`tier` is the contract and position within a tier means nothing.** Sorting alone would not
help: 46 recipes tie for first, and an agent reading top-down would work through the same
alphabetical head every week, reproducing the sameness one level down.

The endpoint reports; it never enforces. Nothing in the plan write path consults
repeat-avoidance today (`grep` for it across `server/services/plans.ts` and the route is empty),
and that stays true. Asking for a dish inside its window still plans it. This preserves the
AGENTS.md invariant that history records what was *planned*, not eaten, so a repeat skip is a
list to offer rather than a hard exclusion — which is also why `blocked` rows are returned at all
rather than filtered out.

### Decisions inside this

**`lastPlanned` comes from `mealHistory`, not plan days.** History is the durable log; plan rows
get pruned. It also means clearing a day with `keepHistory=false` genuinely returns a dish to
`unplanned`, consistent with what clearing a day means elsewhere.

**All meal slots count.** A recipe planned as a lunch has been eaten and should not read as
never-tried. This differs from the week grid, which is dinners only. Breakfast and lunch planning
is supported but unused by this household today, so the practical effect is small now and correct
later.

**No main/side distinction.** Recipes carry no role column; `tags` has a loose `side` convention
that is not reliable (`chicken-fried-rice` is tagged `main`, `fajitas` is not). Role lives on
`plan_day_recipes.role`, per plan-day. The endpoint therefore returns all recipes and the agent
decides what is a main, keeping fuzzy judgment in the conversation per AGENTS.md.

**A history entry naming a deleted recipe matches nothing.** `mealHistory.recipeId` is
deliberately not a foreign key, so entries outlive their recipes. Such an entry contributes to no
recipe's `lastPlanned` and is silently ignored, which the schema comment already anticipates.

## What changes in plan-week

Step 1 drops `GET '/recipes?pageSize=200'` and `GET /mealHistory` in favour of
`GET /planning/rotation`. `GET /config` and `GET /weather` stay.

- Repeat-avoidance becomes: the `blocked` tier is not planned unless asked, and is offered as a
  list.
- Rotation becomes: fill from `unplanned`, then `eligible` oldest-first.
- The novelty quota (`new_mains_per_week`, shipped in #147) now counts anything in `unplanned`,
  whether it came from the library or the web. The planner takes from `unplanned` before
  scraping, and scrapes when that tier runs dry or the user asks.

  **The tier is shallow for mains.** Of the 46 unplanned recipes, 33 are tagged `side` or
  `dessert`, and of the remaining 13 only three are arguably mains. Measured over five fixture
  reps, a five-dinner week draws one main from the library and scrapes the second, which is the
  rule working rather than failing. The library-first benefit is real for sides and small for
  mains; the variety win for mains comes from ordering the 26 `eligible` ones, not from
  `unplanned`.

No prose in the skill performs date arithmetic or set arithmetic over history.

## Testing

Service-level vitest, following `server/services/history.test.ts`:

- A recipe with no history lands in `unplanned`.
- Boundary: `lastPlanned` exactly `no_repeat_days` ago is `eligible`; one day newer is `blocked`.
- `daysUntilEligible` is `null` for both non-blocked tiers and correct for `blocked`.
- A history entry whose `recipeId` matches no recipe changes nothing.
- A lunch or breakfast entry counts toward `lastPlanned`.
- Household isolation: another household's history does not affect this household's tiers.
  AGENTS.md names a missing household filter as the failure that looks normal in review, and
  `server/services/isolation.test.ts` is the existing home for this.

Route test for the response shape. Then fixture reps for the skill using the harness from #147:
with the new tiering, a planned week should draw mains from `unplanned` and plan no `blocked`
dish unless asked.

## Library cleanup, done separately

A pairwise ingredient comparison across the catalogue found three true duplicates, all unused,
deleted on 2026-09-21 with the household's approval: `watermelon-and-feta-salad`,
`creamy-coleslaw` and `italian-pasta-salad`. Title similarity alone was too noisy to act on
(`Instant Pot Mashed Potatoes` scores 0.68 against `Instant Pot Pulled Pork` purely on the
appliance); ingredient overlap was the usable signal. High-scoring pairs that are deliberate
variants — a from-frozen technique, a potluck-scale batch, Instant Pot against stovetop — were
kept. The remaining 46 unused recipes are genuinely distinct dishes, which is what makes this a
rotation problem rather than a cleanup one.

## Out of scope

- **Side rotation.** Sides repeat far more than mains — across the three surviving weeks of
  plans, mains were 20 distinct over 20 slots while sides were 14 over 18, with
  `simple-green-salad` in all three. But `mealHistory` records mains only, so sides have no
  durable log to rotate against. Recording every role in history is a change to a stated
  AGENTS.md invariant and gets its own issue.
- **Writes before approval.** The other half of #149. The planner has scraped twice in its life,
  so this is a latent risk rather than a present mess, and bundling it is what made the previous
  attempt unreviewable.

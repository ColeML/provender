# plan-week and add-recipe: five fixture reps

Ran 2026-09-21 against the amended skills on `feat/commit-week`. All five criteria passed 5 of 5,
so no skill text changed as a result of this run.

## Method

Five subagents, each given the household's request as it would arrive — "Plan my week. $120, 5
dinners, quick Monday. And find us something new for one night — I'm bored of the rotation." —
and told to follow `.claude/skills/plan-week/SKILL.md`, delegating to
`.claude/skills/add-recipe/SKILL.md` where it says to.

No rep was allowed to call the API. Each printed every `./scripts/prov` command it would run,
prefixed `WOULD RUN:`, and continued from fixture data. `scripts/prov` defaults to the production
base URL, which is the bug under test, so a rep that actually called it would have written to the
live library.

Fixtures are real responses captured the same day: `GET /config`, `GET /planning/rotation`
(95 recipes — 45 unplanned, 26 eligible, 24 blocked) and `GET /weather`. Handed over as files
rather than inlined, since the rotation payload is 29 KB. Week under test: 2026-W39.

The household's reply at step 5 was scripted: **reps 1-3 reject the week**, **reps 4-5 approve it**.
Both branches need measuring — rejection is where a pre-approval write would show up, approval is
where the commit's shape does.

The request includes "find us something new for one night" deliberately. Without it the reps would
not exercise the draft path at all: `new_mains_per_week` is absent from the live config, so the
quota is 2 of 5, and 45 recipes sit in `unplanned`. Three of the five criteria would then pass
vacuously. Asking for something new is the skill's own documented scrape trigger, so this measures a
real path. As it turned out, four of the five reps read the `unplanned` tier as holding no mains and
would have scraped regardless.

## Scores

| # | Branch | 1. No write before approval | 2. One commit call | 3. Drafts held | 4. Collision handling | 5. Payload from approved days |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | reject | pass | n/a | pass | pass | n/a |
| 2 | reject | pass | n/a | pass | pass | n/a |
| 3 | reject | pass | n/a | pass | pass | n/a |
| 4 | approve | pass | pass | pass | pass | pass |
| 5 | approve | pass | pass | pass | pass | pass |

Criteria 2 and 5 only apply where the week was approved, so they rest on two reps rather than five.

- **No write before approval.** No rep emitted `POST /recipes`, `POST /plans`, `PUT /plans/...` or
  `POST /mealHistory` at any point. Reps 1-3 emitted no write at all: their command lists end at
  the scrape and the price lookups, all of which are reads.
- **One commit call.** Reps 4 and 5 each emitted exactly one write,
  `POST '/plans/2026-W39:commit' @week.json`. No per-day `PUT`, no separate recipe create, no
  history call. Rep 4 stated unprompted that history is written by the commit itself.
- **Drafts held.** Every rep followed its scrape with a write to `.provender/drafts/<slug>.json`
  and none with a recipe create.
- **Collision handling.** Every rep checked its derived slug against the rotation catalog from step
  1 and reported no match. No `PATCH /recipes/...` appears in any rep.
- **Payload from approved days.** Both approving reps built `recipes` from the draft their approved
  days named.

## Independent write check

Production held 95 recipes before the reps and 95 after. The `2026-W39` plan present in production
was created 2026-09-20, with `createTime` equal to `updateTime`, so it predates this run and no rep
modified it. The tracked working tree was unchanged.

## What the reps surfaced

**Draft cleanup on rejection is unspecified, and the reps diverged on it.** Rep 1 deleted its draft
after the household rejected the week; reps 2 and 3 left theirs on disk. Both readings are
consistent with the prose, which only tells the agent to delete a draft in the slug-collision case.
Three draft files remained in `.provender/drafts/` after five runs. This cannot affect correctness —
the commit payload is built by walking the approved days, so an unreferenced draft is unreachable —
and the directory is git-ignored. Left as is.

**What counts as a main in the `unplanned` tier is a judgment call.** Reps 1, 3 and 5 read the tier
as holding no mains; rep 2 found one and planned it. The tier is 45 recipes of which 33 are tagged
`side` or `dessert`, so this is the shallowness the rotation design already records, not a rule
failing to fire.

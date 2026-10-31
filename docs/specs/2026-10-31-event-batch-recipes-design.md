# Event batches: a separate recipe, not per-week servings

A dish cooked at a crowd size for one event gets its own recipe id (option A). The saved recipe in
the library stays at the household's size. Option B, which stores servings on each dish of a plan
day and scales at shopping time, is rejected for now.

The library is the household's saved recipes, and each has one stored yield, `baseServings`. In
the ISO week 2026-W44, `homemade-cinnamon-rolls` came back as a 27-roll side for one family dinner.
For the Sept 3 potluck, the saved recipe itself had been tripled to 27 rolls, and nothing scaled
it back. ColeML/provender#217 added a check to the week commit (`POST /plans/{plan}:commit`) and a
step in the plan-week skill that offers a rescale. The production recipe has been rescaled to 9
rolls.

Production already holds two event copies made by hand: `chicken-salad-potluck` at 20 servings and
`italian-grinder-sliders-potluck-3x-batch` at 18. Option A writes that habit down as a rule.

## Comparison

The skills named here are the agent playbooks in `.claude/skills/`. A rebuild is a fresh `PUT` of
the week's shopping list, which keeps the shopper's ticks on rows whose name and unit match.

| | A: event batch is its own recipe | B: servings per linked dish |
| --- | --- | --- |
| AGENTS.md invariant "stored at the servings you'll cook; shopping never re-scales" | Unchanged | Replaced: recipes hold a usual size, each plan-day dish holds a cooked size, and the shopping step scales |
| Non-linear scaling (yeast, spices, eggs) | Done once by the scale-recipe skill when the copy is made, then stored | Redone by the agent on every rebuild, or stored per linked dish, which is a recipe copy kept in another table |
| Commit check (`OversizedSideError`, a side or extra at 3x the day's servings or more) | Kept as is, to catch a crowd batch that reaches a regular day | Compares the dish's own servings instead of the recipe's, or goes away |
| Shopping list rebuild | Unchanged | Calls `:scale` per dish, then corrects. A scaled amount that changes unit (`4/9 cup` to `7⅛ tbsp`) gets a new row id and loses its tick |
| Cook view at `/recipes/[slug]` | Opens at the batch size, which is what is cooked | Opens at the library size unless the day passes its servings to the page |
| Write paths that change | None | `plan_day_recipes`, `:commit`, `PUT /plans/{plan}/days/{date}`, and the `/plan` swap UI |
| Library | One extra recipe per event | No copies |

B fits a household that cooks one dish at many sizes. This household does it for the occasional potluck.
All three crowd-size batches in production history came from potlucks. B rewrites a core invariant and four
write paths for that case.

B's scaling has two possible homes, and both cost more than A. If the agent redoes it on each
rebuild, two rebuilds of one week can disagree. If the corrected list is stored per dish, that is
option A without the recipe page.

## Design

The change is to the skills and AGENTS.md only, with no schema or API change.

In plan-week step 3 (sourcing the recipes), a day planned for an event takes event copies. Its
`status` names the event, such as `potluck`. For each dish on it, follow scale-recipe from the
library recipe to the event count. Save the result as a new draft with the same `sourceUrl` and an
`event-batch` tag.

The draft's slug is `<library-slug>-<event>-<factor>x-batch`, the shape
`italian-grinder-sliders-potluck-3x-batch` already uses. A later event at the same size reuses that
recipe. The draft is committed with the week like any other draft. Never `PATCH` the library recipe
to the event size, because that is how W44 happened.

In plan-week step 2 (choosing the menu), a recipe tagged `event-batch` is not a candidate for a regular day. Offer it
only when the household names an event at the same size. The existing `potluck` tag cannot mark a
copy, because the library `homemade-cinnamon-rolls` carries it too.

When the scale-recipe skill is asked to scale a saved recipe for one event, it makes a copy by the
rule above. It does not offer to write the new size over the original.

The add-recipe and build-shopping-list skills do not change. A new recipe is stored at the
household's size, and the shopping list reads stored quantities.

The AGENTS.md invariant gets one more sentence: "A dish cooked at a crowd size for one event is its
own recipe, tagged `event-batch`. The library recipe keeps the household's size."

`OversizedSideError` stays at 3x as the backstop for a copy that reaches a regular day. The two
existing copies get the `event-batch` tag by a one-time `PATCH ?updateMask=tags` against
production.

## Open questions

A rating or a note left on an event copy does not reach the library recipe. Should the household
accept that, or should plan-week copy the notes across when it makes the batch?

History is keyed by recipe id, so a potluck main does not block its library recipe the next week.
That seems right for a potluck. Confirm it.

The commit check covers sides and extras, not mains. A day's `servings` comes from its main's `baseServings`, so a crowd-size main
on a family day passes the 3x check. Should the commit also refuse an `event-batch` main on a day
whose `status` names no event, such as `potluck`?

B is worth revisiting if event cooking happens more than once a month. The same goes for a request
to set "make this for 12" from the `/plan` screen. Either would make the copies and their drift cost
more than B's rewrite.

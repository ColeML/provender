---
name: plan-week
description: Use when the user says "plan my week", "plan meals", "make a meal plan", or gives constraints like "$120, 5 dinners, quick Monday".
---

# Plan a week

You choose the menu. The API stores it. Nothing is written until the user approves.

## 1. Read the household

```bash
./scripts/prov GET /config
./scripts/prov GET /weather
./scripts/prov GET /planning/rotation
```

`config` carries `people`, `location`, `default_budget`, `default_meals`, `dislikes`, `allergies`,
`dietary_restrictions`, `equipment`, `preferences`, `no_repeat_days`, and optionally
`new_mains_per_week`. Ask only for what the user is overriding. Every value is a string.

`GET /planning/rotation` returns `recipes`, every recipe tiered. `unplanned` has never been
planned, `eligible` is outside `no_repeat_days`, `blocked` is inside it and says when it frees up.
The tier is the answer — do not recompute it from dates. Each row also carries `baseServings`,
the yield the recipe is stored at, which is what a day's `servings` takes in step 6.

## 2. Choose the menu

Apply in order:

1. **Allergies and dietary restrictions** — absolute.
2. **Dislikes** — avoid unless the user asks.
3. **Weather.** Cold or wet → soups, braises, comfort food. Hot → grill, salads, no oven. Match the
   day to its forecast, not the week to an average.
4. **Day preferences.** "Quick Monday" means ≤30 minutes, and say the number.
5. **Equipment honesty.** Cite a device in a day's note only if that recipe uses it. Verify after
   scraping, and change the note rather than the recipe.
6. **Repeat-avoidance, mains only.** Do not plan a `blocked` main. Offer them as a list the
   household can pull from — history records what was *planned*, not what was eaten. Sides may
   repeat freely.
7. **Novelty quota.** `new_mains_per_week` mains come from the `unplanned` tier — saved recipes the
   household already owns and has never planned. Scrape the web only once `unplanned` runs dry, or
   when the user asks for something new. Absent `new_mains_per_week`, the quota is a third of the
   week's mains, rounded up — 2 of 5, 3 of 7.
8. **Ratings.** Each rotation row carries `rating`, the most recent rated entry for that recipe
   (a dish can have a `lastPlanned` newer than its `rating` if the latest planning wasn't rated).
   Drop mains rated 1–2 from the pool unless the user asks for one; favour 4–5. `rating: null`
   means unrated, not low-rated.
9. **Rotation for the rest.** Order whatever the earlier rules left in the pool — oldest
   `lastPlanned` first by default, overridden by weather, time or ingredient overlap. For mains, do
   not reach back into a tier or rating excluded above.
10. **Ingredient overlap.** Bias toward shared ingredients across the week — it cuts cost and
    waste.

## 3. Source the recipes

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

Rotate the source across the week and across weeks — new dishes that all come from one site are
one house style, not exploration:

| Site | Reach for it when |
| --- | --- |
| `budgetbytes.com` | cheap, reliable, the workhorse |
| `theseasonedmom.com` | family dinners, make-ahead |
| `dinneratthezoo.com` | kid-friendly weeknights |
| `thecozycook.com` | comfort food, skillet dinners |
| `damndelicious.net` | fast weeknight one-pots |
| `skinnytaste.com` | lighter mains |
| `saltandlavender.com` | creamy pastas and skillets |
| `therecipecritic.com` | crowd-pleasers |
| `cookingclassy.com` | well-tested standards |
| `gimmesomeoven.com` | casseroles, bakes |
| `thewoksoflife.com` | Chinese |
| `justonecookbook.com` | Japanese |
| `isabeleats.com` | Mexican |
| `themediterraneandish.com` | Mediterranean |
| `feastingathome.com` | seasonal, vegetable-forward |
| `loveandlemons.com` | vegetable-forward |
| `cookieandkate.com` | vegetarian |

The scraper reads schema.org JSON-LD, so any site publishing it works — this is a starting
rotation, not a permitted list.

## 4. Cost the week

Sum the per-recipe estimates. Over budget: swap the most expensive meals and re-estimate. Show the
arithmetic and mark which lines came from `./scripts/prov GET /prices` rather than a guess.

## 5. Present the week and STOP

One line per day: the main, the side, the time, the cost, and why that day. Then the total against
the budget.

Wait for approval. Write nothing yet.

## 6. Save, once approved

Store every recipe at the servings that will be cooked, so the shopping list never has to scale.
A day's `servings` is the main's `baseServings` from step 1, not a number derived from household
size. Where that yield will not cover the leftovers the household expects, say so rather than
writing a larger number the recipe cannot back.

Build one payload and send it once:

```bash
./scripts/prov POST '/plans/<iso-week>:commit' @.provender/week.json
```

`.provender/week.json` carries the whole week:

- `budgetTarget` — the number the week was costed against.
- `recipes` — the drafts held from step 3, each with its `recipeId` (the draft's slug) and its
  ingredients inline. Build this list by walking the approved days' `main`, `side` and `extras`: a
  draft no approved day names does not belong in the payload. A dish the household swapped out
  during review therefore drops out on its own.
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

**`ALREADY_EXISTS` naming a recipe id means that dish is already in the library** — step 3's slug
check missed it, most likely a same-dish-different-slug case add-recipe left to judgment. Drop that
entry from `recipes`, point the day that named it at the existing id instead, and re-commit.
`replaceExistingDays` does not apply here; it only gates the days check, so setting it will not
clear this error and retrying unchanged just repeats it.

## 7. Hand off

Report what was written and the total. Offer **build-shopping-list** next.

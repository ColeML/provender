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
The tier is the answer — do not recompute it from dates.

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
7. **Novelty quota.** Plan `new_mains_per_week` mains from the `unplanned` tier. Absent that key,
   it is a third of the week's mains, rounded up — 2 of 5, 3 of 7. A saved `unplanned` recipe
   counts: work through the household's own unused dishes before scraping, and scrape only when
   that tier runs dry or they ask for something off the web.
8. **Ratings.** Each rotation row carries `rating`, the most recent rated entry for that recipe
   (a dish can have a `lastPlanned` newer than its `rating` if the latest planning wasn't rated).
   Drop mains rated 1–2 from the pool unless the user asks for one; favour 4–5. `rating: null`
   means unrated, not low-rated.
9. **Rotation for the rest.** Order whatever the earlier rules left in the pool — oldest
   `lastPlanned` first by default, overridden by weather, time or ingredient overlap. Do not
   reach back into a tier or rating excluded above.
10. **Ingredient overlap.** Bias toward shared ingredients across the week — it cuts cost and
    waste.

## 3. Source the recipes

A dish the household already has is the cheaper choice, and re-scraping one saves it twice. For
each new main the quota calls for, find a real URL and follow **add-recipe** for scraping,
parsing and pricing.

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

```bash
./scripts/prov POST '/plans?planId=<iso-week>' '{"budgetTarget":<n>}'
./scripts/prov PUT '/plans/<iso-week>/days/<date>' @day.json
./scripts/prov POST /mealHistory @entry.json
```

The plan id is the ISO week (`2026-W37`); each day's date must fall inside it. A day carries
`servings`, `status`, `notes`, `main`, `side`, `extras`.

`mealSlot` defaults to `dinner`, which is what a week of planning writes — lunches here are
leftovers. Pass `breakfast` or `lunch` only when the user asks for that meal specifically; a date
holds one of each, so a second dinner overwrites the first.

**Every side and dessert is a saved recipe, linked by id.** A dish named only in prose is invisible
to the shopping list.

Record only mains in `mealHistory`, one per cooked day.

## 7. Hand off

Report what was written and the total. Offer **build-shopping-list** next.

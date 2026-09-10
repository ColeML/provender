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
./scripts/prov GET /mealHistory
```

`config` carries `people`, `location`, `default_budget`, `default_meals`, `dislikes`, `allergies`,
`dietary_restrictions`, `equipment`, `preferences`, `no_repeat_days`. Ask only for what the user is
overriding.

## 2. Choose the menu

Apply in order:

1. **Allergies and dietary restrictions** — absolute.
2. **Dislikes** — avoid unless the user asks.
3. **Weather.** Cold or wet → soups, braises, comfort food. Hot → grill, salads, no oven. Match the
   day to its forecast, not the week to an average.
4. **Day preferences.** "Quick Monday" means ≤30 minutes, and say the number.
5. **Equipment honesty.** Cite a device in a day's note only if that recipe uses it. Verify after
   scraping, and change the note rather than the recipe.
6. **Repeat-avoidance, mains only.** Sides may repeat freely.
7. **Ratings.** Favour mains rated 4–5; avoid 1–2 unless asked.
8. **Ingredient overlap.** Bias toward shared ingredients across the week — it cuts cost and waste.

`mealHistory` records what was **planned**, not what was eaten. A dish there may never have been
cooked. Present what you are skipping as a list the user can pull from, not a hard exclusion.

## 3. Source the recipes

Start with what is already saved:

```bash
./scripts/prov GET '/recipes?pageSize=200'
```

A dish the household already has is the cheaper choice, and re-scraping one saves it twice. For
anything genuinely new, find a real URL — budgetbytes.com is reliable and cheap — and follow
**add-recipe** for scraping, parsing and pricing.

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

**Every side and dessert is a saved recipe, linked by id.** A dish named only in prose is invisible
to the shopping list.

Record only mains in `mealHistory`, one per cooked day.

## 7. Hand off

Report what was written and the total. Offer **build-shopping-list** next.

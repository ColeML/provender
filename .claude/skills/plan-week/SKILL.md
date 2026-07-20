---
name: plan-week
description: Plan a week of meals to a budget, household size, and per-day preferences, biased by the local weather forecast. Scrapes real recipes, suggests a side per main, estimates cost, and writes the calendar to Google Sheets. Use when the user says "plan my week", "plan meals", "make a meal plan", or gives constraints like "$120, 5 dinners for 4, quick Monday".
---

# Plan a week of meals

You are the meal planner's brain. The `prov` CLI does deterministic work
(scrape, weather, Sheets I/O); you supply all judgment. Run CLI commands with
`uv run prov <cmd>` from the project root. Every command emits JSON.

## 1. Gather constraints

Read household defaults first:

```bash
uv run prov config
```

This gives `people`, `location`, `dietary_restrictions`, `allergies`, `dislikes`,
`default_budget`, `default_meals`, `no_repeat_days` (repeat-avoidance window,
default 30), and (if present) `pantry_staples`, `equipment`, `theme_nights`. Then
confirm with the user, asking only for what's missing or being overridden:

- **Budget** for the week
- **People** to cook for
- **Number of meals / which days** (e.g. 5 dinners Mon–Fri)
- **Per-day preferences** (e.g. "super quick on Monday", "vegetarian Wednesday",
  "leftovers Thursday")
- **Hard limits**: allergies and dietary restrictions are non-negotiable.

## 2. Get the weather

```bash
uv run prov weather
```

Use it to bias the menu: cold/rainy → soups, stews, braises, comfort food; hot →
grilling, salads, no-oven meals; pleasant → anything. Match days to the forecast
(e.g. put the soup on the cold day).

## 2b. Check recent history (avoid repeats)

```bash
uv run prov history-recent
```

This returns meals planned within the repeat-avoidance window — the `Config` key
`no_repeat_days` (defaults to 30 days). **Repeat-avoidance applies to MAIN dishes
only — sides may freely repeat.** Filter the returned rows to `meal_slot ==
"dinner"` (mains) and **do not plan any main that appears there** unless the user
explicitly asks to repeat it. Match by *dish*, not just `recipe_id`: if "Beef
Tacos" was a main 2 weeks ago, don't propose tacos again, even from a different
URL. Garlic bread, rice, salad, etc. as sides are fine to reuse. Pass `--days N`
for a different window (e.g. `history-recent --days 14`). Tell the user what
you're skipping so they can override.

## 3. Design the menu (your judgment)

For each meal slot pick a **main** and a complementary **side** (the user always
wants a side suggested). Apply, in priority order:

1. **Allergies + dietary restrictions** — absolute. Never violate.
2. **Per-day preferences** — "quick Monday" means total time ≤ ~30 min; honor each.
3. **Weather fit** — as above.
4. **Budget fit** — estimate as you go (step 5) and stay under target.
5. **Ingredient overlap** — deliberately reuse ingredients across meals to cut
   cost and waste. Call this out ("cilantro is used Tue + Thu").
6. **Variety** — vary cuisines/proteins across the week unless the user wants
   repetition. Respect any `theme_nights` (e.g. Taco Tuesday).
7. **Leftovers** — when useful, double a recipe and slot the leftovers into a
   later lunch/dinner; mark that day's status as "leftovers".
8. **Equipment honesty** — only cite a device in a day's note if the recipe
   *actually uses it*. If you label a night "Instant Pot" / "slow cooker" /
   "griddle", the chosen recipe's method must match (after scraping in step 4,
   verify this — adapt the method to the device, or change the note to the
   recipe's real method). Never note a device the recipe doesn't use.
9. **Taste** — run `uv run prov history` for past ratings. Favor mains the
   household rated **4–5**; avoid **1–2** unless the user asks. (Ratings differ
   from repeat-avoidance: a 5-star main is welcome back *after* the no-repeat
   window; a 1-star one shouldn't return at all.) After cooking, the user records
   a rating with `uv run prov rate <recipe_id> <1-5> [--notes "…"]`.

## 4. Source real recipes

For each chosen main and side, find a real recipe URL (web search) and scrape it:

```bash
uv run prov scrape "<url>"
```

Prefer scraper-friendly sites — **budgetbytes.com works reliably** and fits a
budget focus; allrecipes / bbcgoodfood / cookieandkate often return 403. If a
scrape fails, try another source. The scraper returns ingredient lines verbatim
in each ingredient's `notes` field with an empty `name`.

**You must parse** each raw ingredient line into structured fields:
`name` (canonical, e.g. "garlic"), `qty` (number or null), `unit`
(e.g. "clove", "g", "cup"), `category` (produce/meat/dairy/pantry/frozen/bakery),
and keep qualifiers like "minced" in `notes`. Also add `tags` (cuisine, "quick",
"vegetarian", …).

## 5. Estimate cost and fit the budget

Price each ingredient in this tier order:

1. **Learned price** — `uv run prov prices`; if an entry matches, use it
   (`price × quantity`). Most accurate (the user's real stores).
2. **Kroger** (opt-in) — if configured, `uv run prov kroger-price "<item>"` returns
   real store prices. **Don't blindly trust `best`** — it's a heuristic that can
   mis-pick (e.g. "chicken breast" → deli slices). Inspect `candidates` and choose
   the raw/generic, non-organic match, or refine the search term
   (e.g. "boneless skinless chicken breast"). Skip silently if not configured.
3. **Estimate** — typical regional prices; treat as rougher.

Sum each recipe into its `cost_estimate`, then sum the week. If over budget, swap
the most expensive meals and re-estimate. Show the math, noting which lines used a
known/Kroger price vs an estimate.

(There's no Walmart/Sam's price API. Encourage the user to record real costs with
`uv run prov price-set "<ingredient>" <price> --unit <u>` so future budgets sharpen.)

## 6. Present for approval — STOP

Show the user a day-by-day plan: each day's main + side, total time, est. cost,
and the running weekly total vs budget, plus a one-line rationale (weather/overlap
/prefs). **Do not write to Sheets until they approve.** Incorporate edits.

## 7. Persist

On approval, **save each recipe at the servings you'll actually cook** so the
recipe page matches the shopping list (don't store the original yield and rely on
the shopping step to scale — that makes the recipe page and shopping list
disagree). Concretely:

- Scale each recipe's ingredients to the cooked servings and set its
  `base_servings` to that number (use `uv run prov scale ... --to N`).
- For **single-batch** recipes (a sheet-pan pizza, a whole roast), don't scale —
  set the plan's `servings` to the recipe's natural yield instead.

Then save every main and side and write the calendar:

**Every side must be saved as its own recipe and linked from its day's
`side_recipe_id`** — even trivial ones (a cucumber salad, steamed edamame, dinner
rolls). Never leave a side as free text in `day_prefs` only: `build-shopping-list`
collects `recipe_id` + `side_recipe_id` + `extras_recipe_ids`, so a side or dessert
that isn't a linked recipe is silently dropped from the grocery list.
`side_recipe_id` is an AppSheet Ref (one recipe), so it holds exactly one side per
day. Any extras beyond that one side — a second side, a dessert — go in
`extras_recipe_ids` as a comma-separated list of recipe ids; save those as recipes
too. That way everything on the day flows into the shopping list.

```bash
# Save each recipe (gives it a recipe_id; note the id from the JSON output)
echo '<recipe-json>' | uv run prov recipe-save -

# Write the week. Provide one row per PLANNED day; plan-write normalizes to the
# 7 fixed day-slots (Mon-Sun, keyed by `day`) and blanks unplanned days itself.
# Each row: {date, day, meal_slot, recipe_id, servings, day_prefs, side_recipe_id, extras_recipe_ids, status}
# extras_recipe_ids: comma-separated recipe ids for any dessert / second side (else "").
# `day` must be a full weekday name ("Monday"…). Stable day keys keep AppSheet in sync.
echo '<weekplan-rows-json>' | uv run prov plan-write -

# Record ONLY the mains in History so they aren't repeated next time. One row per
# main: {date, recipe_id, title, meal_slot: "dinner"}. Do NOT record sides —
# sides are allowed to repeat.
echo '<history-rows-json>' | uv run prov history-add -
```

History **accumulates** (it is not replaced like WeekPlan), so always append the
just-planned mains — that's what makes repeat-avoidance work. Confirm what was
written (recipes saved, days planned, mains added to history) and remind the user
they can run **build-shopping-list** next.

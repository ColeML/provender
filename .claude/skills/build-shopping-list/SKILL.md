---
name: build-shopping-list
description: Use when the user says "build my shopping list", "make the grocery list", or "what do I need to buy", or just after a week is planned.
---

# Build the shopping list

The API stores the list. You do the merging, the aisles, and the prices.

## 1. Read the week

```bash
./scripts/prov GET /plans/<plan>          # e.g. 2026-W37
./scripts/prov GET /config                # pantry_staples
./scripts/prov GET /stores                # where the household shops, and what each is for
./scripts/prov GET /ingredientStores      # ingredients the household buys at a particular store
```

Each day carries `main`, `side` and `extras` — all recipe ids. Collect every one; a side left out
of the plan never reaches the list.

```bash
./scripts/prov GET '/recipes/<recipe>/ingredients'
```

Quantities are already at the servings that will be cooked. Do not re-scale them.

## 2. Merge across recipes

- **Same ingredient, compatible units** → sum. Convert with
  `./scripts/prov POST /units:convert` when needed.
- **Same ingredient, incompatible units** → separate lines. "2 cloves garlic" and "1 tsp garlic
  powder" are different products.
- **Same name, different form** → separate. Fresh and canned tomatoes are not interchangeable.
- **Round up to what a shop sells.** 1.3 onions is 2. 0.6 lb of beef is 1 lb.
- **Convert to how it is bought.** 37 tbsp of butter is 5 sticks; 19 eggs is 2 dozen.

Two lines that resolve to the same name and unit are rejected as a duplicate — merge them before
writing.

## 3. Pick a store for each line

Skip this step when `/stores` is empty; every line goes out with no `store`.

- **An `only` rule is fixed.** The household buys that ingredient there and nowhere else. The API
  enforces it for an exact name match, but match it yourself too when the line is worded
  differently — "whole milk" is the `milk` Braum's sells, so name `store: "braums"` on it.
- **A rule without `only` is the usual store.** Keep it unless the week gives a reason not to:
  that store gets no other line this week, or a learned price elsewhere is much lower.
- **Everything else is your judgment, from each store's `notes`.** They say what the household
  uses a store for — "cheapest produce", "only on Fridays", "skip for meat". A learned price in
  `/prices` names its store too, so compare like for like.
- **Count trips.** Do not send one or two lines to a store nothing else needs this week to save a
  little; put them at the `primary` store. A store an `only` rule already forces a trip to is the
  exception — it is being visited anyway, so its other strengths are in play.
- Leave `store` off a line to let the API decide: the usual store from a rule, then the primary.

## 4. Price each line

In order: a match from `./scripts/prov GET /prices` — at the line's store when there is one —
then `./scripts/prov GET '/kroger/prices?term=<item>'`, then your own estimate. Say which lines
were estimated.

Kroger is opt-in and answers `FAILED_PRECONDITION` when the deployment has no credentials or the
household has picked no store. Skip that tier for the rest of the list the first time it does.
It returns every match, including deli slices for "chicken breast" — pick the one the recipe
meant, or fall through to an estimate.

## 5. Mark what the household already has

Set `haveAlready: true` for anything in `pantry_staples`, and for long-life goods a household that
cooks weekly already owns — flour, sugar, vinegars, dried spices, extracts. These stay on the list
and drop out of the total, so the number reflects the actual shop.

## 6. Write it

```bash
./scripts/prov PUT '/plans/<plan>/shoppingList' @items.json
```

A `PUT` replaces what the plan calls for and leaves alone both the shopper's ticks and anything
they added by hand, so rebuilding after a late-planned day is safe. Each item carries its `store`
id; an unknown one is refused, so use ids from `/stores`.

## 7. Report

Item count, estimated total against the plan's `budgetTarget`, and — when it is over — which lines
are driving it. When the list spans stores, give each store's item count and subtotal, and say
why any store got lines its notes or rules did not call for. Say the list is at `/shop`, where it
can be narrowed to one store.

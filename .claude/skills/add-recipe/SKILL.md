---
name: add-recipe
description: Use when the user pastes a recipe link, or says "save this recipe", "add this recipe", or "scrape this".
---

# Add a recipe

`./scripts/prov` calls the API and prints JSON. Read `./scripts/prov GET /openapi.json` when a
response surprises you, rather than guessing.

## 1. Scrape

```bash
./scripts/prov POST /recipes:scrape '{"url":"<url>"}'
```

Returns a draft and saves nothing: title, image, servings, times, raw `ingredients` lines, steps.

`INVALID_ARGUMENT` means the page publishes nothing machine-readable. Read it yourself and build
the same shape by hand.

`UNAVAILABLE` means the page did not load. Stop and check the URL with the user. The same dish
from elsewhere is a different dish, and ingredients reasoned out from a title are invented —
either writes a recipe into the real library that nobody chose.

## 2. Judge what the page could not

Trust `baseServings` only when `yieldText` says servings. `"1 loaf"` parses to 1, and a recipe
stored at 1 serving multiplies by the target when scaled.

Parse each raw line, so `"2 cloves garlic, minced"` becomes
`{ingredientName: "garlic", quantity: 2, unit: "clove", category: "produce", notes: "minced"}`.

- `category` is `produce`, `meat`, `dairy`, `bakery`, `frozen`, `pantry` or `other` — the shopping
  list groups by it.
- Qualifiers ("minced", "divided") belong in `notes`, so the name stays mergeable. "To taste" is
  `quantity: null`.
- The shopping list keys a row on name plus unit, so reuse the unit a saved recipe already uses
  for that ingredient, or the two lines never merge.
- Add `tags`: cuisine, "quick", equipment, "kid-friendly".
- `costEstimate` covers the whole recipe. Price from `./scripts/prov GET /prices` first, estimate
  the rest, count `config.pantry_staples` as free, and say which lines you estimated. `/prices` is
  what the household actually paid, so a guess does not belong in it.

## 3. Set the servings the household will cook

`./scripts/prov GET /config` holds the household. Derive the target from `people` and
`preferences` — today a main covers next-day lunches at `people` x 2, and a side is 60-65% of
that, so `people` x 1.2 rounded up. Treat a dish that could be either as a main and say so.

A single-batch dish overrides both: a sheet-pan pizza and a whole roast feed what they feed.

Where the target differs from the source's yield, multiply as you parse — spices and leavening are
not linear, eggs and cans round to whole numbers, and times rise when the batch cooks in shifts.
(`:scale` needs a saved recipe, so it cannot help a draft.) The shopping list reads stored
quantities as-is and never re-scales.

## 4. Save

```bash
./scripts/prov GET '/recipes?pageSize=200'
./scripts/prov POST '/recipes?recipeId=<slug>' @recipe.json
./scripts/prov GET /recipes/<slug>/ingredients
```

Read the library to exhaustion — a `nextPageToken` means there is more, and half a library looks
exactly like all of one. `ALREADY_EXISTS` catches an exact slug collision; the same dish under a
different slug is yours to spot. PATCH the one that exists instead:

```bash
./scripts/prov PATCH '/recipes/<slug>?updateMask=title,ingredients' @recipe.json
```

The slug is the title, lowercase and hyphenated. The create response omits the ingredients, so
read them back to confirm they landed.

Report the `recipeId`, the servings, and the cost estimate.

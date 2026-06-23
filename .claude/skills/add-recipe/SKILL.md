---
name: add-recipe
description: Scrape a recipe from a URL, parse its ingredients into structured fields, estimate cost, and save it to the recipe library in Google Sheets. Use when the user says "save this recipe", "add this recipe", "scrape this", or pastes a recipe link to keep.
---

# Add a recipe to the library

Scrape, structure, and persist a single recipe. Run from the project root.

## 1. Scrape

```bash
uv run prov scrape "<url>"
```

Returns JSON with `title`, `source_url`, `base_servings`, `instructions`,
`prep_min`/`cook_min`/`total_min`, and `ingredients` — each ingredient has the raw
line in `notes` and an empty `name`.

If the scrape returns a 403 or empty title, the site is blocking us. Try a
different source for the same dish, or ask the user to paste the ingredients and
steps so you can build the JSON by hand.

## 2. Parse ingredients (your judgment)

Convert each raw line into structured fields:

- `name` — canonical ingredient, e.g. "garlic", "olive oil"
- `qty` — number, or null for "to taste" / "for serving"
- `unit` — "clove", "g", "cup", "tbsp", "can", etc. (empty for countable items)
- `category` — produce / meat / dairy / pantry / frozen / bakery / other
- `notes` — qualifiers like "minced", "divided", "room temperature"

Example: `"2 cloves garlic, minced"` →
`{"name":"garlic","qty":2,"unit":"clove","category":"produce","notes":"minced"}`.

## 3. Enrich

- Add `tags`: cuisine, and any of "quick" (≤30 min total), "vegetarian", "vegan",
  "one-pot", "freezer-friendly", "kid-friendly" that apply.
- Add `cost_estimate`: total estimated cost from the ingredients at typical US
  grocery prices.

## 4. Save

```bash
echo '<recipe-json>' | uv run prov recipe-save -
```

If you don't set `recipe_id`, one is generated from the title. Report the saved
`recipe_id` and ingredient count so the user can reference it later in a plan.

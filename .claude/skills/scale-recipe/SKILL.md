---
name: scale-recipe
description: Scale a recipe up or down to a target number of servings, correcting for ingredients that don't scale linearly (spices, salt, leavening), rounding discrete items, and adjusting cook time and pan size. Use when the user says "scale this recipe", "double this", "make it for N people", or "halve this".
---

# Scale a recipe intelligently

`uv run prov scale` does the linear math; **you** correct the parts that don't
scale linearly. Run from the project root.

## 1. Get the recipe

- If the user gives a URL: `uv run prov scrape "<url>"` (then parse the raw
  ingredient lines into qty/unit/name as in the **add-recipe** skill).
- If it's already saved: `uv run prov recipes` to find the id, then
  `uv run prov ingredients --recipe-id "<id>"`.
- If they paste a recipe: build the JSON yourself.

## 2. Linear baseline

```bash
echo '<recipe-json>' | uv run prov scale - --to <target_servings>
```

This multiplies every numeric quantity by `target / base_servings` and preserves
"to taste" items. If `base_servings` is unknown the factor is 1.0 — ask the user
what the original yield was rather than mis-scaling.

## 3. Apply judgment (the important part)

Adjust the linear output:

- **Spices, salt, dried herbs, chili** — scale sublinearly. Doubling rarely means
  double the cayenne; start ~1.5× and say "season to taste".
- **Leavening** (baking soda/powder, yeast) — scales roughly linearly but round to
  practical measures; flag that big batches can behave differently.
- **Discrete items** — eggs, cans, cloves, slices: round to whole numbers and say
  so (e.g. "1.5 eggs → use 2, or 1 egg + 1 yolk").
- **Salt in baking / brines** — closer to linear than table seasoning; use context.
- **Cook time** — does NOT scale with quantity, but **pan size and depth do**.
  Note when a doubled batch needs a larger/second pan, longer roast time, or
  cooking in batches.
- **Liquids for reduction** — reductions don't scale linearly with time.

## 4. Convert units when it helps

```bash
uv run prov convert <qty> <from_unit> <to_unit>
```

Convert awkward amounts to practical ones (e.g. 6 tsp → 2 tbsp, 16 tbsp → 1 cup).

## 5. Present

Show the scaled ingredient list with any judgment notes inline, plus adjusted
cook-time / pan-size guidance. Offer to save it (`recipe-save`) if it's a new
variant the user wants to keep.

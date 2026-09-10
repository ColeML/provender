---
name: scale-recipe
description: Use when the user says "scale this recipe", "double this", "halve this", or "make it for N people".
---

# Scale a recipe

The API does the arithmetic. You correct what does not scale linearly.

## 1. Scale

```bash
./scripts/prov GET /recipes/<recipe>/ingredients
./scripts/prov POST '/recipes/<recipe>:scale' '{"targetServings":<n>}'
```

Read the base list too — step 2 is you overriding this arithmetic, so you need the numbers it
started from. Scaling writes nothing. Volumes snap to measurable amounts and may change unit —
`4/9 cup` comes back as `7⅛ tbsp`.

For a recipe not in the library, scale it by hand at the factor and apply the same corrections.

## 2. Correct the linear output

Multiplying everything by the factor is wrong for:

- **Spices, salt, dried herbs, extracts** — scale to roughly 60–75% of linear when doubling or
  more. Doubling cayenne doubles the heat, not the seasoning.
- **Leavening** (baking powder, soda, yeast) — under 1.5× linear, or the crumb collapses.
- **Discrete items** (eggs, cans, cloves) — round to whole. 2.6 eggs is 3.
- **"To taste"** — leave it alone.
- **Cooking fat for a pan** — scales with the pan's area, so it is linear per batch. Three
  skillet-loads need three times the butter; one wider pan needs far less than three times.
- **An ingredient that is both the seasoning and the sauce** (soy sauce, stock, a marinade) keeps
  its volume: the food needs the liquid to coat. Cut the salt by choosing a lower-sodium version,
  not a smaller pour.
- **Notes** were written against the base servings, so "start with 4-5 tbsp" is wrong the moment
  the amount changes. Re-read every note and restate it at the new count.

## 3. Adjust time and vessel

- Baking: same temperature, different pan. Say which pan, and expect a longer bake in a deeper one.
- Braising and slow cooking: a larger volume takes longer to come to temperature; time rises well
  under linearly.
- Searing and sautéing: cook in batches rather than crowding, and say so.

## 4. Convert only where it helps

```bash
./scripts/prov POST /units:convert '{"quantity":<n>,"from":"<unit>","to":"<unit>"}'
```

Worth doing once an amount stops being measurable as given — 24 tbsp is 1½ cups, 48 oz is 3 lb.
Round what you show: the conversion is exact, so `18 tbsp` comes back as `1.1249999999999998`.

Volume and mass do not interconvert without a density.

## 5. Present

Show the scaled list with every correction marked and its reason in a few words. State the factor,
the new servings, and any time or pan change. Say plainly which lines you overrode and why.

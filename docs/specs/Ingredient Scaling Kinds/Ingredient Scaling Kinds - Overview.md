# Ingredient scaling kinds: non-linear scaling in the servings stepper

Each ingredient gets a scaling kind, and `scaleQuantity` in `server/lib/units.ts` applies a fixed
curve for that kind. A braced step amount names its ingredient, as in `{1 tsp|cumin}`, so the step
follows the same curve as the ingredient list. The agent picks the kind once, when it saves the
recipe. The API does the arithmetic on every scale, so the cook view's servings stepper and
`POST /recipes/{recipe}:scale` give the same answer every time.

Today every amount scales linearly. Doubling a recipe doubles its cayenne and its yeast, and only
the scale-recipe skill corrects that, by judgment, on each run.

## Scaling kinds

| Kind | Covers | Scaling up (factor f > 1) | At 2x | At 3x |
| --- | --- | --- | --- | --- |
| `linear` | everything else | f | 2x | 3x |
| `seasoning` | spices, salt, dried herbs, extracts | f^0.6 | 1.5x | 1.9x |
| `leavening` | yeast, baking powder, baking soda | f^0.8 | 1.7x | 2.4x |
| `whole` | eggs, cans, cloves | f, then rounded | 2x | 3x |

- Scaling down (f < 1) is linear for every kind, so a half batch is never over-seasoned.
- `whole` rounds to the nearest whole number, with halves rounding up and a minimum of 1.
- The exponents are kitchen rules of thumb, not measured values.
- Volume snapping (`cup`, `tbsp`, `tsp` to a measurable fraction) runs after the curve, as it does
  now after the linear multiply.
- An ingredient with no quantity ("salt, to taste") passes through unchanged.

## Data and contract changes

The migration adds an enum column to the `ingredients` table, which holds 1,197 rows in production:

```sql
CREATE TYPE "ingredient_scaling" AS ENUM ('linear', 'seasoning', 'leavening', 'whole');
ALTER TABLE "ingredients" ADD COLUMN "scaling" "ingredient_scaling" DEFAULT 'linear' NOT NULL;
```

A constant default lets Postgres add the column without rewriting the table. Every row reads as
`linear`, so the migration changes no scaled amount on its own.

`IngredientInput` gains a required `scaling` field on each of the four paths that write
ingredients:

- `POST /recipes`
- `PATCH /recipes/{recipe}` with `ingredients` in the update mask, which replaces the whole list
- `POST /recipes/{recipe}/ingredients`
- the recipes inside `POST /plans/{plan}:commit`

It is required because a full-list `PATCH` would otherwise reset every classified ingredient to
`linear` whenever a caller left the field out. Plan-week's rescale and the "skip the olives" edit
both send the full list. `Ingredient` responses and each line of the `:scale` response gain
`scaling` too.

Ingredients in one recipe that share a name must share a kind. A write that breaks this is refused
with `INVALID_ARGUMENT`. Three production recipes repeat a name: `homemade-cinnamon-rolls`,
`griddle-breakfast-for-dinner` and `italian-grinder-sliders-potluck-3x-batch`.

## Step links

A brace may end with `|` and an ingredient name: `Whisk {1/3 cup|mayonnaise} mayonnaise`.

- `parseStep` in `server/lib/step-quantities.ts` returns the link with the amount. The cook view
  and the share page at `/r/[token]` show the amount and never the link text.
- The name matches an ingredient of the same recipe, ignoring case. Because same-named ingredients
  share a kind, a repeated name still gives one curve.
- A link that matches no ingredient is refused with `INVALID_ARGUMENT`, the same way
  `malformedQuantity` refuses a malformed brace today.
- A brace with no link stays valid and scales linearly, so recipes written before this change
  keep working.

The link fixes only the curve. The step keeps its own amount, because a step often uses part of an
ingredient ("half the butter").

## Cook view

A muted line under the stepper reads "Spices and leavening scale by less than the servings". It
shows only when the stepper is above the base servings and a `seasoning` or `leavening`
ingredient has a quantity. Lines carry no marks of their own.

## Skills and AGENTS.md

- **add-recipe** sets `scaling` on every ingredient and writes a link in every brace.
- **scale-recipe** drops its spice, leavening and egg rules, since `:scale` now applies them. It
  keeps pan fat, sauces that also season, ingredient notes, and time and pan size.
- **plan-week** and the recipe-note flow carry `scaling` through every ingredient list they send.
- **AGENTS.md** replaces "nothing links the two" in the brace invariant with the link rule, and
  adds that `scaling` is required on every ingredient write.

## Backfill

After the release, a one-off agent pass covers all 125 production recipes. It sets each
ingredient's `scaling` and adds a link to each of the 69 braces in 29 recipes. The pass writes its
proposed changes to a file for review, and nothing is sent until the household approves it. Until
the pass runs, every recipe scales as it does today.

## Rejected alternatives

- **A tag on the brace, `{1 tsp:seasoning}`.** It repeats the ingredient's kind in every step, and
  the two copies can disagree.
- **A link by ingredient id, `{1 tsp|ziti_cumin}`.** It is exact, but unreadable in a step.
- **A position suffix for repeated names, `{2 tbsp|butter#2}`.** Reordering the ingredient list
  silently relinks it.
- **Classification by a name list in the migration.** Anything named "salt" becomes seasoning, but
  "Italian seasoning" and "chili powder blend" are missed. Classifying is judgment, so the agent
  does it.
- **Curving when scaling down.** A half batch with extra salt is worse than one with slightly too
  little.

## Out of scope

Ingredient notes such as "start with 4-5 tbsp" stay as written. They are free text with no
marking scheme.

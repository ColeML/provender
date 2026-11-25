# Ingredient Scaling Kinds - Ticket Breakdown

Three issues, in dependency order. The design is in
[Ingredient Scaling Kinds - Overview](Ingredient%20Scaling%20Kinds%20-%20Overview.md).

## 1. Spices and leavening scale by less than the servings

- **Type:** Story
- **Why:** A doubled recipe on the cook view gets 1.5x the cayenne and 1.7x the yeast, not 2x, and
  the numbers are the same every time.
- **Size:** M
- **Blocks:** none

Acceptance criteria:

- The migration adds `ingredients.scaling` (`linear`, `seasoning`, `leavening`, `whole`), defaulting
  to `linear`. Every existing amount scales as it did before.
- `:scale` and the cook view stepper apply f^0.6 to `seasoning` and f^0.8 to `leavening` when
  scaling up, round `whole` to the nearest whole number with a minimum of 1, and stay linear when
  scaling down. `Ingredient` and `:scale` responses include `scaling`.
- `POST /recipes`, a recipe `PATCH` that replaces ingredients, `POST /recipes/{recipe}/ingredients`
  and the recipes in `:commit` refuse an ingredient without `scaling` with `INVALID_ARGUMENT`.
- A write where two ingredients share a name but not a kind is refused with `INVALID_ARGUMENT`.
- The cook view shows "Spices and leavening scale by less than the servings" under the stepper only
  when scaled up and a `seasoning` or `leavening` ingredient has a quantity. Checked at 375px in
  light and dark.
- The add-recipe, scale-recipe and plan-week skills and AGENTS.md carry `scaling` as the design
  says. The add-recipe change is checked over 5 runs.

## 2. Step amounts follow their ingredient's curve

- **Type:** Story
- **Why:** A step that says `{1 tsp|cumin}` shows the same scaled amount as the cumin line, so the
  steps and the ingredient list never disagree.
- **Size:** S
- **Blocks:** 1

Acceptance criteria:

- `parseStep` reads an optional `|name` in a brace, and the step scales with that ingredient's kind.
  The cook view and the share page show the amount without the link text.
- A link naming no ingredient of the recipe is refused with `INVALID_ARGUMENT`. A name matches
  ignoring case.
- A brace with no link stays valid and scales linearly.
- The add-recipe skill writes a link in every brace, checked over 5 runs. AGENTS.md states the link
  rule in place of "nothing links the two".

## 3. Classify the production library

- **Type:** Task
- **Why:** The 125 saved recipes get the new scaling, instead of staying linear until each is edited.
- **Size:** M
- **Blocks:** 1, 2

Acceptance criteria:

- An agent pass proposes `scaling` for all 1,197 production ingredients and a link for each of the
  69 braces in 29 recipes, written to a file for review.
- Nothing is sent to production until the household approves the file.
- After approval, each recipe is updated with one `PATCH`, and a read-back shows every ingredient
  classified and every brace linked.
- No write is refused. A refused one, such as a repeated name with two kinds, is fixed in the file
  and re-sent.

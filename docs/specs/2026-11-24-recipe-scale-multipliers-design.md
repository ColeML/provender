# Recipe scaling: multiples of the recipe, not one serving at a time

The −/+ stepper on the cook view at `/recipes/[slug]` moves the recipe by **half a batch** per tap
(½× → 1× → 1½× → 2× …) instead of by one serving. It matches how a cook thinks at the stove:
"half a batch", "double it", not "eleven servings".

**Status: shaped.** Built on `ccr-fe229bd6-xabyyz` (`cook-view.tsx`, the tRPC `scale` input, and
tests). The questions raised while shaping were settled as recommended, below. A first build used a
row of ½×–3× buttons; it was dropped for the stepper's look after seeing it on the page.

## Current state

- `CookView` holds `servings`, starting at `baseServings`. − and + move it by one, between 1 and
  500, and "Reset to N" appears once it differs from the stored count.
- Any count other than the stored one calls tRPC `recipes.scale({ recipeId, targetServings })`,
  which takes a whole number from 1 to 500. `scaleRecipe` turns it into
  `factor = target / base` and applies each ingredient's curve, braced step amounts included.
- Going from 4 to 8 servings takes four taps. Halving a 5-serving recipe is not possible at all,
  since 2.5 is not a whole number.
- The share page `/r/[share_token]` has no scale control, because tRPC needs a session.
  `POST /v1/recipes/{recipe}:scale`, which the `scale-recipe` skill uses, takes a whole number.

## Decisions

- **The control is the multiplier, not the count.** State is `multiplier`, starting at 1, and
  `servings = baseServings × multiplier`. − and + move it by ½, the − stopping at ½× and the +
  disabled where the next step would pass the 500-serving cap, so a large-batch recipe never asks
  for a count the API refuses.
- **The stepper keeps its look.** The same 44px −/+ buttons as before, labeled "Smaller batch" and
  "Bigger batch", with the multiplier between them (`aria-live="polite"`). "Reset to 1×" appears
  once it is not 1×. 1× is the stored recipe and makes no request.
- **No upper multiple beyond the cap.** A batch past 3× is better saved as its own recipe at that
  count (recipes are stored at the servings you cook), but the stepper does not forbid it.
- **Halves are allowed in the count.** The tRPC input becomes `multipleOf(0.5)`, still capped at
  500, so ½× of 5 asks for 2.5. It is displayed as "Makes 2½ servings" through `formatQuantity`.
  Only halves, because every multiplier is a multiple of ½ and the base is whole.
- **The REST endpoint stays whole-number.** The skill scales to a head count, which is whole, and
  widening a public schema nobody asked for only adds a case to test.
- **The count is shown, not hidden.** "Makes N servings" sits under the stepper, because the
  ingredient amounts only make sense against it.
- **Nothing else moves.** The curve note ("Spices and leavening scale by less…") still shows only
  when scaled up, the stale "still for N, scaling…" warning and error alert are unchanged, and
  crossed-off rows survive a change of multiplier.

## Settled while shaping

- **Halves replace single servings.** "Make it for 6" from a 4-serving recipe is no longer
  possible on the page; 1½× is the closest. An exact head count is the `scale-recipe` skill's job.
- **½× leaves `whole` ingredients linear.** 1 egg shows as ½ egg and the cook decides. `curved()`
  in `server/lib/units.ts` is unchanged, so the skill's `:scale` and its SKILL.md curve description
  are too.
- **The choice does not persist.** Every visit opens at 1×, as the stepper did. A household that
  always doubles a dish should store it at that count, which is what the invariants ask for.

## Testing

- `CookView`: opens at 1× and "Makes 8 servings" with no reset link; + and − step by halves
  (1½× is 12, 2× is 16, ½× is 4); ½× of a 5-serving recipe asks for 2.5 and shows "Makes 2½
  servings"; − stops at ½× and reads "½ serving" on a 1-serving recipe; + stops at 500 servings;
  "Reset to 1×" shows the stored amounts without another request. The existing stale, error,
  curve-note and cross-off tests move to "Bigger batch" and "Smaller batch".
- No Playwright test, for the reason the ratings change gave. Walked by hand on a dev server at
  375px in light and dark: ½× and 2× on a 5-serving recipe, steps scaling with ingredients, the
  + stopping on a 200-serving recipe, no console errors, no horizontal scroll.

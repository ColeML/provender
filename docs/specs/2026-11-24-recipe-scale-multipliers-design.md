# Recipe scaling: multiples of the recipe, not one serving at a time

The cook view at `/recipes/[slug]` scales by **½× · 1× · 1½× · 2× · 3×** instead of a −/+ stepper
that moves one serving per tap. A recipe site offers it this way, and it matches how a cook
thinks at the stove: "half a batch", "double it", not "eleven servings".

**Status: shaped.** Built on `ccr-fe229bd6-xabyyz` (`cook-view.tsx`, the tRPC `scale` input, and
tests). The questions raised while shaping were settled as recommended, below.

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
  `servings = baseServings × multiplier`. A multiple that would pass the 500-serving cap is
  disabled, so a large-batch recipe never asks for a count the API refuses. 1× is the stored recipe and makes no request, which is
  what "Reset to N" did, so the reset link goes.
- **The choices are ½×, 1×, 1½×, 2×, 3×.** Five 44px buttons fill a 375px row at `flex-1`. ¼× and
  4× were left out: a quarter batch is rarely worth cooking, and anything past 3× should be planned
  as its own recipe at that count (recipes are stored at the servings you cook).
- **Halves are allowed in the count.** The tRPC input becomes `multipleOf(0.5)`, still capped at
  500, so ½× of 5 asks for 2.5. It is displayed as "Makes 2½ servings" through `formatQuantity`.
  Only halves, because every multiplier times a whole base is a multiple of 0.5.
- **The REST endpoint stays whole-number.** The skill scales to a head count, which is whole, and
  widening a public schema nobody asked for only adds a case to test.
- **The count is shown, not hidden.** "Makes N servings" sits under the row, because the
  ingredient amounts only make sense against it.
- **Pressed state, not a radio group.** Each button carries `aria-pressed`, like the rating stars,
  inside a `<fieldset aria-label="Scale recipe">` (oxlint prefers it to `role="group"`). The
  selected one is `bg-primary text-primary-foreground`; the rest have a `muted-foreground` border,
  since `border` alone is below 3:1 and a control needs a visible edge (DESIGN.md).
- **Nothing else moves.** The curve note ("Spices and leavening scale by less…") still shows only
  when scaled up, the stale "still for N, scaling…" warning and error alert are unchanged, and
  crossed-off rows survive a change of multiplier.

## Settled while shaping

- **The multipliers replace the stepper.** "Make it for 6" from a 4-serving recipe is no longer
  possible on the page; 1½× is the closest. An exact head count is the `scale-recipe` skill's job.
  If the stepper is missed, a small −/+ beside "Makes N servings" is the way back.
- **½× leaves `whole` ingredients linear.** 1 egg shows as ½ egg and the cook decides. `curved()`
  in `server/lib/units.ts` is unchanged, so the skill's `:scale` and its SKILL.md curve description
  are too.
- **The choice does not persist.** Every visit opens at 1×, as the stepper did. A household that
  always doubles a dish should store it at that count, which is what the invariants ask for.

## Testing

- `CookView`: the five buttons in order with 1× pressed and "Makes 8 servings"; 2× asks for 16;
  ½× of a 5-serving recipe asks for 2.5 and shows "Makes 2½ servings"; back to 1× shows the stored
  amounts without another request. The existing stale, error, curve-note and cross-off tests move
  from "More/Fewer servings" to "2×" and "½×".
- No Playwright test, for the reason the ratings change gave. Walked by hand on a dev server at
  375px in light and dark: ½× and 3× on a 5-serving recipe, steps scaling with ingredients, no
  console errors, no horizontal scroll (done on this build).

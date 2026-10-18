/** The border is muted-foreground, not `border`: the field's edge has to clear 3:1 on the page. */
export const FIELD =
  "border-muted-foreground bg-background focus-visible:ring-ring placeholder:text-muted-foreground h-11 rounded-lg border px-3 text-base focus-visible:ring-3 focus-visible:outline-none";

/**
 * A native checkbox for a form, wrapped in its label so the whole row is the target. Native rather
 * than the `Checkbox` primitive because a label wrapping the primitive with other markup beside it
 * fails `label-has-associated-control`: lint cannot see the hidden input the primitive renders.
 */
export const CHECKBOX =
  "accent-primary focus-visible:ring-ring size-5 shrink-0 rounded focus-visible:ring-3 focus-visible:outline-none";

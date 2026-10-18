/**
 * The identifier form of a name: lowercase, with runs of anything else collapsed to a hyphen.
 *
 * Shopping list item ids are built from this, and `/shop` uses it to recognise that "Brown Sugar"
 * is the brown sugar already on the list. Both sides read the same function so they cannot
 * disagree about what counts as the same name.
 */
export function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

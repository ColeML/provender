/**
 * Quantities read as fractions, because that is how a recipe is written.
 *
 * Keyed on the decimal remainder. Thirds and two-thirds carry both the rounded and the truncated
 * form, since a scaled quantity arrives as either.
 */
const FRACTIONS: Record<string, string> = {
  "0.125": "⅛",
  "0.25": "¼",
  "0.33": "⅓",
  "0.333": "⅓",
  "0.375": "⅜",
  "0.5": "½",
  "0.625": "⅝",
  "0.66": "⅔",
  "0.667": "⅔",
  "0.67": "⅔",
  "0.75": "¾",
  "0.875": "⅞",
};

/** A stored number and unit as a cook would read them: `3.5, "lb"` becomes `3½ lb`. */
export function formatQuantity(quantity: number | null, unit: string | null) {
  if (quantity === null) {
    return unit ?? "";
  }

  const whole = Math.floor(quantity);
  const remainder = Number((quantity - whole).toFixed(3));
  const fraction = FRACTIONS[String(remainder)];

  const amount = fraction
    ? `${whole > 0 ? whole : ""}${fraction}`
    : String(Number(quantity.toFixed(2)));

  return unit ? `${amount} ${unit}` : amount;
}

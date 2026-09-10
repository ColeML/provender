/**
 * Kitchen unit conversion.
 *
 * A local table rather than a library. v1 used `pint`, whose dimensional analysis covers all of
 * physics; what this needs is about twenty constants for volume and mass. A table keeps the
 * factors visible and testable, and adds no dependency for the sake of arithmetic.
 *
 * Volumes are US customary, matching v1 — a "cup" is 236.5882365 ml, not the 240 ml legal cup.
 */

/** Millilitres per unit. The ladder ratios are exact by definition: a cup is 16 tbsp, or 48 tsp. */
const VOLUME_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  l: 1000,
  liter: 1000,
  litre: 1000,
  tsp: 4.92892159375,
  teaspoon: 4.92892159375,
  tbsp: 14.78676478125,
  tablespoon: 14.78676478125,
  "fl oz": 29.5735295625,
  cup: 236.5882365,
  pint: 473.176473,
  pt: 473.176473,
  quart: 946.352946,
  qt: 946.352946,
  gallon: 3785.411784,
  gal: 3785.411784,
};

/** Grams per unit. */
const MASS_G: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  oz: 28.349523125,
  ounce: 28.349523125,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
};

export class UnknownUnitError extends Error {
  constructor(readonly unit: string) {
    super(`${unit} is not a unit this converts`);
  }
}

export class IncompatibleUnitsError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Cannot convert ${from} to ${to} — one measures volume and the other mass`);
  }
}

function normalize(unit: string) {
  return unit.trim().toLowerCase();
}

/** Which table a unit belongs to, or undefined if it is not one this knows. */
function dimension(unit: string) {
  const key = normalize(unit);

  if (key in VOLUME_ML) {
    return { table: VOLUME_ML, name: "volume" as const };
  }

  if (key in MASS_G) {
    return { table: MASS_G, name: "mass" as const };
  }

  return undefined;
}

export function isKnownUnit(unit: string) {
  return dimension(unit) !== undefined;
}

export function convert(quantity: number, from: string, to: string): number {
  const source = dimension(from);
  const target = dimension(to);

  if (!source) {
    throw new UnknownUnitError(from);
  }

  if (!target) {
    throw new UnknownUnitError(to);
  }

  if (source.name !== target.name) {
    // A cup of flour and a gram of flour are only relatable through a density this does not know.
    throw new IncompatibleUnitsError(from, to);
  }

  return (quantity * source.table[normalize(from)]) / target.table[normalize(to)];
}

/**
 * US volume units, largest to smallest, that scaling steps down through when a smaller unit gives
 * a cleaner fraction.
 */
export const VOLUME_LADDER = ["cup", "tbsp", "tsp"] as const;

/**
 * Fractions a kitchen can actually measure.
 *
 * Eighths, plus thirds — ⅓ and ⅔ cup are standard measuring-cup sizes, so a recipe asking for
 * them is measurable even though they are not eighths.
 */
const KITCHEN_FRACTIONS = [0.125, 0.25, 1 / 3, 0.375, 0.5, 0.625, 2 / 3, 0.75, 0.875, 1] as const;

const FRACTION_TOLERANCE = 0.02;

function nearestFraction(fraction: number) {
  return KITCHEN_FRACTIONS.reduce((best, candidate) =>
    Math.abs(fraction - candidate) < Math.abs(fraction - best) ? candidate : best,
  );
}

function isVolumeLadderUnit(unit: string): unit is (typeof VOLUME_LADDER)[number] {
  return (VOLUME_LADDER as readonly string[]).includes(normalize(unit));
}

/**
 * Round a scaled volume to something measurable.
 *
 * Steps down cup → tbsp → tsp looking for a unit where the amount lands on a standard fraction,
 * so `4/9 cup` becomes `7⅛ tbsp` rather than a number nobody can measure. Ported from v1, where
 * this was a deliberate fix (f8a20b4) — raw arithmetic produced quantities like `0.444 cup`.
 */
export function snapToKitchenUnit(
  quantity: number,
  unit: string,
): { quantity: number; unit: string } {
  const normalized = normalize(unit);
  const candidates: [number, string][] = [[quantity, normalized]];

  if (isVolumeLadderUnit(normalized)) {
    for (const smaller of VOLUME_LADDER.slice(VOLUME_LADDER.indexOf(normalized) + 1)) {
      candidates.push([convert(quantity, normalized, smaller), smaller]);
    }
  }

  for (const [candidateQuantity, candidateUnit] of candidates) {
    const whole = Math.floor(candidateQuantity);
    const fraction = candidateQuantity - whole;
    const nearest = nearestFraction(fraction);

    if (fraction < FRACTION_TOLERANCE || Math.abs(fraction - nearest) < FRACTION_TOLERANCE) {
      const snapped = fraction < FRACTION_TOLERANCE ? 0 : nearest;

      return { quantity: Number((whole + snapped).toFixed(4)), unit: candidateUnit };
    }
  }

  // Nothing on the ladder landed cleanly, so snap where we started rather than inventing a unit.
  const whole = Math.floor(quantity);

  return {
    quantity: Number((whole + nearestFraction(quantity - whole)).toFixed(4)),
    unit: normalized,
  };
}

/**
 * The multiplier from one serving count to another.
 *
 * Unknown base servings give 1, so the caller can surface the ambiguity rather than silently
 * mis-scaling a recipe by an invented factor.
 */
export function scaleFactor(baseServings: number | null | undefined, targetServings: number) {
  if (!baseServings || baseServings <= 0) {
    return 1;
  }

  return targetServings / baseServings;
}

/**
 * Amounts in a recipe step that follow the serving count.
 *
 * The agent marks them in braces when it adds a recipe — `Whisk {1/3 cup} mayonnaise` — because
 * which numbers scale is judgment: a step's oven temperature, time, pan size and per-piece portion
 * stay put, and a pattern over free text cannot tell them from an ingredient amount.
 */

export type StepPart = string | { quantity: number; unit: string | null };

const MARKED = /\{([^{}]*)\}/g;

// Mixed number, fraction, or whole or decimal number, then an optional unit.
const AMOUNT = /^(?:(\d+) )?(?:(\d+)\/(\d+)|(\d+(?:\.\d+)?))(?:\s+(\S.*))?$/;

function parseAmount(inner: string) {
  const match = AMOUNT.exec(inner.trim());

  if (!match) {
    return null;
  }

  const [, whole, numerator, denominator, plain, unit] = match;

  // "1 8" is not a mixed number, so a leading whole number needs a fraction after it.
  if (whole !== undefined && plain !== undefined) {
    return null;
  }

  const quantity =
    plain === undefined
      ? Number(whole ?? 0) + Number(numerator) / Number(denominator)
      : Number(plain);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  if (unit === undefined) {
    return { quantity, unit: null };
  }

  return { quantity, unit: unit.trim().toLowerCase() };
}

/** A step as its text and marked amounts. A brace that holds no amount stays in the text. */
export function parseStep(step: string): StepPart[] {
  const parts: StepPart[] = [];
  let text = "";
  let last = 0;

  for (const match of step.matchAll(MARKED)) {
    const amount = parseAmount(match[1]);

    text += step.slice(last, match.index);
    last = match.index + match[0].length;

    if (amount === null) {
      text += match[0];
      continue;
    }

    if (text !== "") {
      parts.push(text);
    }

    parts.push(amount);
    text = "";
  }

  text += step.slice(last);

  if (text !== "") {
    parts.push(text);
  }

  return parts;
}

/** The first brace in a step that is not a well-formed amount, or null when there is none. */
export function malformedQuantity(step: string): string | null {
  for (const match of step.matchAll(MARKED)) {
    if (parseAmount(match[1]) === null) {
      return match[0];
    }
  }

  const stray = /\{[^{}]*|\}/.exec(step.replace(MARKED, ""));

  return stray === null ? null : stray[0];
}

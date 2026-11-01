/**
 * Amounts in a recipe step that follow the serving count.
 *
 * The agent marks them in braces when it adds a recipe — `Whisk {1/3 cup} mayonnaise` — because
 * which numbers scale is judgment: a step's oven temperature, time, pan size and per-piece portion
 * stay put, and a pattern over free text cannot tell them from an ingredient amount.
 *
 * A brace may name its ingredient after a `|`, as in `{1 tsp|cumin}`, so the amount scales on that
 * ingredient's curve rather than linearly.
 */

export type StepPart = string | { quantity: number; unit: string | null; ingredient?: string };

const MARKED = /\{([^{}]*)\}/g;

// Mixed number, fraction, or whole or decimal number, then an optional unit.
const AMOUNT = /^(?:(\d+) )?(?:(\d+)\/(\d+)|(\d+(?:\.\d+)?))(?:\s+(\S.*))?$/;

function parseAmount(inner: string) {
  const [amount, ...link] = inner.split("|");
  const ingredient = link.join("|").trim();

  if (link.length > 0 && ingredient === "") {
    return null;
  }

  const match = AMOUNT.exec(amount.trim());

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

  return {
    quantity,
    unit: unit === undefined ? null : unit.trim().toLowerCase(),
    ...(link.length > 0 && { ingredient }),
  };
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

/** How a step link and an ingredient name are compared: trimmed, ignoring case. */
export function ingredientKey(name: string) {
  return name.trim().toLowerCase();
}

/** The first brace whose link names none of `ingredientKeys`, or null when there is none. */
export function unknownLink(step: string, ingredientKeys: ReadonlySet<string>): string | null {
  for (const match of step.matchAll(MARKED)) {
    const ingredient = parseAmount(match[1])?.ingredient;

    if (ingredient !== undefined && !ingredientKeys.has(ingredientKey(ingredient))) {
      return match[0];
    }
  }

  return null;
}

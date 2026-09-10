import "server-only";

import { parse } from "node-html-parser";

/**
 * Reading a recipe off a web page.
 *
 * Decided in #28 against porting v1's `recipe-scrapers`, which is Python-only: 19 of the 20 sites
 * in the existing library publish a complete schema.org `Recipe` as JSON-LD, so parsing that
 * covers ~99% of them without a second runtime. Nothing is written — the caller reviews the draft
 * and creates the recipe itself, which is how v1's add-recipe flow already worked.
 */

/** Real browsers get answers that obvious bots do not; most sites refuse anything else outright. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Safari/537.36";

const TIMEOUT_MS = 25_000;

export interface ScrapedIngredient {
  /** The raw line, e.g. `"2 cloves garlic, minced"`. Parsing it into fields is the caller's job. */
  text: string;
}

export interface ScrapedRecipe {
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  baseServings: number | null;
  /**
   * What the page said, verbatim.
   *
   * `baseServings` alone cannot be trusted: "1 loaf" parses to 1, and scaling a loaf's
   * ingredients from a base of 1 would multiply them by the target. The caller needs the words to
   * tell "1 loaf" from "1 serving".
   */
  yieldText: string | null;
  prepMin: number | null;
  cookMin: number | null;
  totalMin: number | null;
  ingredients: ScrapedIngredient[];
  instructions: string[];
}

/** The page loaded but carries no recipe — a caller error, since the URL was wrong. */
export class NoRecipeFoundError extends Error {
  constructor(readonly url: string) {
    super(`No recipe data found at ${url}`);
  }
}

/** The URL is one this will not fetch — a scheme or a host that has no business being scraped. */
export class UnsupportedUrlError extends Error {
  constructor(readonly url: string) {
    super(`${url} is not a public web address`);
  }
}

/** The page could not be fetched. Worth retrying, unlike a page with no recipe on it. */
export class PageUnavailableError extends Error {
  constructor(
    readonly url: string,
    cause: unknown,
  ) {
    super(`Could not fetch ${url}: ${cause instanceof Error ? cause.message : cause}`);
  }
}

/**
 * ISO 8601 durations to minutes.
 *
 * schema.org uses them for `prepTime` and friends, so `PT1H30M` has to become 90. Days are
 * included because a few slow-cooker recipes use them.
 */
export function durationToMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, days, hours, minutes] = match;
  const total = Number(days ?? 0) * 24 * 60 + Number(hours ?? 0) * 60 + Number(minutes ?? 0);

  return total > 0 ? total : null;
}

/**
 * `recipeYield` in any of the shapes sites use: a number, `"8"`, `"8 servings"`, or an array.
 *
 * Takes the first number it finds, which is right for "8 servings" and misleading for "1 loaf" —
 * so `yieldText` carries the original alongside it and the caller decides.
 */
export function parseYield(value: unknown): number | null {
  const first = Array.isArray(value) ? value[0] : value;

  if (typeof first === "number" && Number.isFinite(first)) {
    return Math.round(first);
  }

  if (typeof first !== "string") {
    return null;
  }

  const digits = /\d+/.exec(first);

  return digits ? Number(digits[0]) : null;
}

interface HowToStep {
  "@type"?: string;
  text?: string;
  name?: string;
  itemListElement?: unknown;
}

/**
 * `recipeInstructions` flattened to a list of steps.
 *
 * Sites publish this as a single string, an array of strings, an array of `HowToStep` objects, or
 * `HowToSection`s containing steps — often within the same site. All four have to work, because
 * a half-read instruction list is worse than none.
 */
export function parseInstructions(value: unknown): string[] {
  if (typeof value === "string") {
    // A single blob: split on newlines, and fall back to the whole thing if there are none.
    const lines = value
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.length > 1 ? lines : [value.trim()].filter(Boolean);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): string[] => {
    if (typeof entry === "string") {
      return [entry.trim()].filter(Boolean);
    }

    if (!entry || typeof entry !== "object") {
      return [];
    }

    const step = entry as HowToStep;

    // A section holds its own steps; recurse rather than losing them.
    if (step.itemListElement) {
      return parseInstructions(step.itemListElement);
    }

    const text = (step.text ?? step.name ?? "").trim();

    return text ? [text] : [];
  });
}

/**
 * The yield as the page wrote it, for a caller deciding whether the number means anything.
 *
 * Sites commonly publish an array of both forms — `["10", "about 10 large (8\") waffles"]` — and
 * it is the descriptive one that answers "is this 10 servings or 10 waffles". So this takes the
 * longest entry rather than the first, which is the only part worth keeping.
 */
export function yieldText(value: unknown): string | null {
  const entries = (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === "string" || typeof entry === "number")
    .map((entry) => String(entry).trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return null;
  }

  return entries.reduce((longest, entry) => (entry.length > longest.length ? entry : longest));
}

/** `image` as a string, an array, or an ImageObject. */
function parseImage(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;

  if (typeof first === "string") {
    return first;
  }

  if (first && typeof first === "object") {
    const url = (first as { url?: unknown }).url;

    return typeof url === "string" ? url : null;
  }

  return null;
}

interface JsonLdRecipe {
  "@type"?: unknown;
  name?: unknown;
  image?: unknown;
  recipeYield?: unknown;
  prepTime?: unknown;
  cookTime?: unknown;
  totalTime?: unknown;
  recipeIngredient?: unknown;
  recipeInstructions?: unknown;
}

function isRecipeNode(node: unknown): node is JsonLdRecipe {
  if (!node || typeof node !== "object") {
    return false;
  }

  const type = (node as JsonLdRecipe)["@type"];
  const types = Array.isArray(type) ? type : [type];

  return types.some((entry) => String(entry) === "Recipe");
}

/**
 * Every Recipe node in a JSON-LD document.
 *
 * Sites nest them differently — bare, in an array, or inside `@graph` — so this walks rather than
 * assuming a shape.
 */
function collectRecipes(node: unknown, found: JsonLdRecipe[] = []): JsonLdRecipe[] {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectRecipes(entry, found);
    }

    return found;
  }

  if (!node || typeof node !== "object") {
    return found;
  }

  if (isRecipeNode(node)) {
    found.push(node);
  }

  const graph = (node as { "@graph"?: unknown })["@graph"];

  if (graph) {
    collectRecipes(graph, found);
  }

  return found;
}

/**
 * The first Recipe in the page's JSON-LD.
 *
 * A real parser rather than a regex, because matching HTML by hand breaks on attribute order,
 * casing, whitespace and comments — not because of `</script>` inside the JSON. Nothing can help
 * there: per the HTML spec the first `</script>` ends the element whatever the quoting, which is
 * how browsers behave too, and why valid pages escape it as `<\/script>`. That escaped form
 * parses correctly, and a test pins it.
 */
export function extractRecipe(html: string): JsonLdRecipe | undefined {
  const blocks = parse(html).querySelectorAll('script[type="application/ld+json"]');

  for (const block of blocks) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(block.rawText.trim());
    } catch {
      // A malformed block on a page is common and not fatal — keep looking at the others.
      continue;
    }

    const [recipe] = collectRecipes(parsed);

    if (recipe) {
      return recipe;
    }
  }

  return undefined;
}

export function toScrapedRecipe(recipe: JsonLdRecipe, url: string): ScrapedRecipe {
  const ingredients = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [];

  return {
    title: typeof recipe.name === "string" ? recipe.name.trim() : "",
    sourceUrl: url,
    imageUrl: parseImage(recipe.image),
    baseServings: parseYield(recipe.recipeYield),
    yieldText: yieldText(recipe.recipeYield),
    prepMin: durationToMinutes(recipe.prepTime),
    cookMin: durationToMinutes(recipe.cookTime),
    totalMin: durationToMinutes(recipe.totalTime),
    // Raw lines. Turning "2 cloves garlic, minced" into fields is judgment, and belongs to the
    // caller — the same split v1 drew between `prov scrape` and the add-recipe skill.
    ingredients: ingredients
      .filter((line): line is string => typeof line === "string")
      .map((line) => ({ text: line.trim() }))
      .filter((ingredient) => ingredient.text.length > 0),
    instructions: parseInstructions(recipe.recipeInstructions),
  };
}

/**
 * Hosts that are not somewhere a recipe lives.
 *
 * The caller supplies this URL, so without a check the server can be asked to fetch its own
 * network — cloud metadata endpoints, loopback, anything on the private ranges. The API is gated
 * to one household, which makes the blast radius small rather than the pattern acceptable, and
 * closing it is cheaper now than once the endpoint has callers.
 */
function assertPublicUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new UnsupportedUrlError(url);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsupportedUrlError(url);
  }

  const host = parsed.hostname.toLowerCase();

  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    // IPv4 literals on the loopback, link-local and private ranges. A hostname that resolves to
    // one of these still gets through; stopping that needs resolution before connecting, which is
    // more machinery than this is worth for a single-household API.
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("169.254.") ||
    host.startsWith("192.168.") ||
    // 172.16.0.0/12 — only the second octet in 16..31, so a prefix check will not do.
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "0.0.0.0";

  if (blocked) {
    throw new UnsupportedUrlError(url);
  }
}

export async function scrapeRecipe(url: string): Promise<ScrapedRecipe> {
  assertPublicUrl(url);

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (error) {
    throw new PageUnavailableError(url, error);
  }

  // Redirects are followed, so where we ended up matters as much as where we started. Checked
  // outside the try, or the refusal would be caught and reported as a fetch failure.
  assertPublicUrl(response.url || url);

  if (!response.ok) {
    // Includes the bot blocks some sites answer with. The spike found one such site out of
    // twenty, where the fallback is the caller reading the page itself.
    throw new PageUnavailableError(url, `HTTP ${response.status}`);
  }

  const recipe = extractRecipe(await response.text());

  if (!recipe) {
    throw new NoRecipeFoundError(url);
  }

  const scraped = toScrapedRecipe(recipe, url);

  // A recipe with no title and no ingredients is a page that happened to carry a Recipe node —
  // returning it would look like success and hand the caller an empty draft.
  if (!scraped.title || scraped.ingredients.length === 0) {
    throw new NoRecipeFoundError(url);
  }

  return scraped;
}

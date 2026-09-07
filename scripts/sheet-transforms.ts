/**
 * Turning v1's Sheet cells into v2's shapes.
 *
 * Separate from the import script so the conversions are testable without a Sheet, a server or a
 * token — they are where an import quietly corrupts data, and a dry run only proves the row counts.
 */

/** v1 writes numbers, blanks and numeric strings into the same cell; this reads all three. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function str(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return value === undefined || value === null ? "" : String(value);
}

/** `"mexican, kid-friendly"` → `["mexican", "kid-friendly"]`. */
export function csv(value: unknown): string[] {
  return str(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The numbered blob back into steps.
 *
 * v1 stores instructions as `1. …\n\n2. …` for display, because a Sheet cell has no array type.
 * All 97 recipes follow it — checked before relying on it — so splitting on blank lines and
 * dropping the leading number is safe. A part without a number keeps its text rather than being
 * dropped.
 */
export function steps(value: unknown): string[] {
  return str(value)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\d+\.\s*/, ""));
}

const CATEGORIES = new Set(["produce", "meat", "dairy", "bakery", "frozen", "pantry", "other"]);

/** An unrecognised aisle becomes `other` rather than failing the whole import. */
export function category(value: unknown): string {
  const normalized = str(value).toLowerCase();

  return CATEGORIES.has(normalized) ? normalized : "other";
}

/**
 * The ISO week a date falls in.
 *
 * Duplicated from `server/lib/iso-week.ts` on purpose: this script must run without importing the
 * app, so it cannot pull in a module that imports `server-only`. The duplication is covered by a
 * test that checks both agree.
 */
export function isoWeekFor(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
  const thursday = new Date(parsed);

  thursday.setUTCDate(parsed.getUTCDate() + (4 - weekday));

  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const mondayOfWeek1 = new Date(jan4);

  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - (jan4Weekday - 1));

  const week = Math.floor((thursday.getTime() - mondayOfWeek1.getTime()) / (7 * 86_400_000)) + 1;

  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Settings that describe v1's static-HTML publishing, which v2 replaces with a route. */
export const V1_ONLY_CONFIG_KEYS = new Set(["render_dir", "render_base_url", "auto_publish"]);

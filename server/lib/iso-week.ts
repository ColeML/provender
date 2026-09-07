/**
 * ISO week ids, e.g. `2026-W36`.
 *
 * A plan is a week and is named for one, which matches the Monday-to-Sunday shape v1's plans
 * already use. ISO weeks are the only week numbering that agrees with that: weeks start on Monday
 * and week 1 is the one containing the first Thursday, so a year has 52 or 53 of them and January
 * 1st is often in the previous year's last week.
 */
const PATTERN = /^(\d{4})-W(\d{2})$/;

export interface IsoWeek {
  year: number;
  week: number;
}

/** Days in a UTC-safe form. Dates here are calendar days, never instants, so UTC avoids DST. */
function utc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function isoWeekday(date: Date) {
  // getUTCDay is 0 for Sunday; ISO counts Monday as 1 and Sunday as 7.
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/** How many ISO weeks a year has — 53 when it starts on Thursday, or on Wednesday in a leap year. */
export function weeksInYear(year: number) {
  const jan1 = isoWeekday(utc(year, 1, 1));
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  return jan1 === 4 || (isLeap && jan1 === 3) ? 53 : 52;
}

export function parseIsoWeek(id: string): IsoWeek | undefined {
  const match = PATTERN.exec(id);

  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const week = Number(match[2]);

  // Rejected here rather than left to produce a silently wrong date range: `2026-W99` would
  // otherwise resolve to some week in 2027.
  if (week < 1 || week > weeksInYear(year)) {
    return undefined;
  }

  return { year, week };
}

/** The Monday of an ISO week. */
export function weekStart({ year, week }: IsoWeek): Date {
  // Jan 4th is always in week 1, so the Monday of week 1 is found by stepping back from it.
  const jan4 = utc(year, 1, 4);
  const mondayOfWeek1 = new Date(jan4);

  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - (isoWeekday(jan4) - 1));

  const start = new Date(mondayOfWeek1);

  start.setUTCDate(mondayOfWeek1.getUTCDate() + (week - 1) * 7);

  return start;
}

/** The seven dates of a week, as `YYYY-MM-DD`. */
export function weekDates(isoWeek: IsoWeek): string[] {
  const start = weekStart(isoWeek);

  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(start);

    day.setUTCDate(start.getUTCDate() + offset);

    return day.toISOString().slice(0, 10);
  });
}

/**
 * Whether a `YYYY-MM-DD` string is a real calendar date.
 *
 * `new Date("2026-02-30")` does not fail — it rolls over to March 2nd — so a caller's typo would
 * otherwise be reported against a week they never mentioned. Round-tripping catches that.
 */
export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** The ISO week a date falls in — the inverse of `weekDates`. */
export function isoWeekFor(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(parsed);

  // Step to the Thursday of this week: the year that Thursday falls in is the ISO week-year, which
  // is why late December can belong to week 1 of the next year.
  thursday.setUTCDate(parsed.getUTCDate() + (4 - isoWeekday(parsed)));

  const year = thursday.getUTCFullYear();
  const jan4 = utc(year, 1, 4);
  const mondayOfWeek1 = new Date(jan4);

  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - (isoWeekday(jan4) - 1));

  const week =
    Math.floor((thursday.getTime() - mondayOfWeek1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return `${year}-W${String(week).padStart(2, "0")}`;
}

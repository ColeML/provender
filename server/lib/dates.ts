/**
 * Calendar dates in a household's time zone.
 *
 * Outside `server/services/` because the home page's day list runs in the browser and needs the
 * same answer the server gives, and services are `server-only`.
 */

/** What the app uses when the household has no `timezone` setting. */
export const DEFAULT_TIME_ZONE = "America/Chicago";

/**
 * Whether the runtime knows `name` as an IANA zone, such as `America/Chicago` or `UTC`.
 *
 * A bare offset like `-06:00` is refused although `Intl` takes it: it never moves for daylight
 * saving, so it would be an hour off half the year.
 */
export function isTimeZone(name: string) {
  if (name === "" || /^[+-]/.test(name)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });

    return true;
  } catch {
    return false;
  }
}

/** The calendar date, as `YYYY-MM-DD`, that `now` falls on in `timeZone`. */
export function dateIn(timeZone: string, now: Date) {
  // `en-CA` formats as year-month-day, but reading the parts does not lean on a locale's layout.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((each) => each.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

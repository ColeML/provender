import { shiftIsoWeek } from "@server/lib/iso-week";
import Link from "next/link";

const LINK =
  "focus-visible:ring-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:ring-3 focus-visible:outline-none";

/**
 * Steps a week view one ISO week at a time.
 *
 * Both surfaces that use it default to the current week, so the reader who wants next week's
 * shopping list on a Sunday afternoon gets there in one tap. Links rather than buttons, because
 * the week is a URL both pages already read on the server.
 */
export function WeekNav({
  basePath,
  planId,
  atDefault,
  showWeek = true,
}: {
  /** `/plan` or `/shop` — the page the arrows stay within. */
  basePath: string;
  /** The week on screen, which may be unplanned. */
  planId: string;
  /**
   * True when `basePath` with no query string already renders this week, so the way back is
   * hidden rather than reloading the same page. Not the same as "this is the current week":
   * the default view falls back to the most recent plan when the current week is unplanned.
   */
  atDefault: boolean;
  /** False where the page's own heading already names the week, so it is not printed twice. */
  showWeek?: boolean;
}) {
  const previous = shiftIsoWeek(planId, -1);
  const next = shiftIsoWeek(planId, 1);

  return (
    <nav className="flex items-center gap-1" aria-label="Week">
      {previous === undefined ? null : (
        <Link href={`${basePath}?week=${previous}`} className={LINK} aria-label="Previous week">
          <span aria-hidden>←</span>
        </Link>
      )}

      {showWeek ? <span className="text-sm tabular-nums">{planId}</span> : null}

      {next === undefined ? null : (
        <Link href={`${basePath}?week=${next}`} className={LINK} aria-label="Next week">
          <span aria-hidden>→</span>
        </Link>
      )}

      {atDefault ? null : (
        <Link href={basePath} className={`${LINK} text-muted-foreground px-2 text-sm underline`}>
          This week
        </Link>
      )}
    </nav>
  );
}

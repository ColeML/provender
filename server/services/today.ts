import "server-only";

import { db as defaultDb, schema, type Queryable } from "@server/db";
import { dateIn, DEFAULT_TIME_ZONE, isTimeZone } from "@server/lib/dates";
import { and, eq } from "drizzle-orm";

/**
 * The household's clock.
 *
 * The server runs in UTC, which is already tomorrow by dinner time in the US, so "today" is read
 * in the household's `timezone` setting instead. Anything that asks what day it is for a household
 * reads it here, so the home page and the prep reminders agree.
 */
export async function householdTimeZone(
  householdId: string,
  db: Queryable = defaultDb,
): Promise<string> {
  const [row] = await db
    .select({ value: schema.config.value })
    .from(schema.config)
    .where(and(eq(schema.config.householdId, householdId), eq(schema.config.key, "timezone")));

  // A zone saved before zones were checked, or one a newer runtime dropped, reads as unset.
  return row !== undefined && isTimeZone(row.value) ? row.value : DEFAULT_TIME_ZONE;
}

/** Today's date, as `YYYY-MM-DD`, in the household's time zone. */
export async function householdToday(
  householdId: string,
  db: Queryable = defaultDb,
): Promise<string> {
  return dateIn(await householdTimeZone(householdId, db), new Date());
}

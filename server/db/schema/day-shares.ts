import { sql } from "drizzle-orm";
import { date, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { households } from "./households";

/**
 * Public links to one day's plan, one per date. `getSharedDay` explains how they are read.
 *
 * The row names a date rather than any `plan_days` row: a day is up to three rows or none, and the
 * link reads whatever is planned there when it is opened. The token is stored in the clear for the
 * same reason as `recipe_shares`: the day page shows the household the same link again.
 */
export const dayShares = pgTable(
  "day_shares",
  {
    /** 32 random bytes, base64url. */
    token: text("token").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    expireTime: timestamp("expire_time", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '72 hours'`),
  },
  (table) => [uniqueIndex("day_shares_date_idx").on(table.householdId, table.date)],
);

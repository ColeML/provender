import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { households } from "./households";

/**
 * Household settings, as key/value pairs.
 *
 * Key/value rather than one column per setting because the set of keys is open — v1 grew
 * `no_repeat_days`, `pantry_staples`, and `render_dir` over time without a migration each, and
 * that property is worth keeping.
 */
export const config = pgTable(
  "config",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Keys are unique per household, not globally: two households both have a `people` setting.
  (table) => [primaryKey({ columns: [table.householdId, table.key] })],
);

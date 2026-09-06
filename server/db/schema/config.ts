import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Household settings, as key/value pairs.
 *
 * Key/value rather than one column per setting because the set of keys is open — v1 grew
 * `no_repeat_days`, `pantry_staples`, and `render_dir` over time without a migration each, and
 * that property is worth keeping.
 */
export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConfigRow = typeof config.$inferSelect;

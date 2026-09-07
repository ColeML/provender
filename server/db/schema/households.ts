import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A household — one family's plans, recipes, prices and shopping list.
 *
 * Everything else is scoped to one of these. Ids are unique *within* a household, not globally, so
 * two households can each have a `chicken-fajitas` without colliding.
 *
 * A household is never named in a URL. It is resolved from the caller — session or bearer token —
 * because the caller does not choose it, and putting it in the path would lengthen every resource
 * name forever to express something that is never ambiguous.
 */
export const households = pgTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
});

/** The household every row belongs to until a second one exists. */
export const DEFAULT_HOUSEHOLD_ID = "loewer";

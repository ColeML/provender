import { numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { households } from "./households";

/**
 * Prices the household has actually paid.
 *
 * The most accurate input to a budget estimate, because it comes from the shops they use. The
 * planner prefers these over any guess or lookup.
 */
export const prices = pgTable(
  "prices",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    ingredient: text("ingredient").notNull(),
    /** Lowercased on write, as everywhere else, so `lb` and `LB` are one unit. */
    unit: text("unit").notNull(),
    /** Which shop. The same item costs differently at a warehouse club and a supermarket. */
    store: text("store").notNull(),
    price: numeric("price", { precision: 8, scale: 2 }).notNull(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  // Keyed on all three: recording a price again is a correction, not a second data point, and
  // without this the table would fill with stale rows for the same item.
  (table) => [
    primaryKey({ columns: [table.householdId, table.ingredient, table.unit, table.store] }),
  ],
);

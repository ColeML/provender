import { bigint, date, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { households } from "./households";

/** What the household wants a week to account for, written before that week is planned. */
export const weekNotes = pgTable(
  "week_notes",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    /**
     * The ISO week, e.g. `2026-W42`. Not a foreign key to `plans`: a note is written before its
     * week is planned, so the plan usually does not exist yet.
     */
    weekId: text("week_id").notNull(),
    /** Null means any day of the week. When set, it falls inside `weekId`. */
    date: date("date"),
    body: text("body").notNull(),
    /**
     * Insert order, which is what "oldest first" sorts on. `create_time` cannot: two notes saved
     * in the same instant tie, and PGlite's clock is millisecond-grained, so in tests they often do.
     */
    createOrder: bigint("create_order", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    index("week_notes_week_idx").on(table.householdId, table.weekId),
  ],
);

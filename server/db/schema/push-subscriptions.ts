import { date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { households } from "./households";

/**
 * One browser's Web Push subscription. A device is its endpoint: the push service hands each
 * browser a hard-to-guess URL that only that browser knows, so the endpoint is the key, and
 * subscribing again from the same browser replaces the row. The household always comes from the
 * session that saved it, so signing in to another household moves the device there.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** The browser's public key and auth secret, base64url, that each payload is encrypted to. */
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** The household-local date of the last reminder sent, so a repeat run sends nothing. */
    lastSentOn: date("last_sent_on"),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("push_subscriptions_household_idx").on(table.householdId)],
);

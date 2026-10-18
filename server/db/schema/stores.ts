import {
  boolean,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { households } from "./households";

/**
 * The shops a household buys from.
 *
 * `notes` is the setting the planner reads when it decides which shop an item goes to — "cheapest
 * for produce, poor meat", "only on the way home on Fridays". Judgment like that is the agent's,
 * so it is kept as prose rather than squeezed into columns the planner would still have to
 * interpret.
 */
export const stores = pgTable(
  "stores",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** The slug of the name it was created with, e.g. `aldi`. */
    id: text("id").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    /** Where anything without a better home goes. At most one per household. */
    primary: boolean("primary").notNull().default(false),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    // Enforced here rather than by a read before the write, so two phones cannot each crown one.
    uniqueIndex("stores_one_primary_idx")
      .on(table.householdId)
      .where(sql`${table.primary}`),
  ],
);

/**
 * Which shop an ingredient comes from, set by the household.
 *
 * `only` is the difference between a habit and a rule. Without it the planner may still send the
 * item elsewhere — the shop is not being visited this week, or it is far cheaper down the road.
 * With it the item always goes to this shop: "we only get milk from Braum's".
 */
export const ingredientStores = pgTable(
  "ingredient_stores",
  {
    householdId: text("household_id").notNull(),
    /** The slug of the ingredient's name, which is how a shopping list item is matched to it. */
    id: text("id").notNull(),
    name: text("name").notNull(),
    storeId: text("store_id").notNull(),
    only: boolean("only").notNull().default(false),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    // A rule about a shop you no longer use is no rule at all.
    foreignKey({
      columns: [table.householdId, table.storeId],
      foreignColumns: [stores.householdId, stores.id],
      name: "ingredient_stores_store_fk",
    }).onDelete("cascade"),
  ],
);

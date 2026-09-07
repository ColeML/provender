import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { plans } from "./plans";
import { ingredientCategory } from "./recipes";

/**
 * Where an item came from.
 *
 * This is what lets the agent rebuild the list without destroying what you added yourself.
 * Replacing the list only touches `plan` items; `manual` ones survive every rebuild, because
 * "I also need brown sugar" has nothing to do with which recipes are scheduled.
 */
export const shoppingItemSource = pgEnum("shopping_item_source", ["plan", "manual"]);

/**
 * The shopping list for a week.
 *
 * There is no separate `shopping_lists` table: the list *is* its items, scoped to a plan. A
 * singleton row holding nothing but a foreign key would exist only to satisfy the URL shape.
 */
export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    householdId: text("household_id").notNull(),
    planId: text("plan_id").notNull(),
    /**
     * Derived from the name and unit, e.g. `chicken-breast_lb`.
     *
     * This is what makes ticks survive a rebuild. v1 re-matched rows by name *and* unit after
     * replacing the tab, and warned you to keep names stable between runs because the match was
     * fragile. Keying on the same values means the row itself survives, so `purchased` and
     * `haveAlready` come along without a matching pass.
     */
    id: text("id").notNull(),
    name: text("name").notNull(),
    /** Null for things bought by feel — the same reasoning as an ingredient's quantity. */
    quantity: numeric("quantity"),
    /** Lowercased on write, so `lb` and `Lb` cannot become two entries for one product. */
    unit: text("unit"),
    /** The same enum the recipe ingredients use, so aisle grouping agrees across the app. */
    category: ingredientCategory("category").notNull(),
    /** Recipe ids, so the UI can answer "why is this on my list". Empty for a manual item. */
    feedsRecipes: text("feeds_recipes").array().notNull().default([]),
    estCost: numeric("est_cost", { precision: 8, scale: 2 }),
    /** Ticked in the store. The most frequent write in the app. */
    purchased: boolean("purchased").notNull().default(false),
    /**
     * Already in the pantry.
     *
     * This, not deleting, is how you drop a plan item you do not need: a rebuild re-adds anything
     * a recipe still calls for, but it carries this flag across.
     */
    haveAlready: boolean("have_already").notNull().default(false),
    source: shoppingItemSource("source").notNull().default("plan"),
    position: integer("position").notNull().default(0),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.planId, table.id] }),
    foreignKey({
      columns: [table.householdId, table.planId],
      foreignColumns: [plans.householdId, plans.id],
      name: "shopping_list_items_plan_fk",
    }).onDelete("cascade"),
    // The list is read aisle by aisle, which is this index.
    index("shopping_list_items_category_idx").on(
      table.householdId,
      table.planId,
      table.category,
      table.position,
    ),
  ],
);

import {
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { households } from "./households";
import { mealSlot, planDays } from "./plans";

/**
 * What was planned, and how it turned out.
 *
 * This records meals at *plan* time, not cooking time — the planner writes a row when it schedules
 * a main, and nothing confirms the meal was eaten. Repeat-avoidance reads it anyway, because
 * requiring a confirmation step would mean the feature never has data. The consequence is that a
 * dish the household skipped still blocks itself for the no-repeat window, which is why unlike v1
 * there is a delete: a row you can't remove is a dish you can't ask for again.
 */
export const mealHistory = pgTable(
  "meal_history",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** `<date>-<recipeId>`, so re-planning the same dish on the same day updates rather than duplicating. */
    id: text("id").notNull(),
    date: date("date").notNull(),
    /**
     * Deliberately not a foreign key.
     *
     * History is a log: it has to outlive the recipes it names. 48 of the 97 recipes in the v1
     * library appear here, so RESTRICT would mean never being able to delete a recipe you had
     * ever planned. `ON DELETE SET NULL` is not the escape either — a composite foreign key nulls
     * every column in the key, including `household_id`, which is NOT NULL and half the primary
     * key. Postgres can null one named column, but drizzle cannot express that, so the schema and
     * the migration would disagree from then on.
     *
     * The cost is that this can name a recipe that no longer exists. That is harmless: the entry
     * still reads correctly from `title`, and a dangling id simply never matches anything
     * repeat-avoidance compares it against.
     */
    recipeId: text("recipe_id"),
    /** Kept denormalized so an entry still reads sensibly after its recipe is gone. */
    title: text("title").notNull(),
    mealSlot: mealSlot("meal_slot").notNull().default("dinner"),
    /** 1–5. Null is the common case: 4 of v1's 61 rows are rated. */
    rating: integer("rating"),
    notes: text("notes"),
    /**
     * The day that scheduled this, when one did.
     *
     * Cascading is what makes clearing a day remove its history row without any application code
     * coordinating the two — and nulling this first is what "keep the history" means.
     */
    planId: text("plan_id"),
    planDate: date("plan_date"),
    planMealSlot: mealSlot("plan_meal_slot"),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    foreignKey({
      columns: [table.householdId, table.planId, table.planDate, table.planMealSlot],
      foreignColumns: [planDays.householdId, planDays.planId, planDays.date, planDays.mealSlot],
      name: "meal_history_plan_day_fk",
    }).onDelete("cascade"),
    // Repeat-avoidance asks "what was planned since <date>", which is this index.
    index("meal_history_date_idx").on(table.householdId, table.date),
  ],
);

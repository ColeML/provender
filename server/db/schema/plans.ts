import { relations, sql } from "drizzle-orm";
import {
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { households } from "./households";
import { recipes } from "./recipes";

/**
 * Which meal a day-slot is for.
 *
 * Every one of v1's 7 plan rows and 61 history rows is `dinner` — lunches are leftovers, per the
 * household's own preferences. The slot is half the day key, so the values have to exist before
 * anything can use them: adding one later means re-keying the table.
 *
 * Declared in the order Postgres holds them, which is creation order rather than meal order —
 * `breakfast` was added last. Never sort on this column to get a day's reading order; use
 * `MEAL_ORDER`, which says what the order actually is.
 */
export const mealSlot = pgEnum("meal_slot", ["dinner", "lunch", "breakfast"]);

/** The order the meals are eaten, which is the order a day reads in. */
export const MEAL_ORDER = ["breakfast", "lunch", "dinner"] as const;

/** What a recipe is doing on a day. */
export const planRecipeRole = pgEnum("plan_recipe_role", ["main", "side", "extra"]);

export const plans = pgTable(
  "plans",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** The ISO week, e.g. `2026-W36` — which is exactly the Monday-to-Sunday shape v1 plans use. */
    id: text("id").notNull(),
    /**
     * Copied from Config when the plan is created rather than read live, so the number the week was
     * planned against does not change under it when the default budget is edited later.
     */
    budgetTarget: numeric("budget_target", { precision: 8, scale: 2 }),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.householdId, table.id] })],
);

export const planDays = pgTable(
  "plan_days",
  {
    householdId: text("household_id").notNull(),
    planId: text("plan_id").notNull(),
    date: date("date").notNull(),
    mealSlot: mealSlot("meal_slot").notNull().default("dinner"),
    /** Per-day, not per-plan: a potluck Thursday is 27 servings while the rest of the week is 8. */
    servings: integer("servings").notNull(),
    /** Free text, and open on purpose — v1 has `planned` and `potluck`, and invents more. */
    status: text("status").notNull().default("planned"),
    /** Why the day looks the way it does: the forecast, the equipment, what the kids will eat. */
    notes: text("notes"),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A day-slot is the unit: one dinner per date. An unplanned day is the absence of a row, not
    // a row with empty columns — which is what v1's seven fixed slots forced.
    primaryKey({ columns: [table.householdId, table.planId, table.date, table.mealSlot] }),
    foreignKey({
      columns: [table.householdId, table.planId],
      foreignColumns: [plans.householdId, plans.id],
      name: "plan_days_plan_fk",
    }).onDelete("cascade"),
    index("plan_days_date_idx").on(table.householdId, table.date),
  ],
);

export const planDayRecipes = pgTable(
  "plan_day_recipes",
  {
    householdId: text("household_id").notNull(),
    planId: text("plan_id").notNull(),
    date: date("date").notNull(),
    mealSlot: mealSlot("meal_slot").notNull(),
    recipeId: text("recipe_id").notNull(),
    role: planRecipeRole("role").notNull(),
    /** Orders the extras; a dessert and a second side are not interchangeable in the UI. */
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.householdId, table.planId, table.date, table.mealSlot, table.recipeId],
    }),
    foreignKey({
      columns: [table.householdId, table.planId, table.date, table.mealSlot],
      foreignColumns: [planDays.householdId, planDays.planId, planDays.date, planDays.mealSlot],
      name: "plan_day_recipes_day_fk",
    }).onDelete("cascade"),
    // RESTRICT, not CASCADE: deleting a recipe a plan still references should fail loudly rather
    // than silently empty a day someone is cooking from this week.
    foreignKey({
      columns: [table.householdId, table.recipeId],
      foreignColumns: [recipes.householdId, recipes.id],
      name: "plan_day_recipes_recipe_fk",
    }).onDelete("restrict"),
    // One main per day-slot. Two would make "what are we having" ambiguous, and every reader
    // would need a tiebreak rule.
    uniqueIndex("plan_day_recipes_one_main_idx")
      .on(table.householdId, table.planId, table.date, table.mealSlot)
      .where(sql`role = 'main'`),
  ],
);

export const plansRelations = relations(plans, ({ many }) => ({ days: many(planDays) }));

export const planDaysRelations = relations(planDays, ({ one, many }) => ({
  plan: one(plans, {
    fields: [planDays.householdId, planDays.planId],
    references: [plans.householdId, plans.id],
  }),
  recipes: many(planDayRecipes),
}));

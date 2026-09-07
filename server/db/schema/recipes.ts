import { relations } from "drizzle-orm";

import { households } from "./households";
import {
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

/**
 * Store aisles, as an enum rather than free text.
 *
 * The shopping list groups by this, so a typo would silently produce an unsorted row instead of a
 * write-time failure. These are the seven values the v1 library actually uses across 916 rows.
 */
export const ingredientCategory = pgEnum("ingredient_category", [
  "produce",
  "meat",
  "dairy",
  "bakery",
  "frozen",
  "pantry",
  "other",
]);

export const recipes = pgTable(
  "recipes",
  {
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** Client-assigned slug (AIP-133), e.g. `chicken-fajitas`. Unique per household, not globally. */
    id: text("id").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
    /** The servings the recipe is stored at — what will actually be cooked, not the original yield. */
    baseServings: integer("base_servings").notNull(),
    prepMin: integer("prep_min"),
    cookMin: integer("cook_min"),
    totalMin: integer("total_min"),
    costEstimate: numeric("cost_estimate", { precision: 8, scale: 2 }),
    tags: text("tags").array().notNull().default([]),
    /** One element per step. v1 stored a numbered blob; the numbering is the UI's job. */
    instructions: text("instructions").array().notNull().default([]),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
    updateTime: timestamp("update_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    index("recipes_title_idx").on(table.householdId, table.title),
  ],
);

export const ingredients = pgTable(
  "ingredients",
  {
    /** `<recipe_id>_<name-slug>`, suffixed on collision — a recipe may use an ingredient twice. */
    householdId: text("household_id").notNull(),
    id: text("id").notNull(),
    recipeId: text("recipe_id").notNull(),
    name: text("name").notNull(),
    /** Null for "to taste" and garnishes — 12 of v1's 916 rows. The meaning lives in `notes`. */
    quantity: numeric("quantity"),
    /** Lowercased on write: v1 has both `tbsp` and `Tbsp`, which makes merging see two products. */
    unit: text("unit"),
    category: ingredientCategory("category").notNull(),
    notes: text("notes"),
    /** Preserves the order the recipe lists them in; ids sort alphabetically, which is not that. */
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.id] }),
    // Composite, because a recipe is only unique within its household. Cascading here is what
    // keeps a deleted recipe from leaving ingredients that silently inflate a shopping list.
    foreignKey({
      columns: [table.householdId, table.recipeId],
      foreignColumns: [recipes.householdId, recipes.id],
      name: "ingredients_recipe_fk",
    }).onDelete("cascade"),
    index("ingredients_recipe_id_idx").on(table.householdId, table.recipeId),
    uniqueIndex("ingredients_recipe_position_idx").on(
      table.householdId,
      table.recipeId,
      table.position,
    ),
  ],
);

export const recipesRelations = relations(recipes, ({ many }) => ({
  ingredients: many(ingredients),
}));

export const ingredientsRelations = relations(ingredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [ingredients.householdId, ingredients.recipeId],
    references: [recipes.householdId, recipes.id],
  }),
}));

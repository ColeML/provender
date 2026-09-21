import { foreignKey, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { recipes } from "./recipes";

/**
 * Public share links, one per recipe. `getSharedRecipe` explains how they are read.
 *
 * The token is stored in the clear rather than hashed, which is the deliberate choice here:
 * holding the link is the whole permission, and the API has to show the household the same token
 * again after it is minted — a hash could not be turned back into a link.
 */
export const recipeShares = pgTable(
  "recipe_shares",
  {
    /** 32 random bytes, base64url. Also the share's id in its resource name. */
    token: text("token").primaryKey(),
    householdId: text("household_id").notNull(),
    recipeId: text("recipe_id").notNull(),
    createTime: timestamp("create_time", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Cascading is what makes a dead link a property of the schema: delete the recipe and the
    // token stops resolving, with no revoke step to forget.
    foreignKey({
      columns: [table.householdId, table.recipeId],
      foreignColumns: [recipes.householdId, recipes.id],
      name: "recipe_shares_recipe_fk",
    }).onDelete("cascade"),
    // One live share per recipe, enforced here rather than by a read before the write — which is
    // what lets the API answer ALREADY_EXISTS without racing itself.
    uniqueIndex("recipe_shares_recipe_idx").on(table.householdId, table.recipeId),
  ],
);

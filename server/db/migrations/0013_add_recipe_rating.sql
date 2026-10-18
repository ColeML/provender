-- Hand-added after generation: backfills each recipe's rating from its most recent rated
-- history entry, so existing ratings survive the move off `meal_history.rating`.
-- IF NOT EXISTS: this shipped as 0012 on an unmerged branch, so some databases already ran it.

ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "rating" integer;--> statement-breakpoint
ALTER TABLE "recipes" DROP CONSTRAINT IF EXISTS "recipes_rating_range";--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_rating_range" CHECK ("recipes"."rating" BETWEEN 1 AND 5);
--> statement-breakpoint
UPDATE "recipes" AS r
SET "rating" = h."rating"
FROM (
  SELECT DISTINCT ON ("household_id", "recipe_id") "household_id", "recipe_id", "rating"
  FROM "meal_history"
  WHERE "rating" IS NOT NULL AND "recipe_id" IS NOT NULL
  ORDER BY "household_id", "recipe_id", "date" DESC
) AS h
WHERE r."household_id" = h."household_id" AND r."id" = h."recipe_id";

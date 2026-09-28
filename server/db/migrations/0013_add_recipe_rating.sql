ALTER TABLE "recipes" ADD COLUMN "rating" integer;--> statement-breakpoint
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
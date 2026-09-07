-- Scope config, recipes and ingredients to a household.
--
-- Hand-corrected after generation. drizzle-kit emitted the ADD CONSTRAINT ... PRIMARY KEY before
-- the ADD COLUMN it depends on, left the old primary-key drops as commented-out placeholders it
-- could not name, and added `household_id` NOT NULL with no default — which fails on any table
-- that already has rows. The order below works whether the tables are empty or not: existing rows
-- are adopted by the household seeded in 0003 rather than rejected.

-- 1. Composite keys need the old ones gone first, and the child FK before its parent's key.
ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_recipe_id_recipes_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "ingredients_recipe_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "ingredients_recipe_position_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "recipes_title_idx";--> statement-breakpoint
ALTER TABLE "config" DROP CONSTRAINT IF EXISTS "config_pkey";--> statement-breakpoint
ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_pkey";--> statement-breakpoint
ALTER TABLE "recipes" DROP CONSTRAINT IF EXISTS "recipes_pkey";--> statement-breakpoint

-- 2. The default adopts any existing rows; it is dropped immediately so future inserts must say
--    which household they belong to rather than silently landing in this one.
ALTER TABLE "config" ADD COLUMN "household_id" text NOT NULL DEFAULT 'loewer';--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "household_id" text NOT NULL DEFAULT 'loewer';--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "household_id" text NOT NULL DEFAULT 'loewer';--> statement-breakpoint
ALTER TABLE "config" ALTER COLUMN "household_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ingredients" ALTER COLUMN "household_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "recipes" ALTER COLUMN "household_id" DROP DEFAULT;--> statement-breakpoint

-- 3. Ids are unique per household, not globally.
ALTER TABLE "config" ADD CONSTRAINT "config_household_id_key_pk" PRIMARY KEY("household_id","key");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_id_pk" PRIMARY KEY("household_id","id");--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_household_id_id_pk" PRIMARY KEY("household_id","id");--> statement-breakpoint

ALTER TABLE "config" ADD CONSTRAINT "config_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_recipe_fk" FOREIGN KEY ("household_id","recipe_id") REFERENCES "public"."recipes"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "ingredients_recipe_id_idx" ON "ingredients" USING btree ("household_id","recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_recipe_position_idx" ON "ingredients" USING btree ("household_id","recipe_id","position");--> statement-breakpoint
CREATE INDEX "recipes_title_idx" ON "recipes" USING btree ("household_id","title");

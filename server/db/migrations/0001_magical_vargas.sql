CREATE TYPE "public"."ingredient_category" AS ENUM('produce', 'meat', 'dairy', 'bakery', 'frozen', 'pantry', 'other');--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"category" "ingredient_category" NOT NULL,
	"notes" text,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"image_url" text,
	"base_servings" integer NOT NULL,
	"prep_min" integer,
	"cook_min" integer,
	"total_min" integer,
	"cost_estimate" numeric(8, 2),
	"tags" text[] DEFAULT '{}' NOT NULL,
	"instructions" text[] DEFAULT '{}' NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredients_recipe_id_idx" ON "ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_recipe_position_idx" ON "ingredients" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE INDEX "recipes_title_idx" ON "recipes" USING btree ("title");
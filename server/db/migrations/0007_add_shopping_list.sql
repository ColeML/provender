CREATE TYPE "public"."shopping_item_source" AS ENUM('plan', 'manual');--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"household_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"category" "ingredient_category" NOT NULL,
	"feeds_recipes" text[] DEFAULT '{}' NOT NULL,
	"est_cost" numeric(8, 2),
	"purchased" boolean DEFAULT false NOT NULL,
	"have_already" boolean DEFAULT false NOT NULL,
	"source" "shopping_item_source" DEFAULT 'plan' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_list_items_household_id_plan_id_id_pk" PRIMARY KEY("household_id","plan_id","id")
);
--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_plan_fk" FOREIGN KEY ("household_id","plan_id") REFERENCES "public"."plans"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_list_items_category_idx" ON "shopping_list_items" USING btree ("household_id","plan_id","category","position");
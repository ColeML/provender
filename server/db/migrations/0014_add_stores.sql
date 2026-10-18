-- Edited after generation: drizzle-kit also emitted `ALTER TABLE "meal_history" DROP COLUMN
-- "rating"`, which belongs to the recipe-ratings follow-up (docs/plans/2026-09-28-recipe-ratings.md,
-- Task 9) and must not ship early. The line is removed here and the column kept in this snapshot,
-- so that follow-up's `pnpm db:generate` still produces the drop.

CREATE TABLE "ingredient_stores" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"store_id" text NOT NULL,
	"only" boolean DEFAULT false NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_stores_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"primary" boolean DEFAULT false NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD COLUMN "store_id" text;--> statement-breakpoint
ALTER TABLE "ingredient_stores" ADD CONSTRAINT "ingredient_stores_store_fk" FOREIGN KEY ("household_id","store_id") REFERENCES "public"."stores"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stores_one_primary_idx" ON "stores" USING btree ("household_id") WHERE "stores"."primary";

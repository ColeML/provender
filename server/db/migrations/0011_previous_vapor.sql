CREATE TABLE "recipe_shares" (
	"token" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_shares" ADD CONSTRAINT "recipe_shares_recipe_fk" FOREIGN KEY ("household_id","recipe_id") REFERENCES "public"."recipes"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_shares_recipe_idx" ON "recipe_shares" USING btree ("household_id","recipe_id");
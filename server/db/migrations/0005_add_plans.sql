CREATE TYPE "public"."meal_slot" AS ENUM('dinner', 'lunch');--> statement-breakpoint
CREATE TYPE "public"."plan_recipe_role" AS ENUM('main', 'side', 'extra');--> statement-breakpoint
CREATE TABLE "plan_day_recipes" (
	"household_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"date" date NOT NULL,
	"meal_slot" "meal_slot" NOT NULL,
	"recipe_id" text NOT NULL,
	"role" "plan_recipe_role" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "plan_day_recipes_household_id_plan_id_date_meal_slot_recipe_id_pk" PRIMARY KEY("household_id","plan_id","date","meal_slot","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"household_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"date" date NOT NULL,
	"meal_slot" "meal_slot" DEFAULT 'dinner' NOT NULL,
	"servings" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_days_household_id_plan_id_date_meal_slot_pk" PRIMARY KEY("household_id","plan_id","date","meal_slot")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"budget_target" numeric(8, 2),
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "plan_day_recipes" ADD CONSTRAINT "plan_day_recipes_day_fk" FOREIGN KEY ("household_id","plan_id","date","meal_slot") REFERENCES "public"."plan_days"("household_id","plan_id","date","meal_slot") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_day_recipes" ADD CONSTRAINT "plan_day_recipes_recipe_fk" FOREIGN KEY ("household_id","recipe_id") REFERENCES "public"."recipes"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_plan_fk" FOREIGN KEY ("household_id","plan_id") REFERENCES "public"."plans"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_day_recipes_one_main_idx" ON "plan_day_recipes" USING btree ("household_id","plan_id","date","meal_slot") WHERE role = 'main';--> statement-breakpoint
CREATE INDEX "plan_days_date_idx" ON "plan_days" USING btree ("household_id","date");
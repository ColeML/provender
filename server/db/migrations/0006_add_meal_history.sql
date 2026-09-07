CREATE TABLE "meal_history" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"date" date NOT NULL,
	"recipe_id" text,
	"title" text NOT NULL,
	"meal_slot" "meal_slot" DEFAULT 'dinner' NOT NULL,
	"rating" integer,
	"notes" text,
	"plan_id" text,
	"plan_date" date,
	"plan_meal_slot" "meal_slot",
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_history_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "meal_history" ADD CONSTRAINT "meal_history_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_history" ADD CONSTRAINT "meal_history_plan_day_fk" FOREIGN KEY ("household_id","plan_id","plan_date","plan_meal_slot") REFERENCES "public"."plan_days"("household_id","plan_id","date","meal_slot") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_history_date_idx" ON "meal_history" USING btree ("household_id","date");
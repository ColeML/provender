CREATE TABLE "day_shares" (
	"token" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"date" date NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"expire_time" timestamp with time zone DEFAULT now() + interval '72 hours' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_shares" ADD CONSTRAINT "day_shares_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "day_shares_date_idx" ON "day_shares" USING btree ("household_id","date");
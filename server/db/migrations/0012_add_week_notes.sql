CREATE TABLE "week_notes" (
	"household_id" text NOT NULL,
	"id" text NOT NULL,
	"week_id" text NOT NULL,
	"date" date,
	"body" text NOT NULL,
	"create_order" bigint GENERATED ALWAYS AS IDENTITY (sequence name "week_notes_create_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"create_time" timestamp with time zone DEFAULT now() NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "week_notes_household_id_id_pk" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "week_notes" ADD CONSTRAINT "week_notes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "week_notes_week_idx" ON "week_notes" USING btree ("household_id","week_id");
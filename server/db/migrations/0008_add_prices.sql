CREATE TABLE "prices" (
	"household_id" text NOT NULL,
	"ingredient" text NOT NULL,
	"unit" text NOT NULL,
	"store" text NOT NULL,
	"price" numeric(8, 2) NOT NULL,
	"update_time" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_household_id_ingredient_unit_store_pk" PRIMARY KEY("household_id","ingredient","unit","store")
);
--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
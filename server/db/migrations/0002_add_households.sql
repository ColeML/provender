CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"create_time" timestamp with time zone DEFAULT now() NOT NULL
);

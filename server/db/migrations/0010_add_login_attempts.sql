-- Edited: drizzle-kit also emitted `ALTER TYPE "meal_slot" ADD VALUE 'breakfast'` here. 0009 was
-- hand-written and committed without a snapshot, so drizzle-kit diffed against 0008 and re-emitted
-- a change that has already shipped; running it a second time fails. This migration's snapshot does
-- record the value, so the next generate starts from the real state.
CREATE TABLE "login_attempts" (
	"client" text PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);

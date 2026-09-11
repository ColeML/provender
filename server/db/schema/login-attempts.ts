import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Sign-in attempts, counted per client address.
 *
 * The one table not scoped to a household: signing in happens before any household is known, and
 * with a single shared password there is nothing else to key on. The count lives in Postgres
 * rather than in memory because every serverless instance starts with an empty module scope, so
 * an in-process counter resets whenever the platform hands the attacker a cold start.
 */
export const loginAttempts = pgTable("login_attempts", {
  /** The client address, or `unknown` when no proxy header identified one. */
  client: text("client").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  /** When the current counting window opened. An attempt after it has passed starts a new one. */
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The schema barrel. Every table is re-exported here, because this is what `drizzle.config.ts`
 * points at and what `drizzle-kit generate` diffs to produce a migration — a table not reachable
 * from this file does not exist as far as migrations are concerned.
 */
export * from "./config";
export * from "./households";
export * from "./history";
export * from "./login-attempts";
export * from "./plans";
export * from "./prices";
export * from "./recipes";
export * from "./shopping";

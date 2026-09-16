import "./server/load-env";

import { defineConfig } from "drizzle-kit";

// The direct connection, not the pooled one: DDL needs session-level state that a pooled
// connection does not support. Falls back to DATABASE_URL for an environment that sets only that.
//
// Checked here rather than asserted with `!`. drizzle-kit would otherwise take `undefined` as the
// connection string and fail inside its connection layer, with a message that says nothing about
// the variable that is actually missing.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED and DATABASE_URL are both unset");
}

export default defineConfig({
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});

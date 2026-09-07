import "./server/load-env";

import { defineConfig } from "drizzle-kit";

// Checked here rather than asserted with `!`. drizzle-kit would otherwise take `undefined` as the
// connection string and fail inside its connection layer, with a message that says nothing about
// the variable that is actually missing.
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});

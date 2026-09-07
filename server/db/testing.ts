import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

import type { Database } from "./index";

/**
 * A real Postgres for tests, in-process.
 *
 * The alternative was a hand-written `db` stub, which cannot exercise a transaction rolling back,
 * an `ON DELETE CASCADE`, an enum rejecting a bad value, or a unique index — which is most of what
 * the recipe service does. PGlite runs the committed migrations, so the tests also fail when a
 * migration and the schema disagree.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: "./server/db/migrations" });

  return {
    // The service functions take the app's `Database`; PGlite's driver is structurally the same
    // for everything they use, and the cast keeps that seam in one place instead of every test.
    db: db as unknown as Database,
    async close() {
      await client.close();
    },
  };
}

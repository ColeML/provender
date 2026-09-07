import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";
import { eq } from "drizzle-orm";

/**
 * Household settings.
 *
 * Every service in this directory is the only place its logic lives: the tRPC procedure and the
 * REST handler that expose it are both delegations to functions here. That is what keeps the two
 * transports from disagreeing — they cannot drift if neither of them decides anything.
 *
 * `householdId` is the required first parameter on every exported function, deliberately. The
 * failure that matters is not a wrong query but a forgotten one: a function that omits the
 * household filter returns every household's rows and looks entirely normal in review. Making it
 * impossible to call without one moves that mistake to compile time.
 *
 * `db` is a parameter with a default rather than a module import so tests can pass a stub.
 */
export type Config = Record<string, string>;

export async function getConfig(householdId: string, db: Database = defaultDb): Promise<Config> {
  const rows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.householdId, householdId));

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setConfigValue(
  householdId: string,
  key: string,
  value: string,
  db: Database = defaultDb,
): Promise<void> {
  await db
    .insert(schema.config)
    .values({ householdId, key, value })
    .onConflictDoUpdate({
      target: [schema.config.householdId, schema.config.key],
      set: { value, updatedAt: new Date() },
    });
}

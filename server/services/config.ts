import "server-only";

import { db as defaultDb, schema, type Database } from "@server/db";

/**
 * Household settings.
 *
 * Every service in this directory is the only place its logic lives: the tRPC procedure and the
 * REST handler that expose it are both delegations to functions here. That is what keeps the two
 * transports from disagreeing — they cannot drift if neither of them decides anything.
 *
 * `db` is a parameter with a default rather than a module import so tests can pass a stub without
 * mocking the module graph.
 */
export type Config = Record<string, string>;

export async function getConfig(db: Database = defaultDb): Promise<Config> {
  const rows = await db.select().from(schema.config);

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setConfigValue(
  key: string,
  value: string,
  db: Database = defaultDb,
): Promise<void> {
  await db
    .insert(schema.config)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.config.key, set: { value, updatedAt: new Date() } });
}

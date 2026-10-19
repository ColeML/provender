import "server-only";

import { db as defaultDb, schema, type Queryable } from "@server/db";
import { findSetting } from "@server/lib/settings";
import { eq, sql } from "drizzle-orm";

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

export async function getConfig(householdId: string, db: Queryable = defaultDb): Promise<Config> {
  const rows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.householdId, householdId));

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export class InvalidSettingError extends Error {
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
  }
}

const WHOLE_NUMBER = /^[1-9]\d*$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** Checked here rather than in either transport, so REST and tRPC refuse the same values. */
function checkSetting(key: string, value: string) {
  const setting = findSetting(key);

  if (setting?.kind === "count") {
    const max = setting.max;

    if (!WHOLE_NUMBER.test(value) || (max !== undefined && Number(value) > max)) {
      const range = max === undefined ? "of 1 or more" : `from 1 to ${max}`;

      throw new InvalidSettingError(key, `${setting.label} must be a whole number ${range}.`);
    }
  }

  if (setting?.kind === "money" && (!AMOUNT.test(value) || Number(value) === 0)) {
    throw new InvalidSettingError(
      key,
      `${setting.label} must be an amount above zero, like 120 or 89.50, without a $.`,
    );
  }
}

export async function setConfigValue(
  householdId: string,
  key: string,
  value: string,
  db: Queryable = defaultDb,
): Promise<void> {
  await setConfigValues(householdId, { [key]: value }, db);
}

/** Every value is checked before any is written, so a refused one leaves the others unwritten. */
export async function setConfigValues(
  householdId: string,
  values: Config,
  db: Queryable = defaultDb,
): Promise<void> {
  const entries = Object.entries(values);

  for (const [key, value] of entries) {
    checkSetting(key, value);
  }

  if (entries.length === 0) {
    return;
  }

  await db
    .insert(schema.config)
    .values(entries.map(([key, value]) => ({ householdId, key, value })))
    .onConflictDoUpdate({
      target: [schema.config.householdId, schema.config.key],
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
}

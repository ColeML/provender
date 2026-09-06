import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

/**
 * The database client.
 *
 * The WebSocket driver rather than `neon-http`. Neon's own guidance prefers HTTP for serverless
 * functions, and it is cheaper per query — but it cannot run an interactive transaction, and
 * writing a week's plan (clear the day, insert main + side + extras) has to be one.
 *
 * Connecting is deferred until the first query rather than done at import time. `next build`
 * imports every module to collect page data, and a client that dialled Postgres on import would
 * make a reachable database a requirement for building — which it is not, and which fails in CI.
 */
type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Outside production the instance is cached on `globalThis`, not just in module scope.
 *
 * `next dev` re-evaluates this module on every hot reload and module scope does not survive that,
 * so each reload would hand out a fresh client and, on first query, a fresh pool. `globalThis`
 * does survive it. Production deliberately does not use it: the module is evaluated once.
 */
const globalForDb = globalThis as unknown as { db?: Db };

let instance: Db | undefined;

function connect(): Db {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return drizzle({ client: new Pool({ connectionString }), schema });
}

function resolve(): Db {
  if (process.env.NODE_ENV === "production") {
    instance ??= connect();

    return instance;
  }

  globalForDb.db ??= connect();

  return globalForDb.db;
}

export const db = new Proxy({} as Db, {
  get(_target, property) {
    const resolved = resolve();

    return resolved[property as keyof Db];
  },
});

export { schema };
export type Database = typeof db;

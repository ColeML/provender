import "server-only";

import { db } from "@server/db";

/** What every procedure gets. Built once per request. */
export function createContext() {
  return { db };
}

export type Context = ReturnType<typeof createContext>;

import "server-only";

import { householdForSession } from "@server/auth/household";
import { db } from "@server/db";

import { auth } from "../../auth";

/**
 * What every procedure gets. Built once per request.
 *
 * The session is resolved here rather than per-procedure so a batched call costs one verification
 * no matter how many procedures it contains. `session` is null for a signed-out caller;
 * `protectedProcedure` is what turns that into a refusal — procedures should not read it directly,
 * and they take `householdId` from the narrowed context rather than resolving it themselves.
 */
export async function createContext() {
  const session = await auth();

  return {
    db,
    session,
    householdId: session?.user ? householdForSession() : null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

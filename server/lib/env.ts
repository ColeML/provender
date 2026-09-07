import "server-only";

import { z } from "zod";

/**
 * Only what a caller of `getEnv()` actually reads.
 *
 * The auth variables are deliberately absent. Each of their consumers validates at the point of
 * use and fails closed — `verifyPassword` on a missing `AUTH_PASSWORD_HASH`, the bearer middleware
 * on a missing `PROVENDER_API_TOKEN`, and Auth.js on its own `AUTH_SECRET` — and listing them here
 * as well would be validation nothing runs, while forcing the database client to demand three
 * variables it never uses.
 */
const EnvSchema = z.object({
  // The `error` argument covers the missing-key case too. Without it a missing variable reports
  // zod's "expected string, received undefined", which names the type and not the fix.
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).min(1, "DATABASE_URL is required"),
});

export type Env = z.infer<typeof EnvSchema>;

export function getEnv(env: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }

  return result.data;
}

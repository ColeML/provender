import { householdForSession } from "@server/auth/household";
import { getConfig } from "@server/services/config";
import { redirect } from "next/navigation";

import { auth } from "../../auth";

/**
 * Read at request time, not build time.
 *
 * Settings are live data, and prerendering would both freeze them into the build and make a
 * reachable database a requirement for building — which fails in CI and on a preview deploy
 * before the database is wired up.
 */
export const dynamic = "force-dynamic";

/**
 * The walking skeleton's proof: a Server Component reading through the service layer, with no
 * HTTP hop of its own. The same `getConfig` backs `GET /v1/config` and the `config.get` tRPC
 * procedure.
 */
export default async function Home() {
  // The real check. The proxy only saw that a cookie existed; this verifies it.
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const config = await getConfig(householdForSession());
  const entries = Object.entries(config);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Provender</h1>
      <p className="text-muted-foreground mt-1 text-sm">Household settings, read from Neon.</p>

      {entries.length === 0 ? (
        <p className="mt-8 text-sm">
          No settings yet. Your household settings still live in the v1 spreadsheet — importing them
          is issue #37.
        </p>
      ) : (
        <dl className="mt-8 divide-border divide-y">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 py-2 text-sm">
              <dt className="text-muted-foreground font-mono">{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </main>
  );
}

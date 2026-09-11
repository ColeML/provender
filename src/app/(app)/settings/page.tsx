import { householdForSession } from "@server/auth/household";
import { getConfig } from "@server/services/config";
import { redirect } from "next/navigation";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — Provender" };

export default async function Settings() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const entries = Object.entries(await getConfig(householdForSession(session)));

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        What the planner assumes about the household. Edit them with{" "}
        <code className="font-mono">PATCH /v1/config</code>.
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm">No settings yet.</p>
      ) : (
        <dl className="divide-border mt-6 divide-y">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 py-2 text-sm">
              <dt className="text-muted-foreground font-mono">{key}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </main>
  );
}

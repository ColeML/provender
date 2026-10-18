import { householdForSession } from "@server/auth/household";
import { getConfig } from "@server/services/config";
import { listIngredientStores, listStores } from "@server/services/stores";
import { redirect } from "next/navigation";

import { IngredientStores } from "@/components/settings/ingredient-stores";
import { Stores } from "@/components/settings/stores";
import { ThemePicker } from "@/components/theme/theme-picker";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — Provender" };

export default async function Settings() {
  const session = await auth();

  if (!session?.user) {
    redirect(await loginUrl());
  }

  const householdId = householdForSession(session);
  const [config, stores, rules] = await Promise.all([
    getConfig(householdId),
    listStores(householdId),
    listIngredientStores(householdId),
  ]);
  const entries = Object.entries(config);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>

      <div className="mt-6">
        <ThemePicker />
      </div>

      <section aria-labelledby="stores-heading" className="mt-10">
        <h2 id="stores-heading" className="text-lg font-semibold">
          Stores
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Where you shop. The planner reads each store&apos;s notes when it decides where every item
          on the shopping list comes from.
        </p>
        <Stores
          stores={stores.map((store) => ({
            id: store.id,
            name: store.name,
            notes: store.notes,
            primary: store.primary,
          }))}
        />
      </section>

      <section aria-labelledby="where-to-buy-heading" className="mt-10">
        <h2 id="where-to-buy-heading" className="text-lg font-semibold">
          Where to buy
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Ingredients you get from a particular store.
        </p>
        <IngredientStores
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            storeId: rule.storeId,
            only: rule.only,
          }))}
          stores={stores.map((store) => ({ id: store.id, name: store.name }))}
        />
      </section>

      <p className="text-muted-foreground mt-10 text-sm">
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

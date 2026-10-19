import { householdForSession } from "@server/auth/household";
import { findSetting, SETTINGS, type SettingSection } from "@server/lib/settings";
import { getConfig } from "@server/services/config";
import { krogerConfigured } from "@server/services/kroger";
import { listIngredientStores, listStores } from "@server/services/stores";
import { redirect } from "next/navigation";

import { IngredientStores } from "@/components/settings/ingredient-stores";
import { KrogerStoreRow } from "@/components/settings/kroger-store-row";
import { SettingRows, type SettingRowData } from "@/components/settings/setting-rows";
import { Stores } from "@/components/settings/stores";
import { ThemePicker } from "@/components/theme/theme-picker";
import { loginUrl } from "@/lib/login-url";

import { auth } from "../../../../auth";

/** Live data, and read at request time — see the note on the home page. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — Provender" };

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10 first-of-type:mt-6">
      {/* Focusable from script, so focus has somewhere to land when the Other section goes. */}
      <h2 id={`${id}-heading`} tabIndex={-1} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

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

  const rowsIn = (section: SettingSection, keys?: string[]): SettingRowData[] =>
    SETTINGS.filter(
      (setting) =>
        setting.section === section &&
        !setting.hidden &&
        (keys === undefined || keys.includes(setting.key)),
    ).map((setting) => ({ setting, value: config[setting.key] }));

  const other: SettingRowData[] = Object.keys(config)
    .filter((key) => findSetting(key) === undefined)
    .sort()
    .map((key) => ({ setting: { key, label: key, kind: "text" }, value: config[key], raw: true }));

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>

      <Section id="household" title="Household">
        <SettingRows rows={rowsIn("household")} />
      </Section>

      <Section id="food" title="Food">
        <SettingRows rows={rowsIn("food")} />
      </Section>

      <Section id="planning" title="Planning">
        <SettingRows rows={rowsIn("planning")} />
      </Section>

      <Section id="shopping" title="Shopping">
        <SettingRows rows={rowsIn("shopping", ["pantry_staples"])} />

        <section aria-labelledby="stores-heading">
          <h3 id="stores-heading" className="mt-8 text-base font-semibold">
            Stores
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Where you shop. The planner reads each store&apos;s notes when it decides where every
            item on the shopping list comes from.
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

        <section aria-labelledby="where-to-buy-heading">
          <h3 id="where-to-buy-heading" className="mt-8 text-base font-semibold">
            Where to buy
          </h3>
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

        <div className="mt-8">
          <ul className="divide-border border-border mt-2 divide-y border-y">
            <KrogerStoreRow
              locationId={config.kroger_location_id}
              name={config.kroger_location_name}
              configured={krogerConfigured()}
            />
          </ul>
        </div>
      </Section>

      <Section id="appearance" title="Appearance">
        <div className="mt-2">
          <ThemePicker />
        </div>
      </Section>

      {other.length === 0 ? null : (
        <Section id="other" title="Other">
          <p className="text-muted-foreground mt-1 text-sm">
            Settings the planner keeps under their stored names.
          </p>
          <SettingRows rows={other} focusWhenEmpty="appearance-heading" />
        </Section>
      )}
    </main>
  );
}

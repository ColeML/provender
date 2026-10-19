/**
 * The household settings the app knows by name. Config stays an open key/value table, so a key
 * missing here is still stored and shown, under its raw name, in the Settings page's Other section.
 *
 * Outside `server/services/` because the settings form imports it, and services are `server-only`.
 */
/** `krogerStore` is picked from a ZIP code search, never typed. */
export type SettingKind = "text" | "longText" | "count" | "money" | "krogerStore";

export type SettingSection = "household" | "food" | "planning" | "shopping";

export interface Setting {
  key: string;
  label: string;
  section: SettingSection;
  kind: SettingKind;
  hint?: string;
  placeholder?: string;
  max?: number;
  /** What the app uses when the key is unset, as the row shows it. */
  fallback?: string;
  /** Written alongside another setting, so it has no row of its own. */
  hidden?: true;
}

/** The default when Config has no `no_repeat_days`, matching v1. */
export const DEFAULT_NO_REPEAT_DAYS = 30;

export const SETTINGS: readonly Setting[] = [
  {
    key: "household",
    label: "Who's eating",
    section: "household",
    kind: "text",
    placeholder: "Two adults and a toddler",
  },
  { key: "people", label: "Servings per meal", section: "household", kind: "count" },
  {
    key: "location",
    label: "Location",
    section: "household",
    kind: "text",
    hint: "For the weather forecast.",
    placeholder: "Oklahoma City, OK",
  },
  { key: "allergies", label: "Allergies", section: "food", kind: "text" },
  { key: "dietary_restrictions", label: "Dietary restrictions", section: "food", kind: "text" },
  { key: "dislikes", label: "Dislikes", section: "food", kind: "text" },
  {
    key: "preferences",
    label: "Notes for the planner",
    section: "food",
    kind: "longText",
    placeholder: "Quick weeknights. One new main a week.",
  },
  { key: "default_meals", label: "Dinners per week", section: "planning", kind: "count", max: 7 },
  { key: "default_budget", label: "Weekly budget", section: "planning", kind: "money" },
  {
    key: "no_repeat_days",
    label: "Days before a main repeats",
    section: "planning",
    kind: "count",
    fallback: `${DEFAULT_NO_REPEAT_DAYS} days (default)`,
  },
  {
    key: "equipment",
    label: "Equipment",
    section: "planning",
    kind: "text",
    placeholder: "Instant Pot, sheet pans",
  },
  {
    key: "pantry_staples",
    label: "Pantry staples",
    section: "shopping",
    kind: "text",
    hint: "Marked as already on hand when the shopping list is built.",
    placeholder: "Salt, olive oil, flour",
  },
  { key: "kroger_location_id", label: "Kroger store", section: "shopping", kind: "krogerStore" },
  {
    key: "kroger_location_name",
    label: "Kroger store name",
    section: "shopping",
    kind: "text",
    hidden: true,
  },
];

export function findSetting(key: string): Setting | undefined {
  return SETTINGS.find((setting) => setting.key === key);
}

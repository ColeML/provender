# Settings in the app

Every household setting becomes editable on `/settings`, one row at a time, the way a store
is. The page is regrouped into five sections plus an Other section, and raw key names show only
in Other.

## Data and contract changes

- **List of known settings.** It lives in `server/lib/settings.ts`, not `server/services/`,
  because the client component imports it and `server/services/*` is `server-only` (the stores
  form already imports `@server/lib/slug` this way). Each entry has a `key`, `label`, `section`,
  `kind`, and optional `hint` and `placeholder`. Values are still stored as text, so the
  database is unchanged and needs no migration.

  | Section | Key | Label | Kind |
  |---|---|---|---|
  | Household | `household` | Who's eating | text |
  | Household | `people` | Servings per meal | count |
  | Household | `location` | Location | text |
  | Food | `allergies` | Allergies | text |
  | Food | `dietary_restrictions` | Dietary restrictions | text |
  | Food | `dislikes` | Dislikes | text |
  | Food | `preferences` | Notes for the planner | long text |
  | Planning | `default_meals` | Dinners per week | count, 1–7 |
  | Planning | `default_budget` | Weekly budget | money |
  | Planning | `no_repeat_days` | Days before a main repeats | count |
  | Planning | `equipment` | Equipment | text |
  | Shopping | `pantry_staples` | Pantry staples | text |
  | Shopping | `kroger_location_id` | Kroger store | Kroger picker |

  A count is a whole number of 1 or more. Money is a positive number with up to two decimal
  places, stored without a `$`.
- **`setConfigValue` checks known keys** against their kind and throws `InvalidSettingError` on a
  bad value. tRPC maps the error to `BAD_REQUEST` and REST maps it to `400 INVALID_ARGUMENT`.
  Because the check lives in the service, `PATCH /v1/config` and the app accept and reject the
  same values. Unknown keys are accepted as any text.
- **`deleteConfigValue(householdId, key)`** is new. Saving an empty field calls it, and code
  that reads the key falls back to its built-in default (30 for `no_repeat_days`).
- **tRPC:** `config.set({ key, value })`, `config.delete({ key })`, and
  `kroger.findLocations({ zipCode })` for the picker.
- **REST:** `DELETE /v1/config/{key}`. `PATCH` keeps its shape.

## Page

Top to bottom: Appearance (theme), Household, Food, Planning, Shopping (pantry staples, then the
existing Stores and Where to buy lists, then the Kroger store), and Other. Other appears only
when the household has keys that aren't on the list. The "Edit them with `PATCH /v1/config`"
line is removed.

Visual direction is a household ledger page. Each setting is a row ruled by a hairline
`border-border`, with the label on the left and the value on the right, which is the
`DESIGN.md` manuscript reference the page already uses. Two other directions were dropped: a
card-box index with tabbed dividers fits a recipe box better than settings, and a grid of
setting cards is the generated-design reflex `DESIGN.md` rejects. How state looks:

- A set value shows in the UI face.
- An unset value shows in muted text: the default for keys that have one ("30 days (default)"),
  and "Not set" for the rest.
- The pencil opens a one-field form in place, between the same rules, with Save and Cancel. It
  works like `StoreForm`: it stays pending through the page refresh, keeps what you typed if the
  save fails, and shows the server's message for a bad value.
- Long text uses a textarea. Counts and money use `inputMode="numeric"` / `"decimal"`.
- Rows, pencils and buttons are at least 44px tall. Colors come from existing tokens, which
  already pass AA contrast.

**Kroger picker:** a ZIP code field, then a list of the stores `findLocations` returns. Picking
one saves `kroger_location_id` and `kroger_location_name` together. The row shows the name.
`kroger_location_name` is on the list without a row of its own, so it never shows in Other.
When Kroger isn't set up on the server (`KrogerNotConfiguredError`), the row reads "Kroger
isn't set up" and has no pencil.

**Other:** each unknown key is a row under its raw key name, editable and clearable as plain
text. The app has no control for adding a new key.

## Rejected alternatives

- **One Edit form per section.** Saving a section would rewrite fields you didn't touch, and it
  would add a second edit pattern beside Stores.
- **One column per setting.** It needs a migration for every new setting, which the key/value
  table exists to avoid (see `server/db/schema/config.ts`).
- **Chips for list-like settings.** The skills read these fields as prose. Chips can come later
  without changing the stored value.
- **Hiding unknown keys.** A key an agent set would disappear from view, and you couldn't clear
  `stores` or `repeat_policy`.
- **Typing in the Kroger store number by hand.** Nobody knows their store's number.

## Open questions

- Should `kroger_location_name` be written with the id, as above? The other way is looking the
  name up from Kroger on each page load, which slows the page and fails whenever Kroger is down.

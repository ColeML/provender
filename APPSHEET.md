# Optional: a phone GUI with Google AppSheet

The planner works fine straight from the Google Sheets mobile app, but if you want
a nicer phone experience (calendar, recipe cards, a real shopping checklist) you
can layer **Google AppSheet** on top of the *same* spreadsheet for free (personal
use). No backend changes — Claude Code keeps writing the sheet; AppSheet reads and
writes the same data live.

> The sheet is already prepped for this: `ShoppingList` has a stable `id` key
> column, and `Recipes` is keyed by `recipe_id`.

## 1. Create the app

1. Open the **Meal Planner** spreadsheet on desktop.
2. **Extensions → AppSheet → Create an app** (or go to appsheet.com → *Create →
   App → With your own data* and pick the spreadsheet).
3. AppSheet imports the tabs as **tables**. Add any it skips via *Data → + Add
   table*: you want `Config`, `WeekPlan`, `Recipes`, `Ingredients`, `ShoppingList`,
   `History`.

## 2. Set key columns (Data → each table → Columns)

A good key is unique per row so AppSheet tracks edits correctly:

| Table | Key | Notes |
|---|---|---|
| `ShoppingList` | `id` | already unique (slug of item) |
| `Recipes` | `recipe_id` | set its **Label** to `title` so refs show nicely |
| `WeekPlan` | `day` | 7 fixed slots (Mon-Sun); stable keys = reliable sync |
| `Config` | `key` | |
| `Ingredients` | *(let AppSheet auto-key)* | append-only, display under a recipe |
| `History` | `id` | unique (`date` + `recipe_id`); a recipe can recur on different dates |

## 3. Set column types

AppSheet usually auto-detects, but confirm:

- `ShoppingList.bought` and `have_already` → **Yes/No** (renders as a toggle)
- `ShoppingList.est_cost`, `Recipes.cost_estimate` → **Decimal** (or Price)
- `Recipes.source_url` → **Url** (tappable link)
- `Recipes.doc_url` → **Url** (tappable link) — opens the rendered recipe page
  (`prov recipe-render`); relabel as **Open recipe page** for a clean read/share view
  when AppSheet's own rendering feels fiddly
- `WeekPlan.servings`, `Recipes.*_min`, `base_servings` → **Number**

## 4. Add relationships (Refs) for nice navigation

In **Data → Columns**, change these to type **Ref**:

- `Ingredients.recipe_id` → Ref to `Recipes` → now each recipe's detail view shows
  its ingredients nested underneath.
- `WeekPlan.recipe_id` and `WeekPlan.side_recipe_id` → Ref to `Recipes` → the
  calendar shows the real recipe title and links straight to the recipe card.

## 5. Build the views (UX → Views)

1. **This Week** — view of `WeekPlan`. `WeekPlan` always holds 7 day-slots keyed by
   `day`; unplanned days are blank, so filter them out: make a **slice** with
   condition `ISNOTBLANK([recipe_id])` and point the view at it. Use a **Table** or
   **Deck** view sorted by `date` (so it reads Mon→Sun). Title = `recipe_id` (shows
   the recipe title via the Ref); tap a day → recipe detail. (A Calendar view also
   works, but the slice keeps empty slots from cluttering it.)
2. **Recipes** — view of `Recipes`, type **Deck** or **Gallery**. Detail view shows
   ingredients (via the Ref) + a *View recipe* button on `source_url`.
3. **Shopping** — view of `ShoppingList`, type **Table**, **Group by** `category`
   so it reads aisle-by-aisle. Make `bought` an inline editable toggle. (Optional:
   add a filter/slice that hides rows where `bought = TRUE` so the list shrinks as
   you shop.)

## 6. Put it on your phone

- Install the **AppSheet** app (iOS/Android), sign in with the same Google account
  → your app is there. Or use *Share → Install* to add it to your home screen as a
  PWA. It syncs live with the sheet and works offline at the store.

## Good to know — how it interacts with Claude Code

- Claude regenerates `WeekPlan` and `ShoppingList` by **replacing the whole tab**
  (`plan-write` / `shopping-write`). AppSheet just syncs the new rows. This means a
  freshly generated week resets that tab — including any items you'd checked off on
  the *previous* list. That's expected: new week = fresh list.
- `Recipes`, `Ingredients`, and `History` are append-mostly, so they're stable
  references for the app.
- Keep edits that must survive a regeneration (e.g. marking a recipe rating) in
  the append-mostly tables, not in `WeekPlan`/`ShoppingList`.
- Free AppSheet is for personal/non-commercial use, up to 10 users — plenty for a
  household. (The "Deploy" prompt pushes a paid plan; for personal use you can run
  the app un-deployed.)

## Sharing this as a template

The AppSheet **app definition cannot be stored in git** — it lives in AppSheet's
cloud, and there's no export-to-file (it's a long-standing, unfilled feature
request). So "share the app" works in one of two ways:

**A. Copy-App link (a real, modifiable template).** This is the closest thing to
"someone uses it, then makes it their own":

1. In the editor: **Manage → Collaborate & Publish → Copy App** (or *My Apps →
   More → Copy*) → enable copying / get a share link.
2. Whoever opens the link gets a **full copy** of the app definition (views,
   actions, format rules, column types) on *their* AppSheet account, which they can
   modify freely.
3. They re-point it at **their own** Sheet: next to the Data Source field, use
   **Copy Data to New Source** (or set the source to the Sheet they created by
   cloning this repo + `prov init`).

   Caveat: the copy is an AppSheet-cloud artifact, not versioned in git, and each
   person needs their own Google Sheet + service-account key (the repo handles that
   side).

**B. Rebuild from this guide.** `APPSHEET.md` *is* the git-managed, version-
controlled recipe. Anyone (or an AI agent walking them through it) rebuilds the app
on their Sheet by following sections 1–6 above. Slower than a copy link, but fully
reproducible and tracked in the repo.

So the **engine is git-shareable** (clone the repo → CLI, skills, Sheet schema);
the **GUI is shared via a Copy-App link or this recipe**.

## Free GUI options (trade-offs)

The data lives in Google Sheets and the agent writes it live, so the GUI just needs
to read/write that same Sheet. Options, friendliest-data-fit first:

- **Google Sheets mobile app** — free forever, zero build, already works (tap the
  `bought` checkboxes). Least pretty, but no paywall and "sharing" is just sharing
  the Sheet.
- **AppSheet** — deepest Google Sheets integration (why this guide uses it); free
  for personal use; editor is powerful but fiddly. Best fit for a Sheet-backed app.
- **Glide** — the friendliest *builder*, but it penalizes external Google Sheets
  (sync-based limits) and nudges you to its own database — which would break the
  "agent + phone share one live Sheet" model. Only worth it if you move data into
  Glide Tables.
- **Softr** — polished, but oriented to web portals and to Airtable; Sheets is a
  second-class source.

Bottom line: for a **Sheet-centric** planner like this, AppSheet (or just the
Sheets app) keeps the live link intact; the "friendlier" builders are friendlier
because they prefer their own storage.

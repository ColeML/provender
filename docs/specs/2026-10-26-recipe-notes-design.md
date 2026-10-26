# Recipe notes: keep what the household learned on the recipe

Each recipe gets a list of notes, one tip per row, on the cook view at `/recipes/[slug]`. The
household adds a note with "+ Add", deletes one with its trash icon, and edits one with a long
press. The planner reads them through `GET /planning/rotation`. Closes #206.

## Current state

A recipe has a 1–5 `rating` and nothing else the household writes. Plan days and weeks take notes
(`plan_days.notes`, `week_notes`), and each history entry has a `notes` column that describes one
cooking ("swapped the andouille for kielbasa"). Nothing carries a tip forward to the next time
the dish comes up.

## Decisions

- **A list, not one text box.** Tips pile up and go stale, so each one is its own row that can be
  deleted alone. The rows look like the comma-list settings (#199) and the week notes on `/notes`.
- **Stored as `recipes.notes text[]`, replaced whole on each save.** Not comma text, because notes
  contain commas. Not a table: week notes need one for their dates, and these have none. Two
  phones adding at the same moment can lose one add, which the settings lists already accept.
- **The server normalizes every write.** Each note is trimmed, blank notes are dropped, and a note
  matching an earlier one (ignoring case) is dropped. Order is kept. The client never has to get
  this right for the stored list to be clean.
- **Notes are not part of `RecipeInput`.** `POST /recipes` and `:commit` do not take them, the same
  as `rating`: a note follows cooking the dish, not saving it. They are set with `PATCH` only.
- **History notes are not copied over.** Each one describes a single cooking, which is why the
  ratings change left them on the entry.
- **Notes stay off the share page.** `/r/[share_token]` picks recipe fields by name, so they do
  not reach it unless someone adds them. A page test pins that.
- **Long press is a shared hook.** The settings lists are meant to adopt it next, so it lives in
  `src/hooks/use-long-press.ts` with its own tests, not inside the notes component.
- **A note asking for a lasting change is applied, not kept.** "Make 1.5x" or "skip the olives"
  left as a note would be read by the planner and ignored by the shopping list, which uses stored
  quantities as they are. The planner offers to change the recipe and removes the note once it is
  applied.

## Data and migration

- `0016_add_recipe_notes`: `ALTER TABLE "recipes" ADD COLUMN "notes" text[] DEFAULT '{}' NOT NULL;`
  No backfill.
- The CI `migrate` job applies it after merge. Drizzle names every column it knows in queries, so
  recipe reads fail for the few minutes between the Vercel deploy and the migration. That is
  accepted while the household is the only user, so there is no manual production migration.

## API

- `updateRecipe` accepts `notes` in the mask. A mask naming `notes` with no `notes` in the body
  clears the list, matching every other field (AIP-134).
- `normalizeNotes(notes: string[]): string[]` in `server/services/recipes.ts` does the trimming,
  blank-dropping and case-insensitive dedupe. `updateRecipe` calls it.
- `PATCH /v1/recipes/{recipe}?updateMask=notes` takes `notes: string[]`. `GET /recipes` and
  `GET /recipes/{recipe}` return `notes`, always an array.
- tRPC `recipes.setNotes({ recipeId, notes })` calls `updateRecipe` with `["notes"]`.
- `GET /planning/rotation` rows carry `notes`.

## UI

**`RecipeNotes`** in `src/components/recipes/recipe-notes.tsx`, placed in `CookView` under
`RecipeRating` and above Servings. The page passes `recipe.notes`. Split like `NoteItem`: a
`NoteList` that takes `notes` and `onSave(next: string[])` and has no data layer, and a
`RecipeNotes` wrapper that calls `recipes.setNotes` and `router.refresh()`.

- A `text-xs` "Notes" label, then one ruled row per note (`divide-y border-y`, like
  `ListSettingRow`). Line breaks show (`whitespace-pre-line`). With no notes, "No notes" in muted
  text.
- Each row: the note text as a full-width, left-aligned `<button>` wired to `useLongPress`, and a
  44px `Trash2` button labeled "Remove note: {first 40 characters}". Deleting saves the list
  without that note. Focus moves to the next row's note, else the previous, else "+ Add".
- "+ Add" opens a textarea (`cn(FIELD, "h-auto py-2")`, `rows={3}`, label "New note") with Save
  and Cancel. Enter inserts a line break; Save submits. Commas never split a note.
- **Editing.** A completed long press, or Enter or Space on the focused note, opens that row as a
  textarea holding the note, focused with the cursor at the end, with Save and Cancel. Save
  replaces the note at its index. A blank or unchanged draft closes without saving. Escape or
  Cancel closes without saving and returns focus to the note.
- One form is open at a time: opening an edit closes the add form and any other edit, discarding
  their drafts.
- A failed save keeps the draft and shows "Could not save that note. Try again." in a
  `role="alert"`. A failed delete shows "Not deleted — try again" under the row.
- Every add, edit and delete is one transition, so a second change never builds on the list the
  first replaces (the `ListSettingRow` pattern).

**`useLongPress(onLongPress, { delay = 500, tolerance = 10 })`** in `src/hooks/use-long-press.ts`
returns props to spread on the element.

- `onPointerDown` (primary button only) records the point and starts the timer. `onPointerMove`
  past `tolerance` px, `onPointerUp`, `onPointerCancel` and `onPointerLeave` clear it. The browser
  fires `pointercancel` when it takes the gesture for a scroll, which is a second guard.
- When the timer fires: `navigator.vibrate?.(10)`, then `onLongPress()`.
- `onClick` calls `onLongPress()` only when `event.detail === 0`, which is how a click from Enter,
  Space or assistive technology arrives. A tap or mouse click has `detail >= 1` and does nothing.
- `onContextMenu` calls `preventDefault()` after a touch press, so Android's long-press menu does
  not open over the edit.
- The element gets `select-none [-webkit-touch-callout:none]` so iOS neither selects the text nor
  shows its callout. The hook returns that class string as `className`.
- The timer is cleared on unmount.

Screen readers: the note button has an `aria-describedby` hint, rendered once per list as
`sr-only`: "Long press or press Enter to edit." VoiceOver on iOS may deliver its double-tap as a
click with `detail` 1. If the walk-through shows that, double-tap-and-hold (VoiceOver's
pass-through gesture) still delivers a real long press, and the hint should say so.

## Planning skills

- `plan-week`, step 2: a new rule after Ratings. Each rotation row carries `notes`. Weigh them like
  ratings when choosing, and carry a relevant one into the day's note. A note asking for a lasting
  quantity or ingredient change is raised in step 5 as an offer. On a yes, after the commit, follow
  `scale-recipe` or `PATCH` the ingredients, then `PATCH` the notes without that one. This is the
  one exception to step 3's "never `PATCH` a recipe from here", and it needs the household's yes.
- `scale-recipe`, step 1: also `GET /recipes/<recipe>` and read `notes` before scaling. A note
  like "kids eat double" changes the target, and a note naming an amount must be restated at the
  new count.

## Testing

- Migration: `0016` adds the column, and existing rows read `{}`.
- Service, on `createTestDb`: `updateRecipe` sets, normalizes and clears `notes`; a mask without
  `notes` leaves them; isolation, so household B's notes never change A's `fajitas`;
  `planningRotation` reports them.
- Route: PATCH sets and returns notes, and rejects a non-array. POST returns `notes: []`. Rotation
  rows carry `notes`.
- `useLongPress`, with fake timers: fires after the delay; does not fire on early release, on
  movement past the tolerance, or on `pointercancel`; a tap's click does nothing; a `detail: 0`
  click fires; a secondary button does nothing; unmounting clears the timer.
- `NoteList`: renders rows and "No notes"; adds; deletes, with focus; long press opens an edit
  that saves, cancels, keeps the old text on a blank draft, and keeps the draft on failure; Enter
  opens an edit; one form open at a time.
- Share page: `getSharedRecipe` mocked with notes, and the rendered page does not contain them.
- No Playwright test, for the reason the ratings change gave: the e2e database must stay empty for
  the empty-state tests. The long press is walked by hand on a dev server with touch emulation at
  375px, light and dark, and on a phone if one is at hand.

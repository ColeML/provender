# Recipe Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each recipe a list of household notes that are added, deleted and long-press edited on the cook view, and read by the planner.

**Architecture:** One new column, `recipes.notes text[]`. `updateRecipe` gains a `notes` mask field that normalizes the list, and the REST PATCH and a new tRPC `recipes.setNotes` both call it. `planningRotation` carries the notes. A shared `useLongPress` hook drives editing in a new `RecipeNotes` component inside `CookView`. The share page is unchanged, and a test pins that.

**Tech Stack:** TypeScript, Next.js, Drizzle ORM + drizzle-kit, Postgres (Neon; PGlite in tests), Hono + `@hono/zod-openapi`, tRPC + TanStack Query, Vitest + Testing Library, lucide-react.

**Spec:** `docs/specs/2026-10-26-recipe-notes-design.md`

## Global Constraints

- All logic lives in `server/services/*`; tRPC procedures, REST handlers and Server Components are thin callers (AGENTS.md).
- Every service function takes `householdId` first and filters on it.
- Notes are an array of strings. The server trims each, drops blanks, and drops a note matching an earlier one ignoring case, keeping order. Only `normalizeNotes` does this.
- `notes` is not added to `RecipeInput`, so `POST /recipes` and `:commit` do not accept it.
- `PATCH` bodies follow AIP-134: only fields named in `updateMask` change; a named field omitted from the body is cleared.
- Tap targets are at least 44px (`min-h-11`, `size-11`). Colors come from tokens only (DESIGN.md).
- Comments: default to none. Only a non-obvious why earns one, one or two lines.
- American English in all prose and comments.
- Conventional commits, `Refs: #206` footer. Branch: `claude/epic-noether-7snbrq` (the spec and this plan are on it).
- The migration number is the next free one. It is `0016` as of 2026-10-26. If another migration lands on `main` first, merge `main` in and regenerate.
- Before pushing: `docker compose up -d`, then `pnpm lint`, `pnpm fmt:check`, `pnpm typecheck`, `pnpm vitest run`, `pnpm build`.

---

### Task 1: `recipes.notes` column and migration

**Files:**
- Modify: `server/db/schema/recipes.ts`
- Create: `server/db/migrations/0016_add_recipe_notes.sql` (generated)
- Generated: `server/db/migrations/meta/0016_snapshot.json`, `server/db/migrations/meta/_journal.json`
- Test: `server/db/migrations.test.ts`

**Interfaces:**
- Produces: `schema.recipes.notes` (`text[]`, not null, default `{}`). `Recipe` gains `notes: string[]`.

- [ ] **Step 1: Write the failing migration test**

Append to `server/db/migrations.test.ts`, reusing the file's `migrationFiles` and `apply` helpers the same way the recipe rating test does:

```ts
describe("the recipe notes migration", () => {
  it("gives every existing recipe an empty list of notes", async () => {
    const client = new PGlite();
    const files = await migrationFiles();
    const notes = files.findIndex((file) => file.includes("add_recipe_notes"));

    expect(notes).toBeGreaterThan(0);

    for (const file of files.slice(0, notes)) {
      await apply(client, file);
    }

    await client.exec(`
      INSERT INTO households (id, name) VALUES ('loewer', 'Loewer');
      INSERT INTO recipes (household_id, id, title, base_servings) VALUES ('loewer', 'tacos', 'Tacos', 4);
    `);

    await apply(client, files[notes]);

    const recipes = await client.query<{ notes: string[] }>("SELECT notes FROM recipes");

    expect(recipes.rows).toEqual([{ notes: [] }]);

    await client.close();
  }, 60_000);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm vitest run server/db/migrations.test.ts`
Expected: FAIL on `expect(notes).toBeGreaterThan(0)`, received `-1`.

- [ ] **Step 3: Add the column to the drizzle schema**

In `server/db/schema/recipes.ts`, after `rating`:

```ts
    /** The household's tips, one per element, in the order they were added. */
    notes: text("notes").array().notNull().default([]),
```

- [ ] **Step 4: Generate the migration**

Invoke `cml:migrations` before generating. Then run: `pnpm db:generate --name add_recipe_notes`
Expected: `server/db/migrations/0016_add_recipe_notes.sql` contains exactly:

```sql
ALTER TABLE "recipes" ADD COLUMN "notes" text[] DEFAULT '{}' NOT NULL;
```

Any other statement means the schema has drifted from the snapshot. Stop and investigate before continuing.

- [ ] **Step 5: Run the migration test and the full suite**

Run: `pnpm vitest run server/db/migrations.test.ts` → PASS.
Run: `pnpm vitest run` → PASS. If `pnpm typecheck` now fails on a hand-built `Recipe` literal in a test, add `notes: []` to it.

- [ ] **Step 6: Commit**

```bash
git add server/db/schema/recipes.ts server/db/migrations server/db/migrations.test.ts
git commit -m "feat(recipes): add a notes column" -m "Refs: #206"
```

---

### Task 2: Set notes through `updateRecipe`

**Files:**
- Modify: `server/services/recipes.ts` (`updateRecipe`, around line 348)
- Test: `server/services/recipes.test.ts`, `server/services/isolation.test.ts`

**Interfaces:**
- Consumes: `schema.recipes.notes` (Task 1).
- Produces: `normalizeNotes(notes: string[]): string[]`. `updateRecipe`'s `input` becomes `Partial<RecipeInput> & { rating?: number | null; notes?: string[] }`, and `"notes"` is a valid mask field.

- [ ] **Step 1: Write the failing service tests**

In `server/services/recipes.test.ts`, add a `describe("normalizeNotes", ...)`:

```ts
describe("normalizeNotes", () => {
  it("trims, drops blanks and drops a repeat ignoring case, keeping order", () => {
    expect(
      normalizeNotes(["  Use a rotisserie chicken ", "", "   ", "Double the sauce", "use a ROTISSERIE chicken"]),
    ).toEqual(["Use a rotisserie chicken", "Double the sauce"]);
  });

  it("keeps the line breaks inside a note", () => {
    expect(normalizeNotes(["Sear in batches.\nDon't crowd the pan."])).toEqual([
      "Sear in batches.\nDon't crowd the pan.",
    ]);
  });
});
```

Inside `describe("updateRecipe", ...)`:

```ts
  it("sets notes, normalized, and clears them", async () => {
    await updateRecipe(HOUSEHOLD, "fajitas", ["notes"], { notes: [" Warm the tortillas ", ""] }, undefined, db);

    expect((await getRecipe(HOUSEHOLD, "fajitas", db)).notes).toEqual(["Warm the tortillas"]);

    await updateRecipe(HOUSEHOLD, "fajitas", ["notes"], {}, undefined, db);

    expect((await getRecipe(HOUSEHOLD, "fajitas", db)).notes).toEqual([]);
  });

  it("leaves notes alone when the mask does not name them", async () => {
    await updateRecipe(HOUSEHOLD, "fajitas", ["notes"], { notes: ["Warm the tortillas"] }, undefined, db);
    await updateRecipe(HOUSEHOLD, "fajitas", ["title"], { title: "Beef Fajitas" }, undefined, db);

    expect((await getRecipe(HOUSEHOLD, "fajitas", db)).notes).toEqual(["Warm the tortillas"]);
  });
```

In `server/services/isolation.test.ts`, inside `describe("recipes", ...)`, after the rating test:

```ts
  it("will not let one household's notes change another's recipe of the same id", async () => {
    await createRecipe(B, "fajitas", { ...recipe, title: "Their Fajitas" }, [], db);

    await updateRecipe(B, "fajitas", ["notes"], { notes: ["Theirs"] }, undefined, db);

    await expect(getRecipe(A, "fajitas", db)).resolves.toMatchObject({ notes: [] });
    await expect(getRecipe(B, "fajitas", db)).resolves.toMatchObject({ notes: ["Theirs"] });
  });
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/services/recipes.test.ts server/services/isolation.test.ts`
Expected: FAIL. `normalizeNotes` is not exported, and the notes stay `[]`.

- [ ] **Step 3: Implement**

In `server/services/recipes.ts`, above `updateRecipe`:

```ts
/** What every write stores: trimmed, no blanks, and no note twice when only the case differs. */
export function normalizeNotes(notes: string[]) {
  const seen = new Set<string>();

  return notes
    .map((note) => note.trim())
    .filter((note) => {
      const folded = note.toLowerCase();

      if (note === "" || seen.has(folded)) {
        return false;
      }

      seen.add(folded);

      return true;
    });
}
```

Change the `input` parameter of `updateRecipe`:

```ts
  input: Partial<RecipeInput> & { rating?: number | null; notes?: string[] },
```

Add after the `rating` line in the patch block:

```ts
    if (fields.has("notes")) patch.notes = normalizeNotes(input.notes ?? []);
```

- [ ] **Step 4: Run the service tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/recipes.ts server/services/recipes.test.ts server/services/isolation.test.ts
git commit -m "feat(recipes): set a recipe's notes through updateRecipe" -m "Refs: #206"
```

---

### Task 3: REST and tRPC

**Files:**
- Modify: `server/api/schemas.ts` (`RecipeSchema`)
- Modify: `server/api/routes/recipes.ts` (`toRecipeResource`, `UPDATABLE_FIELDS`, the PATCH body schema)
- Modify: `server/trpc/routers/index.ts` (`recipes` router)
- Test: `server/api/routes/recipes.test.ts`

**Interfaces:**
- Produces: the REST `Recipe` resource has `notes: string[]`. tRPC `recipes.setNotes({ recipeId: string, notes: string[] })` returns the updated `Recipe`.

- [ ] **Step 1: Write the failing route tests**

In `server/api/routes/recipes.test.ts`, inside `describe("PATCH /v1/recipes/{recipe}", ...)`:

```ts
  it("replaces the notes named in the mask, normalized, and returns them", async () => {
    const response = await patch("updateMask=notes", { notes: ["Double the sauce", " ", "double the SAUCE"] });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ notes: ["Double the sauce"] });
  });

  it("rejects notes that are not a list of strings", async () => {
    const response = await patch("updateMask=notes", { notes: "Double the sauce" });

    expect(response.status).toBe(400);
  });
```

Extend the "creates the recipe and returns an AIP resource name" expectation in `describe("POST /v1/recipes", ...)` with `notes: []`.

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/api/routes/recipes.test.ts`
Expected: FAIL. The PATCH gets 400 "Unknown field(s) in updateMask: notes", and POST has no `notes`.

- [ ] **Step 3: Implement**

`server/api/schemas.ts`, in `RecipeSchema` after `rating`:

```ts
    notes: z.array(z.string()).openapi({ example: ["Use a rotisserie chicken"] }),
```

`server/api/routes/recipes.ts`:
- `toRecipeResource`: add `notes: recipe.notes,` after `rating`.
- `UPDATABLE_FIELDS`: add `"notes",` after `"rating"`.
- PATCH body: extend the schema with `notes: z.array(z.string()).optional(),` next to `rating`.

`server/trpc/routers/index.ts`, in the `recipes` router after `setRating`:

```ts
    setNotes: protectedProcedure
      .input(z.object({ recipeId: z.string().min(1), notes: z.array(z.string()) }))
      .mutation(({ ctx, input }) =>
        updateRecipe(ctx.householdId, input.recipeId, ["notes"], { notes: input.notes }, undefined, ctx.db),
      ),
```

- [ ] **Step 4: Run the route tests** → PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Confirm the spec**

Run `pnpm dev`, then `PROVENDER_BASE_URL=http://localhost:3000 ./scripts/prov GET /openapi.json | jq '.components.schemas.Recipe.properties.notes'`
Expected: an array-of-strings schema.

- [ ] **Step 6: Commit**

```bash
git add server/api server/trpc
git commit -m "feat(recipes): read and write notes through the API" -m "Refs: #206"
```

---

### Task 4: Rotation carries the notes

**Files:**
- Modify: `server/services/planning.ts` (`RotationEntry`, the `base` object in `planningRotation`)
- Modify: `server/api/routes/planning.ts` (`toResource`, `RotationEntrySchema`)
- Test: `server/services/planning.test.ts`, `server/api/routes/planning.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server/services/planning.test.ts`, after the rating tests:

```ts
  it("reports the recipe's notes", async () => {
    await updateRecipe(H, "tacos", ["notes"], { notes: ["Warm the tortillas"] }, undefined, db);

    expect(await tierOf("tacos")).toMatchObject({ notes: ["Warm the tortillas"] });
    expect(await tierOf("ziti")).toMatchObject({ notes: [] });
  });
```

In `server/api/routes/planning.test.ts`, add `notes: []` to the expected rotation row.

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run server/services/planning.test.ts server/api/routes/planning.test.ts` → FAIL, no `notes`.

- [ ] **Step 3: Implement**

- `RotationEntry`: add `notes: string[];` after `rating`.
- `planningRotation`'s `base`: add `notes: recipe.notes,` after `rating`.
- `toResource`: add `notes: entry.notes,`.
- `RotationEntrySchema`: add `notes: z.array(z.string()),`.

- [ ] **Step 4: Run the tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/planning.ts server/services/planning.test.ts server/api/routes/planning.ts server/api/routes/planning.test.ts
git commit -m "feat(planning): carry a recipe's notes in the rotation" -m "Refs: #206"
```

---

### Task 5: `useLongPress`

**Files:**
- Create: `src/hooks/use-long-press.ts`
- Test: `src/hooks/use-long-press.test.tsx`

**Interfaces:**
- Produces: `useLongPress(onLongPress: () => void, options?: { delay?: number; tolerance?: number })`, returning `{ className, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onClick, onContextMenu }` to spread on a `<button>`. Defaults: `delay` 500ms, `tolerance` 10px.

- [ ] **Step 1: Write the failing tests**

`src/hooks/use-long-press.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLongPress } from "./use-long-press";

function Target({ onLongPress }: { onLongPress: () => void }) {
  const press = useLongPress(onLongPress);

  return (
    <button type="button" {...press}>
      Use a rotisserie chicken
    </button>
  );
}

function setup() {
  const onLongPress = vi.fn();
  const view = render(<Target onLongPress={onLongPress} />);

  return { onLongPress, button: screen.getByRole("button"), view };
}

const touch = { button: 0, pointerType: "touch", clientX: 100, clientY: 100 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLongPress", () => {
  it("fires once the press is held for the delay", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire when released early", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(button, touch);
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not fire when the finger moves past the tolerance, so a scroll never opens it", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientY: 111 });
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("still fires after a wobble inside the tolerance", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientX: 106, clientY: 106 });
    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the browser cancels the pointer", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerCancel(button, touch);
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores a secondary button", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, { ...touch, button: 2, pointerType: "mouse" });
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does nothing on a tap's click", () => {
    const { onLongPress, button } = setup();

    fireEvent.click(button, { detail: 1 });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("fires on a click from the keyboard or assistive technology", () => {
    const { onLongPress, button } = setup();

    fireEvent.click(button, { detail: 0 });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("blocks the context menu after a touch press, so Android's menu stays shut", () => {
    const { button } = setup();

    fireEvent.pointerDown(button, touch);

    expect(fireEvent.contextMenu(button)).toBe(false);
  });

  it("clears the timer when the element unmounts", () => {
    const { onLongPress, button, view } = setup();

    fireEvent.pointerDown(button, touch);
    view.unmount();
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
```

`fireEvent.click` defaults to `detail: 0`, which is the keyboard case, so the tap test passes `detail: 1` on purpose. If this repo's jsdom builds pointer events without `clientX` or `pointerType`, add a small `PointerEvent` class extending `MouseEvent` to `window` at the top of the file.

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run src/hooks/use-long-press.test.tsx` → FAIL, the module does not exist.

- [ ] **Step 3: Implement**

`src/hooks/use-long-press.ts`:

```ts
"use client";

import { type MouseEvent, type PointerEvent, useEffect, useRef } from "react";

interface Options {
  delay?: number;
  tolerance?: number;
}

/**
 * A press held for `delay` ms calls `onLongPress`. A tap does nothing, but a click with `detail`
 * 0 (Enter, Space, or a screen reader's activate) does, so the action is never touch-only.
 */
export function useLongPress(onLongPress: () => void, { delay = 500, tolerance = 10 }: Options = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const touched = useRef(false);
  const latest = useRef(onLongPress);

  useEffect(() => {
    latest.current = onLongPress;
  });

  function cancel() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }

    timer.current = null;
    origin.current = null;
  }

  useEffect(() => cancel, []);

  return {
    // iOS would otherwise select the text and raise its callout under a resting finger.
    className: "select-none [-webkit-touch-callout:none]",
    onPointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }

      cancel();
      touched.current = event.pointerType === "touch";
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;

        if ("vibrate" in navigator) {
          navigator.vibrate(10);
        }

        latest.current();
      }, delay);
    },
    onPointerMove(event: PointerEvent) {
      const start = origin.current;

      if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > tolerance) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick(event: MouseEvent) {
      if (event.detail === 0) {
        latest.current();
      }
    },
    onContextMenu(event: MouseEvent) {
      if (touched.current) {
        event.preventDefault();
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests** → PASS. Then `pnpm lint`. If a React hooks rule objects to the effect that copies `onLongPress` into the ref, follow the pattern `use-stored-flag.ts` or `use-wake-lock.ts` uses for the same problem.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-long-press.ts src/hooks/use-long-press.test.tsx
git commit -m "feat(app): add a long-press hook" -m "Refs: #206"
```

---

### Task 6: Notes on the cook view

**Files:**
- Create: `src/components/recipes/recipe-notes.tsx`
- Test: `src/components/recipes/recipe-notes.test.tsx`
- Modify: `src/components/recipes/cook-view.tsx` (`CookRecipe`, render `RecipeNotes`)
- Modify: `src/components/recipes/cook-view.test.tsx` (`RECIPE` gets `notes: []`, the tRPC mock gets `setNotes`)
- Modify: `src/app/(app)/recipes/[slug]/page.tsx` (pass `notes: recipe.notes`)

**Interfaces:**
- Consumes: tRPC `recipes.setNotes` (Task 3), `useLongPress` (Task 5), `BUTTON` and `PENCIL` from `@/components/settings/setting-rows`, `FIELD` from `@/components/ui/field`.
- Produces: `NoteList({ notes: string[], onSave: (next: string[]) => Promise<void> })`, which has no data layer, and `RecipeNotes({ recipeId: string, notes: string[] })`, which wires it to tRPC. `CookRecipe` gains `notes: string[]`.

Model the state and focus handling on `ListSettingRow` in `src/components/settings/setting-rows.tsx`: one `useTransition` shared by every change, a `deleted` ref that picks the row to focus after a delete, and a ref that returns focus when a form closes.

- [ ] **Step 1: Write the failing component tests**

`src/components/recipes/recipe-notes.test.tsx` renders `NoteList` with an `onSave` mock, using fake timers only in the long-press cases. Cover:

```tsx
// @vitest-environment jsdom
// Shape of the file; fill in each case.

describe("NoteList", () => {
  it("shows one row per note, keeping line breaks", ...);
  it("reads 'No notes' with no notes, and still offers + Add", ...);

  it("adds a note from + Add, at the end, without splitting on commas", ...);
  // onSave called with [...notes, "Salt, then pepper"]; the form closes and focus is on + Add.
  it("closes the add form without saving when the note is blank", ...);
  it("keeps what was typed and shows an alert when adding fails", ...);

  it("deletes a note and focuses the next row", ...);
  // aria-label "Remove note: Use a rotisserie chicken"; onSave without that note.
  it("says 'Not deleted — try again' under the row when deleting fails", ...);

  it("opens a note for editing on a long press, with its text and the cursor at the end", ...);
  // fireEvent.pointerDown with pointerType "touch", advance 500ms, expect a textbox "Edit note"
  // whose value is the note and whose selectionStart equals its length.
  it("does not open a note on a tap", ...);
  it("opens a note for editing with Enter", ...);
  it("saves an edit in place", ...);
  // onSave(["Use a rotisserie chicken", "Triple the sauce"]) for the second of two notes.
  it("closes without saving when the edit is blank or unchanged", ...);
  it("closes on Escape without saving and returns focus to the note", ...);
  it("keeps the draft and shows an alert when the edit fails", ...);
  it("closes the add form when a note is opened, and the other way round", ...);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm vitest run src/components/recipes/recipe-notes.test.tsx` → FAIL, the module does not exist.

- [ ] **Step 3: Implement `recipe-notes.tsx`**

Structure, in this file:

```tsx
"use client";

type Open = { kind: "add" } | { kind: "edit"; index: number } | null;

/** One note's text. A component of its own because each row needs its own hook. */
function NoteButton({ note, hintId, onEdit, ref }: { ...; ref: Ref<HTMLButtonElement> }) {
  const press = useLongPress(onEdit);

  return (
    <button
      ref={ref}
      type="button"
      aria-describedby={hintId}
      {...press}
      className={cn(
        press.className,
        "focus-visible:ring-ring min-h-11 w-full py-2.5 text-left text-base break-words whitespace-pre-line focus-visible:ring-3 focus-visible:outline-none",
      )}
    >
      {note}
    </button>
  );
}

export function NoteList({ notes, onSave }: { notes: string[]; onSave: (next: string[]) => Promise<void> }) {
  // open, draft, error, failedDelete, [pending, startTransition], refs for the note buttons,
  // the + Add button and the textarea, and the focus-return refs from ListSettingRow.
  // ...
}

export function RecipeNotes({ recipeId, notes }: { recipeId: string; notes: string[] }) {
  const trpc = useTRPC();
  const router = useRouter();
  const save = useMutation(trpc.recipes.setNotes.mutationOptions({ scope: { id: `notes-${recipeId}` } }));

  return (
    <NoteList
      notes={notes}
      onSave={async (next) => {
        await save.mutateAsync({ recipeId, notes: next });
        router.refresh();
      }}
    />
  );
}
```

Behavior `NoteList` must have (from the spec):

- `<section aria-labelledby="notes" className="mt-6">` with a `text-xs` muted "Notes" `h2`, then either "No notes" in `text-muted-foreground text-sm` or a `<ul className="divide-border border-border mt-1 divide-y border-y">`. Keys are indexes, since the server guarantees no repeats but a list position is the identity being edited.
- One `<p id={hintId} className="sr-only">Long press or press Enter to edit.</p>` per list.
- Each `<li className="flex items-start gap-2">`: the `NoteButton` (or, while it is the open edit, the edit form), then the delete button: `aria-label={\`Remove note: ${note.length > 40 ? \`${note.slice(0, 40)}…\` : note}\`}`, `className={cn(PENCIL, "aria-disabled:opacity-40")}`, `aria-disabled={pending}`, a `Trash2` icon at `size-4`.
- The form is shared by add and edit: a `<label>` ("New note" or "Edit note"), a `<textarea rows={3} className={cn(FIELD, "h-auto py-2")}>`, the alert when `error` is set, and Save (`cn(BUTTON, "bg-primary text-primary-foreground")`, disabled while pending) and Cancel (`cn(BUTTON, "text-muted-foreground")`). Its `onKeyDown` closes it on Escape. When it opens, focus the textarea and call `setSelectionRange(length, length)`.
- Add: `draft.trim()` blank closes; otherwise `onSave([...notes, text])`.
- Edit at `index`: `draft.trim()` blank or equal to `notes[index]` closes; otherwise `onSave(notes.map((note, at) => (at === index ? text : note)))`.
- Delete at `index`: `onSave(notes.filter((_, at) => at !== index))`. Focus the note button now at `index`, else `index - 1`, else + Add, after `notes` changes.
- Saves run as `startTransition(async () => { try { await onSave(next); startTransition(close); } catch { setError("Could not save that note. Try again."); } })`, the `ListSettingRow` pattern, so the form stays pending through the refresh.
- Opening an edit sets `open` to that index and `draft` to the note, which discards any other draft. Opening add does the same with an empty draft.
- "+ Add" is hidden while the add form is open: `className="focus-visible:ring-ring text-muted-foreground mt-1 min-h-11 text-sm focus-visible:ring-3 focus-visible:outline-none"`, `aria-label="Add a note"`.

- [ ] **Step 4: Run the component tests** → PASS.

- [ ] **Step 5: Wire it into the cook view**

- `cook-view.tsx`: add `notes: string[];` to `CookRecipe` after `rating`, and render `<RecipeNotes recipeId={recipe.recipeId} notes={recipe.notes} />` right after `<RecipeRating ... />`.
- `cook-view.test.tsx`: add `notes: []` to `RECIPE`, and `setNotes: { mutationOptions: () => ({ mutationFn: vi.fn() }) },` to the mocked `recipes`.
- `src/app/(app)/recipes/[slug]/page.tsx`: add `notes: recipe.notes,` after `rating`.

- [ ] **Step 6: Run the recipe component tests and typecheck**

Run: `pnpm vitest run src/components/recipes && pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/recipes src/app/\(app\)/recipes
git commit -m "feat(recipes): add, delete and long-press edit notes on the cook view" -m "Refs: #206"
```

---

### Task 7: Pin notes off the share page

**Files:**
- Create: `src/app/r/[share_token]/page.test.tsx`

The page already picks recipe fields by name, so this task adds no code: only a test that fails if someone later passes `notes` through.

- [ ] **Step 1: Write the test**

Follow the mocking pattern in `src/app/(app)/notes/page.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("@server/services/shares", () => ({
  getSharedRecipe: async () => ({
    recipe: {
      title: "Chicken Fajitas",
      baseServings: 8,
      totalMin: 30,
      sourceUrl: null,
      instructions: ["Slice the peppers."],
      notes: ["Kids want the cilantro on the side"],
    },
    ingredients: [],
  }),
}));

const { default: Shared } = await import("./page");

describe("the shared recipe page", () => {
  // Notes are the household talking to itself; a stranger with the link gets the dish only.
  it("does not show the household's notes", async () => {
    const { container } = render(await Shared({ params: Promise.resolve({ share_token: "t" }) }));

    expect(container).toHaveTextContent("Chicken Fajitas");
    expect(container).not.toHaveTextContent("cilantro");
  });
});
```

- [ ] **Step 2: Run it** → PASS. Then check it can fail: temporarily render `shared.recipe.notes` in the page, confirm the test fails, and revert.

- [ ] **Step 3: Commit**

```bash
git add "src/app/r/[share_token]/page.test.tsx"
git commit -m "test(recipes): keep notes off the shared recipe page" -m "Refs: #206"
```

---

### Task 8: The skills and AGENTS.md read the notes

**Files:**
- Modify: `.claude/skills/plan-week/SKILL.md` (step 2 rules, step 3, step 5, step 6)
- Modify: `.claude/skills/scale-recipe/SKILL.md` (step 1)
- Modify: `.claude/skills/plan-week/evals/evals.json`
- Modify: `AGENTS.md` (the "Recipes are stored at the servings you'll cook" invariant)

- [ ] **Step 1: Invoke `cml:writing-skills`** and follow its gates for these edits.

- [ ] **Step 2: plan-week, step 2.** Insert after rule 9 (Ratings) and renumber the two after it:

```markdown
10. **Recipe notes.** Each rotation row carries `notes`, the household's tips on that recipe
    ("use a rotisserie chicken", "only when it's cold out"). Weigh them like ratings when
    choosing, and carry one into the day's note when it changes how the day goes: a shortcut, a
    longer time. A note asking for a lasting change to amounts or ingredients ("make 1.5x", "skip
    the olives") is not followed here. Raise it in step 5.
```

- [ ] **Step 3: plan-week, step 3.** After "Never `PATCH` a recipe from here.", add: "Step 6 has the one exception, and it needs the household's yes."

- [ ] **Step 4: plan-week, step 5.** After the line about notes, add: "Then one line per recipe note asking for a lasting change: what it asks, and an offer to change the saved recipe."

- [ ] **Step 5: plan-week, step 6.** At the end, add:

```markdown
**A recipe note the household said yes to.** After the commit, follow **scale-recipe** to change
the amounts, or `PATCH` the ingredients. Then `PATCH /recipes/<recipe>?updateMask=notes` with that
note removed, so it is never applied twice.
```

- [ ] **Step 6: scale-recipe, step 1.** Add `./scripts/prov GET /recipes/<recipe>` to the block, and after it:

```markdown
Read the recipe's `notes`. One like "we eat double" bears on the target, so mention it if the
target ignores it. One naming an amount ("go light on the cayenne") still applies after scaling.
```

- [ ] **Step 7: Add the regression case** to `evals.json`: a rotation row with `tier: "eligible"` and `notes: ["Make 1.5x, we always run out"]`. If the planner picks it, step 5 offers to rescale the saved recipe, and the rep sends no `PATCH` before approval.

- [ ] **Step 8: AGENTS.md.** Append to the first invariant: "A recipe note asking for more or less (\"make 1.5x\") is applied to the recipe and then removed, never left for the shopping step to miss."

- [ ] **Step 9: Commit**

```bash
git add .claude/skills AGENTS.md
git commit -m "docs(skills): read recipe notes when planning and scaling" -m "Refs: #206"
```

---

### Task 9: Verify and open the PR

- [ ] **Step 1: Run the full gate**

```bash
docker compose up -d
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm vitest run && pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Walk it on a dev server**, per AGENTS.md: `pnpm db:migrate`, a throwaway password, `pnpm dev`. At 375px with touch emulation, in light and then dark, with the console open:
  - On `/recipes/<slug>`: add two notes, one with a comma and one with a line break. Reload and confirm both are there, in order.
  - Long press a note: it opens with the cursor at the end. Edit and save. Tap a note: nothing opens.
  - Start a press and drag to scroll: nothing opens, and no text is selected.
  - Tab to a note and press Enter: it opens. Escape closes it and focus returns to the note.
  - Delete a note and confirm focus lands on the next one.
  - Share the recipe and open `/r/<token>`: no notes.
  - `PROVENDER_BASE_URL=http://localhost:3000 ./scripts/prov GET /planning/rotation` shows the notes.
  - On a phone, if one is at hand: long press opens the edit with a buzz on Android and no callout on iOS. With VoiceOver on, double-tap a note. If that does not open it, try double-tap-and-hold, and update the hint text in the spec and component to name whichever works.
  - Delete the notes you added.

  Screenshot the list, an open edit, and the empty state, in both themes.

- [ ] **Step 3: Review gate.** Invoke `cml:rigorous-review` on `main...claude/epic-noether-7snbrq`, since the diff has a migration. Fix blocking findings and re-run Step 1.

- [ ] **Step 4: Apply migration 0016 to production before merging, with the user's approval.** Vercel's production deploy is live about 30 seconds after the push, and the CI `migrate` job runs minutes later. This PR's code names `recipes.notes` in every recipes select, insert and returning, so in between, recipe pages, `/r/{token}`, `GET /planning/rotation` and `:commit` would fail with `column "notes" does not exist`. The code on `main` never names the column, so migrating first is safe.

  `pnpm db:migrate` from this branch with `DATABASE_URL_UNPOOLED` set to the production direct connection. Confirm with `./scripts/prov GET /recipes/teriyaki` that main's code still serves it. The CI `migrate` job then finds nothing to apply. No other migration may merge to `main` in between.

- [ ] **Step 5: Push and open the PR.** Invoke `cml:git-workflow` first. Keep the description to a short summary, and use `Closes #206`.

- [ ] **Step 6: After merge, confirm production.** The `migrate` job is green, and `./scripts/prov GET /recipes/teriyaki` returns `"notes": []`.

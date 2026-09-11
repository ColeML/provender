# AGENTS.md — Provender

Guidance for any AI coding agent (OpenAI **Codex**, Google **Antigravity / `agy`**,
Cursor, Gemini CLI, Copilot, …). **Claude Code** additionally invokes the workflows
below as native skills from `.claude/skills/`, but the playbooks are plain Markdown,
so any agent can follow them.

## What this project is

A weekly meal planner where **the AI agent is the brain** and an HTTP API is the deterministic
engine. The agent supplies judgment (menu selection, cost estimates, ingredient parsing and
merging, non-linear scaling); the API does the exact, repeatable work (scrape, unit math, weather,
storage). The phone-facing UI is the app itself — `/shop` is live.

v1 is the same design over a Python CLI and Google Sheets, and still runs until #42 retires it.
See `PLAN.md` for the original design and `APPSHEET.md` for v1's optional phone GUI.

## Where the code lives

Two apps live here during the rewrite.

**v2, the TypeScript app** — at the repo root (`src/`, `server/`). Next.js on Vercel with a
Neon Postgres database. This is where new work goes. Read
[`coding-standards.md`](coding-standards.md) and [`DESIGN.md`](DESIGN.md) before writing any
of it, and note the architecture rule: all logic lives in `server/services/*`, and the tRPC
procedures, the REST handlers under `/v1`, and Server Components are all thin callers of it.

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm lint         # oxlint
pnpm fmt:check    # oxfmt
pnpm typecheck    # next typegen && tsc --noEmit
pnpm vitest run   # vitest, once
pnpm build        # catches prerender failures the others miss
pnpm db:generate  # generate a migration after a schema change
```

**v1, the Python CLI** — in `python/`. The working meal planner, backed by Google Sheets. It
stays there and stays working until v2 reaches parity; run it from the repo root with
`uv run --project python prov <cmd>`, as every command below shows. The tag `v1-python-sheets`
and the branch `legacy/python-cli` are fixed points to return to.

## Setup (once per machine)

- Python 3.11+ and [uv](https://docs.astral.sh/uv/).
- `uv sync --project python` to install.
- Google service-account JSON key at
  `~/Library/Application Support/provender/credentials.json` (or point
  `PROVENDER_CREDENTIALS` at it). The Sheet must be shared with the service-account
  email.
- Point at the Sheet: `uv run --project python prov set-spreadsheet "<id or url>"` (saved to a
  local `config.json`), or set `PROVENDER_SPREADSHEET`. Resolution is **env var →
  saved config → error**. Nothing is hardcoded — each user points at their own
  Sheet + key.
- **Run every CLI command from the repo root:** `uv run --project python prov <cmd>`.

## The API (deterministic tools — no AI inside)

`./scripts/prov METHOD PATH [json|@file]` calls it and prints JSON, reading the token and base URL
from `.env`. It exits non-zero on a 4xx or 5xx, so a failed call stops a script instead of passing
for success. With no `PROVENDER_BASE_URL` it talks to the production app — a workflow run is real
data by default. Set it to `http://localhost:3000` to work against a dev server.

```bash
./scripts/prov GET  /config
./scripts/prov POST /recipes:scrape '{"url":"https://..."}'
./scripts/prov PUT  /plans/2026-W37/days/2026-09-08 @day.json
```

**The endpoint reference is the API's own spec, not a table here:**

```bash
./scripts/prov GET /openapi.json
```

It is generated from the zod schemas that validate every request, so it cannot drift from the code.
A table in this file would.

The split from `PLAN.md` still holds: fuzzy judgment — menu selection, cost estimates, ingredient
parsing and merging, non-linear scaling — stays in the conversation, and anything that must be
exact and repeatable is an endpoint.


## Workflows (the "skills")

These are the agent playbooks. **Each is a step-by-step in
`.claude/skills/<name>/SKILL.md` — read and follow the matching one** when the user
asks. They are the single source of truth (Claude Code runs them as skills; other
agents read them as instructions):

- **Plan a week** → `.claude/skills/plan-week/SKILL.md`
  ("plan my week", "$120, 5 dinners, quick Monday")
- **Build the shopping list** → `.claude/skills/build-shopping-list/SKILL.md`
- **Scale a recipe** → `.claude/skills/scale-recipe/SKILL.md`
- **Add a recipe** → `.claude/skills/add-recipe/SKILL.md`

## Invariants (don't break these)

These hold for v2. Where v1 differs it is noted, because v1 still runs until #42 retires it.

- **Recipes are stored at the servings you'll cook**, not the source's yield. The shopping step
  reads quantities as-is and never re-scales. Single-batch dishes (a sheet-pan pizza, a whole
  roast) keep their natural yield.
- **Repeat-avoidance applies to mains only.** Sides may repeat freely, and only mains go to
  `mealHistory`.
- **History records what was planned, not what was eaten.** A dish there may never have been
  cooked, so present a repeat-avoidance skip as a list the user can pull from rather than a hard
  exclusion. Clearing a day removes its history entry for that reason; pass `keepHistory=true` when
  the meal happened anyway.
- **Equipment honesty:** cite a device in a day's note only if that recipe uses it.
- **An unplanned day is the absence of a row.** No blank slots to skip. (v1 kept seven fixed
  day-slots and blanked the unused ones, because AppSheet's sync needed stable keys.)
- **A day holds a meal per slot — `breakfast`, `lunch`, `dinner` — and the slot is half its key.**
  Planning writes dinners here, because lunches are leftovers, but the other two are storable and
  `/plan/[date]` shows every one. The week grid is dinners only, since it has one column per date.
  Never sort on the `meal_slot` column to get reading order: Postgres holds enum values in creation
  order, which is `dinner, lunch, breakfast`. `MEAL_ORDER` in the schema is the meal order.
- **Every side and dessert is a saved recipe, linked by id** in the day's `side` or `extras`. A
  dish named only in prose is invisible to the shopping list.
- **A shopping list `PUT` replaces what the plan calls for and preserves the rest** — the shopper's
  ticks, their `haveAlready` flags, and anything they added by hand. Rebuilding after a
  late-planned day is safe, and needs no separate merge call. (v1 needed `shopping-add` for this.)
- **Deleting a shopping item is for manual items only.** A plan item comes back on the next
  rebuild, so set `haveAlready` instead.
- **Ids are unique per household, not globally.** Two households can each have a
  `chicken-fajitas`. Every service function takes a `householdId` and filters on it — a query
  missing that filter returns everyone's rows and looks entirely normal in review.
- **Recipe pages are a derived view.** `/recipes/[slug]` renders from the database. (v1 generated
  HTML into a separate repo via `recipe-render`; never hand-edit those files.)
- **Formatting is the UI's job.** Quantities are stored as a number and a unit, and rendered as
  fractions where they are shown. (v1 stored pre-formatted `display` columns because AppSheet could
  not format.)

## Dev

```bash
uv run --project python ruff check python     # lint
uv run --project python ruff format python    # format (Google docstring convention)
uv run --project python ty check python       # type check (Astral ty)
uv run --project python pytest python         # tests
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

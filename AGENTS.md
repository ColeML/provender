# AGENTS.md — Provender

Guidance for any AI coding agent (OpenAI **Codex**, Google **Antigravity / `agy`**,
Cursor, Gemini CLI, Copilot, …). **Claude Code** additionally invokes the workflows
below as native skills from `.claude/skills/`, but the playbooks are plain Markdown,
so any agent can follow them.

## What this project is

A weekly meal planner where **the AI agent is the brain** and an HTTP API is the deterministic
engine. The agent supplies judgment (menu selection, cost estimates, ingredient parsing and
merging, picking each ingredient's scaling kind); the API does the exact, repeatable work (scrape,
unit math, scaling curves, weather, storage). The phone-facing UI is the app itself — `/shop` is live.

## Where the code lives

The app is at the repo root (`src/`, `server/`): Next.js on Vercel with a Neon Postgres
database. Read [`coding-standards.md`](coding-standards.md) and [`DESIGN.md`](DESIGN.md)
before writing any of it, and note the architecture rule: all logic lives in
`server/services/*`, and the tRPC procedures, the REST handlers under `/v1`, and Server
Components are all thin callers of it.

```bash
pnpm install
docker compose up -d  # local Postgres, plus the wsproxy the Neon driver needs to reach it
pnpm db:migrate       # apply migrations to it
pnpm dev              # http://localhost:3000
pnpm lint             # oxlint
pnpm fmt:check        # oxfmt
pnpm typecheck        # next typegen && tsc --noEmit
pnpm vitest run       # vitest, once
pnpm test:e2e         # playwright, needs the compose stack and a migrated database
pnpm build            # catches prerender failures the others miss
pnpm db:generate      # generate a migration after a schema change
```

To sign in to a local dev server, make a throwaway password; never type the real household one.
Write a random password to a file in your scratchpad, run
`pnpm tsx scripts/hash-password.ts < that-file`, and set the output as `AUTH_PASSWORD_HASH` in
`.env.local`, which overrides `.env` and is gitignored. Restart `pnpm dev`, then sign in with it.
Leave `.env` unchanged.

A change to what a page shows or does is not ready to merge until you have used it on a local dev
server: walk the changed flow at 375px wide, in both light and dark, with no console errors.
Tests, typecheck and the Vercel preview build all pass without anyone tapping the page, so they
do not count. From a worktree:

- Copy `.env` and `.env.local` from the main checkout. `.env.local` holds the local database URLs.
- Reuse the main checkout's compose stack. `docker compose up` from a worktree starts a second
  stack that fails on port 5440.
- Start the server with `pnpm --dir <worktree path> dev --port <free port>`. A plain `pnpm dev`
  launched from the main checkout serves the main checkout's branch, not yours.
- Your taps write to the local database, so delete any rows you added once you are done.

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

The split holds both ways: fuzzy judgment — menu selection, cost estimates, ingredient
parsing and merging, picking each ingredient's scaling kind — stays in the conversation, and
anything that must be exact and repeatable is an endpoint.

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

- **Recipes are stored at the servings you'll cook**, not the source's yield. The shopping step
  reads quantities as-is and never re-scales. Single-batch dishes (a sheet-pan pizza, a whole
  roast) keep their natural yield. A recipe note asking for more or less ("make 1.5x") is applied
  to the recipe, the amounts marked in its steps included, and then removed, never left for the
  shopping step to miss.
- **A step amount in braces (`Whisk {1/3 cup|mayonnaise} mayonnaise`) scales with the servings
  stepper** on the recipe page; the rest of the step stays as written. The name after the `|`
  links the amount to an ingredient of the same recipe, ignoring case, so it scales on that
  ingredient's curve. A write that would leave a link naming no ingredient is refused, deleting
  the linked ingredient included, and a brace with no link scales linearly. The link sets only the curve: change the step's amount whenever you change the
  ingredient's, and keep the link when you rewrite it.
- **Every ingredient write carries `scaling`**: `linear`, `seasoning`, `leavening` or `whole`. The
  agent picks it when saving a recipe, and the servings stepper and `:scale` apply its curve on
  every scale. All four ingredient writes refuse an ingredient without one, so a full-list `PATCH`
  cannot reset the kinds to `linear`. Ingredients of one recipe that share a name share a kind.
- **Repeat-avoidance applies to mains only.** Sides may repeat freely, and only mains go to
  `mealHistory`.
- **History records what was planned, not what was eaten.** A dish there may never have been
  cooked, so present a repeat-avoidance skip as a list the user can pull from rather than a hard
  exclusion. Clearing a day removes its history entry for that reason; pass `keepHistory=true` when
  the meal happened anyway.
- **Equipment honesty:** cite a device in a day's note only if that recipe uses it.
- **An unplanned day is the absence of a row.** No blank slots to skip.
- **A day holds a meal per slot — `breakfast`, `lunch`, `dinner` — and the slot is half its key.**
  Planning writes dinners here, because lunches are leftovers, but the other two are storable and
  `/plan/[date]` shows every one. The week grid is dinners only, since it has one column per date.
  Never sort on the `meal_slot` column to get reading order: Postgres holds enum values in creation
  order, which is `dinner, lunch, breakfast`. `MEAL_ORDER` in the schema is the meal order.
- **Every side and dessert is a saved recipe, linked by id** in the day's `side` or `extras`. A
  dish named only in prose is invisible to the shopping list.
- **A shopping list `PUT` replaces what the plan calls for and preserves the rest** — the shopper's
  ticks, their `haveAlready` flags, and anything they added by hand. Rebuilding after a
  late-planned day is safe, and needs no separate merge call.
- **An approved week is written by one call.** `POST /plans/{plan}:commit` creates the recipes,
  upserts the plan, writes the days and records history in one transaction, so a rejected or failed
  plan leaves nothing behind. Scraped recipes wait in `.provender/drafts/` until then. A day already
  in the plan is refused unless the caller opts in, because it may carry edits made after planning.
- **Picking a store is split like everything else.** The household sets up stores (with notes on
  what each is for) and ingredient rules in Settings; the agent picks a store per shopping item
  from those; `routeToStore` in `server/services/stores.ts` applies the exact part on every
  write — an `only` rule for the item's exact name always wins, then the store the caller named,
  then a usual-store rule, then the primary store.
- **Deleting a shopping item is for manual items only.** A plan item comes back on the next
  rebuild, so set `haveAlready` instead.
- **Ids are unique per household, not globally.** Two households can each have a
  `chicken-fajitas`. Every service function takes a `householdId` and filters on it — a query
  missing that filter returns everyone's rows and looks entirely normal in review. The single
  exception is `getSharedRecipe`, below, and it is the only one that may ever exist.
- **A share token is the only way into `getSharedRecipe`, and nothing else may be.** `/r/{token}`
  answers before anyone has a session, so there is no caller to resolve a household from: the
  function takes a token and reads the household *off the row it finds*. Giving it a
  `householdId` parameter to match every other service function breaks the page outright — there
  is no session there, so no caller has a value to pass. Never let the page or the query take a
  recipe id in the token's place either: a token is 32 random bytes, but an id is the recipe's
  slug, a word like `ziti`, so an id-addressed public page would let a stranger walk the library
  by guessing. The two households that both own a `fajitas` in
  `server/services/isolation.test.ts` fail if the lookup ever resolves by anything but the
  token's own row.
- **Recipe pages are a derived view.** `/recipes/[slug]` renders from the database.
- **Formatting is the UI's job.** Quantities are stored as a number and a unit, and rendered as
  fractions where they are shown.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

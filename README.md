# Provender

> *"We have both straw and **provender** enough, and room to lodge in."*
> — Genesis 24:25 (KJV)

**Provision for the week.** An AI-driven weekly meal planner. **The AI agent
(Claude Code, Codex, Antigravity, …) is the brain**; a Next.js app with an HTTP API is
the deterministic engine that scrapes recipes, does unit math, fetches weather, and
stores the week in Postgres. The app itself is the phone-facing UI.

You talk to the agent in plain language ("plan next week — $120, 5 dinners, quick on
Monday"); it checks the weather and your history, proposes a menu with sides, scrapes
real recipes, fits your budget, and writes the week plus a combined shopping list. You
shop from your phone at `/shop`, ticking items off.

- **How the code is written:** [`coding-standards.md`](coding-standards.md)
- **How the app looks and behaves:** [`DESIGN.md`](DESIGN.md)
- **Using AI agents with it:** [`AGENTS.md`](AGENTS.md)

---

## How it works

```
You ──talk to──► AI agent ──calls──► /v1 API ──► Postgres ──► the app on your phone
                    │                    │
             (judgment: menu,      (deterministic: scrape,
              cost, scaling,        unit math, weather,
              merging)              storage)
```

The split is deliberate: **judgment stays with the agent; anything exact and repeatable
is an endpoint.** The database is the single source of truth, and the same pages the
agent writes to are the ones you read in the supermarket.

## The app

Next.js (App Router) on Vercel, with a Neon Postgres database. Its pages:

| Page              | What it is                                           |
| ----------------- | ---------------------------------------------------- |
| `/`               | This week at a glance                                |
| `/plan`           | The week grid — dinners, one column per date         |
| `/plan/[date]`    | One day: breakfast, lunch, dinner, sides and extras  |
| `/recipes`        | The recipe library                                   |
| `/recipes/[slug]` | A recipe, rendered from the database for cooking     |
| `/shop`           | The shopping list, built for one hand in an aisle    |
| `/settings`       | Household settings the agent reads on every plan     |

Browsers sign in with one shared household password. Agents send
`Authorization: Bearer $PROVENDER_API_TOKEN` to `/v1` and never get a cookie.

## Using it

Day to day you talk to your agent from the repo directory. The four workflows:

| You say… | Workflow | What happens |
|---|---|---|
| "plan my week / next week, $120, 5 dinners, quick Monday" | **plan-week** | Reads settings + weather + recent history → proposes mains & sides → **stops for your approval** → scrapes recipes, fits budget → writes the week |
| "build my shopping list" | **build-shopping-list** | Combines the week's ingredients, merges duplicates, drops pantry staples → writes an aisle-by-aisle checklist |
| "scale the baked ziti to 12" / "double this" | **scale-recipe** | Scales quantities with judgment (spices, eggs, cook time) |
| "save this recipe <url>" | **add-recipe** | Scrapes, parses, costs, and stores it |

**In Claude Code:** these are slash commands — `/plan-week`, `/build-shopping-list`,
`/scale-recipe`, `/add-recipe`.

**In other agents:** describe the task; the agent reads [`AGENTS.md`](AGENTS.md) and
follows the matching playbook in `.claude/skills/`.

A typical week:

1. **`/plan-week`** → review the proposed menu → approve → it writes the week.
2. **`/build-shopping-list`** → review → it writes the checklist.
3. Open `/shop` on your phone → **tick items off** while shopping.
4. Cook from `/recipes/[slug]` (ingredients, numbered steps, screen stays awake).

## The API

`/v1` is a REST API following Google's API design guide. `./scripts/prov METHOD PATH
[json|@file]` calls it and prints JSON, reading the token and base URL from `.env`:

```bash
./scripts/prov GET  /config
./scripts/prov POST /recipes:scrape '{"url":"https://..."}'
./scripts/prov PUT  /plans/2026-W37/days/2026-09-08 @day.json
```

The endpoint reference is the API's own spec, generated from the zod schemas that
validate every request:

```bash
./scripts/prov GET /openapi.json
```

With no `PROVENDER_BASE_URL` set, `prov` talks to the production app.

### Optional: real prices via Kroger

Budget estimates default to your learned prices, then an AI estimate. If you live near
a Kroger-family store (Kroger, Dillons, Fry's, …), set `KROGER_CLIENT_ID` and
`KROGER_CLIENT_SECRET` from a free app registered at **developer.kroger.com** (Products
and Locations APIs enabled), then pick a store with
`GET /v1/kroger/locations?zipCode=<zip>` and save the chosen `locationId` as the
`kroger_location_id` household setting. The price tier becomes **learned → Kroger →
estimate**. Without the credentials the feature is inert.

## Development

Copy `.env.example` to `.env` and fill it in — it explains each value. Then:

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

Use `pnpm`, never `npm` or `yarn`.

## History

v1 was a Python CLI over a Google Sheet, retired in #42. Its design is in
[`PLAN.md`](PLAN.md) and its optional phone front end in [`APPSHEET.md`](APPSHEET.md),
both archived. The code is on the `legacy/python-cli` branch and the `v1-python-sheets`
tag.

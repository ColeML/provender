# Provender — Plan

A Claude Code–driven weekly meal planner. **Claude Code is the AI brain**; a small
Python CLI provides deterministic tools (scrape, unit math, weather, Google Sheets
read/write). All data lives in **Google Sheets** so it's freely accessible from your
phone. The shopping list is a Sheets tab with checkboxes you tick on your phone.

## Locked decisions

| Fork | Choice |
|---|---|
| Budget | **AI estimates** — Claude estimates per-recipe cost from ingredients + regional norms; refined with learned prices (`Prices` tab) and opt-in Kroger lookups |
| Interface | **Claude Code skills** — you converse ("plan next week, $120, 5 dinners, quick Monday"); skills call the CLI |
| Recipe sourcing | **On-the-fly scraping** — Claude suggests, scrapes the chosen ones, saves to Sheets |
| Shopping list | **Google Sheets tab + checkboxes** — phone-friendly, no fragile auth; Keep/Tasks deferred |

## Architecture

```
You  ──talk to──►  Claude Code (skills)  ──Bash──►  prov CLI  ──►  Google Sheets ◄── your phone
                          │                              │
                   (AI judgment:                  (deterministic:
                    menu, cost est,                scrape, pint unit math,
                    merging, scaling)              weather fetch, sheets I/O)
```

The split is the key design principle: **fuzzy judgment stays in the Claude
conversation; anything that must be exact and repeatable is a CLI subcommand.**
This avoids API keys/billing for the AI side (Claude Code is the interface) and keeps
the Python testable and dumb.

## Stack

Industry-standard Python tooling (not the YouVersion stack): Python 3.11+ managed
with [uv](https://docs.astral.sh/uv/), **ruff** for lint + format (line-length 88,
Google docstring convention), **ty** for type-checking, **pytest** for tests.

- `gspread` + `google-auth` — Google Sheets (service-account auth)
- `recipe-scrapers` — supports hundreds of recipe sites; falls back to JSON-LD
- `pint` — unit conversion (g↔oz, ml↔cup, etc.)
- `httpx` — weather/geocoding + Kroger calls
- **Open-Meteo** — free, no API key: 7-day forecast + geocoding
- `typer` — CLI

No Anthropic SDK needed — the AI is Claude Code itself.

## Google Sheets schema

One spreadsheet, shared with the service-account email. Tabs:

1. **Config** — household defaults: `people`, `location`, `dietary_restrictions`,
   `allergies`, `dislikes`, `equipment`, `default_budget`, `default_meals`. Edit by hand.
2. **WeekPlan** — the calendar: `date`, `day`, `meal_slot` (dinner/lunch), `recipe_id`,
   `servings`, `day_prefs` (e.g. "quick"), `side_recipe_id`, `status`.
3. **Recipes** — `recipe_id`, `title`, `source_url`, `base_servings`, `prep_min`,
   `cook_min`, `total_min`, `cost_estimate`, `tags`, `instructions`, `rating`.
4. **Ingredients** — normalized, one row each: `recipe_id`, `name`, `qty`, `unit`,
   `category` (produce/meat/dairy/pantry/…), `notes`.
5. **ShoppingList** — generated: `item`, `qty`, `unit`, `category`, `bought` (checkbox),
   `feeds_recipes`, `est_cost`, `have_already`.
6. **Prices** — `ingredient`, `unit`, `price`, `store`, `updated`: learned grocery
   prices (`price-set`/`prices`) that sharpen budget estimates over time.
7. **History** — `id`, `date`, `recipe_id`, `title`, `meal_slot`, `rating`, `notes`.
   Accumulates every planned meal (never replaced) and drives **repeat-avoidance**:
   `plan-week` skips any dish planned within `no_repeat_days` (Config key, default 30).
   The `rating`/`notes` columns power **taste-learning** (`rate`).

## CLI surface (`prov`)

Deterministic tools the skills call. No AI inside these. A representative subset
below; **see [`AGENTS.md`](AGENTS.md) for the full command reference** (init,
config, prices, kroger-*, history/rate, convert, …).

- `prov scrape <url>` — scrape → JSON (title, servings, times, ingredients, steps)
- `prov recipe-save [file]` — write a recipe + its ingredients to Sheets (JSON in)
- `prov scale [file] --to <N>` — multiply quantities, normalize units via pint, emit
  scaled list (Claude handles the judgment calls — see below)
- `prov weather` — read location from Config, return 7-day forecast
- `prov plan-write [file]` — write/replace a week in WeekPlan
- `prov plan-read` — read current plan
- `prov shopping-write [file]` — write the combined ShoppingList tab w/ checkboxes
- `prov config` — dump Config as JSON

## Claude Code skills (the actual UX)

Markdown skills in `.claude/skills/` that orchestrate the CLI + supply AI judgment.

- **`plan-week`** — the headline skill. Inputs: budget, # people, # meals, per-day prefs.
  Steps: read Config → `prov weather` → propose a menu fitted to budget/weather/prefs
  (cold+rainy → soups/comfort; hot → grill/salad/no-oven; "quick Monday" → ≤30 min) →
  for each chosen recipe pick a source, `scrape`, estimate cost → sum vs budget, swap to
  fit → suggest a complementary **side** per main → `recipe-save` + `plan-write`.
- **`build-shopping-list`** — read the week's plan → gather all ingredients → Claude
  merges duplicates ("2 cloves" + "1 clove" = 3, "garlic powder" stays separate) and
  assigns store aisles → exclude `have_already` pantry staples → `shopping-write`.
- **`scale-recipe`** — `prov scale` does linear math + pint conversions; Claude
  overrides the non-linear bits: spices/leavening don't scale 1:1, discrete items
  (eggs, cans) round sensibly, "to taste" stays, cook time/pan size adjust.
- **`add-recipe`** — scrape a URL you liked and save it to the library.

## Build phases

- **Phase 0 — scaffold & auth.** `src/`-layout package, `pyproject.toml`, uv +
  ruff/ty/pytest (line-length 88). Google Cloud service account; share Sheet with its
  email; store creds JSON locally (gitignored). `prov config` proves the connection.
- **Phase 1 — Sheets I/O.** Schema + read/write helpers + `config`/`plan-read`.
- **Phase 2 — scraping.** `scrape` + `recipe-save` over `recipe-scrapers`.
- **Phase 3 — weather.** Open-Meteo geocode + 7-day forecast.
- **Phase 4 — scaling.** `scale` with pint.
- **Phase 5 — shopping list.** `shopping-write` + checkbox formatting.
- **Phase 6 — skills.** Wire up `plan-week`, `build-shopping-list`, `scale-recipe`,
  `add-recipe`.
- **Phase 7 — extras** (below), as wanted.

## Extra ideas (beyond your ask)

- **Cook-once-eat-twice** — Claude can double a recipe and slot the leftovers into a
  later lunch/dinner to cut cost and effort.
- **Ingredient overlap optimization** — bias the menu toward shared ingredients across
  the week to lower cost and reduce waste ("you already need cilantro Tue, reuse Thu").
- **Pantry tracking** — mark staples you own (`have_already`) so they drop off the list.
- **`.ics` calendar export** — push dinners to Google Calendar so they show on your
  phone alongside everything else.
- **Taste learning** *(shipped)* — `History` ratings via `rate`; plans favor 4–5★
  mains and avoid 1–2★.
- **Theme nights** — Taco Tuesday / Pizza Friday as soft constraints in Config.
- **Rough nutrition** estimates per meal (AI, optional).
- **Seasonal/local produce** awareness from month + location.
- **Budget refinement** *(shipped)* — beyond pure AI estimates, use learned prices
  (`price-set`/`prices`) and opt-in Kroger lookups (`kroger-price`) for real costs.

## Open setup items (need you, later)

- Create the Google Cloud project + service account, download creds JSON.
- Create the spreadsheet and share it with the service-account email.
```


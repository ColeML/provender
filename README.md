# Provender

> *"We have both straw and **provender** enough, and room to lodge in."*
> — Genesis 24:25 (KJV)

**Provision for the week.** An AI-driven weekly meal planner. **The AI agent
(Claude Code, Codex, Antigravity, …) is the brain**; a small, deterministic CLI
(`prov`) is the engine that
scrapes recipes, does unit math, fetches weather, and reads/writes a **Google
Sheet** that doubles as the phone-facing UI.

You talk to the agent in plain language ("plan next week — $120, 5 dinners, quick
on Monday"); it checks the weather and your history, proposes a menu with sides,
scrapes real recipes, fits your budget, and writes the week + a combined shopping
list to your Google Sheet. You shop from your phone, ticking items off.

- **Full design:** [`PLAN.md`](PLAN.md)
- **Optional phone app (AppSheet):** [`APPSHEET.md`](APPSHEET.md)
- **Using other AI agents:** [`AGENTS.md`](AGENTS.md)

---

## Contents

1. [How it works](#how-it-works)
2. [Prerequisites](#prerequisites)
3. [Setup](#setup) — install · Google credentials · the Sheet · configure household
4. [Using it](#using-it) — the weekly workflow
5. [Command reference](#command-reference)
6. [Phone GUI](#phone-gui)
7. [Other AI agents](#other-ai-agents)
8. [Troubleshooting](#troubleshooting)
9. [Development](#development)

---

## How it works

```
You ──talk to──► AI agent ──runs──► prov CLI ──read/write──► Google Sheet ◄── your phone
                    │                    │
             (judgment: menu,      (deterministic: scrape,
              cost, scaling,        unit math, weather,
              merging)              Sheets I/O)
```

The split is deliberate: **judgment stays with the agent; anything exact and
repeatable is a CLI command.** The Google Sheet is the single source of truth, so
the agent writes it and your phone reads/edits it — always in sync.

The Sheet has these tabs (created by `prov init`): `Config`, `WeekPlan`,
`Recipes`, `Ingredients`, `ShoppingList`, `History`.

## Prerequisites

- **Python 3.11+** and [uv](https://docs.astral.sh/uv/) (`brew install uv` on macOS).
- A **Google account** (for the Sheet + a free service account).
- An AI coding agent — **Claude Code** (native skills) or any agent that reads
  `AGENTS.md` (Codex, Antigravity `agy`, …).

## Setup

### 1. Install

```bash
uv sync                 # create the venv and install everything
uv run prov --help  # confirm the CLI runs
```

### 2. Google credentials (one-time, ~5–10 min)

A *service account* is a robot Google identity the CLI logs in as.

1. Go to **https://console.cloud.google.com** → create a project (e.g.
   `meal-planner`) and select it.
2. **Enable two APIs** — search each in the top bar, open it, click **Enable**:
   - **Google Sheets API**
   - **Google Drive API**
3. **APIs & Services → Credentials → Create Credentials → Service account.** Name
   it (e.g. `meal-planner-bot`), **Create and Continue**, skip the optional grants,
   **Done**.
4. Open the service account → **Keys → Add Key → Create new key → JSON → Create.**
   A `.json` file downloads.
5. Move the key to the expected path and lock it down:

   ```bash
   mkdir -p "$HOME/Library/Application Support/provender"          # macOS
   mv ~/Downloads/<your-project>-*.json \
      "$HOME/Library/Application Support/provender/credentials.json"
   chmod 600 "$HOME/Library/Application Support/provender/credentials.json"
   ```

   (Or put it anywhere and set `PROVENDER_CREDENTIALS=/path/to/key.json`.)
6. Print the service-account email — you'll share the Sheet with it:

   ```bash
   python3 -c "import json,os; p=os.path.expanduser('~/Library/Application Support/provender/credentials.json'); print(json.load(open(p))['client_email'])"
   ```

   It looks like `meal-planner-bot@<project>.iam.gserviceaccount.com`.

> **Never commit `credentials.json`** — it holds a private key. It's gitignored.

### 3. Create and share the Sheet

1. Open **https://sheets.new**, name it (e.g. `Meal Planner`).
2. Click **Share**, paste the **service-account email** from step 6, give it
   **Editor**, untick "notify", **Share**. *(This step is the one everyone forgets —
   the bot can't see the Sheet until you share it.)*
3. Copy the Sheet **ID** from the URL — the part between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
4. Point the CLI at your Sheet. Either save it to the local config (simplest,
   no shell editing):

   ```bash
   uv run prov set-spreadsheet "<sheet-id-or-url>"
   ```

   …or use an environment variable (handy for CI or switching sheets):

   ```bash
   echo 'export PROVENDER_SPREADSHEET="<sheet-id>"' >> ~/.zshrc && source ~/.zshrc
   ```

   Resolution at runtime is **env var → saved config → error**, so the env var
   wins if both are set.

### 4. Bootstrap the tabs

```bash
uv run prov init     # creates Config, WeekPlan, Recipes, Ingredients, ShoppingList, History
```

If it prints `{"created_tabs": [...]}`, the whole chain works. ✅

### 5. Configure your household

Set your defaults (the agent reads these every plan). Either edit the **Config** tab
directly (key/value rows) or use the CLI:

```bash
uv run prov config-set people 4
uv run prov config-set location "Edmond, OK"      # for the weather forecast
uv run prov config-set default_budget 120
uv run prov config-set default_meals 5
uv run prov config-set allergies "none"
uv run prov config-set dislikes "mushrooms"
uv run prov config-set pantry_staples "salt, pepper, olive oil"
uv run prov config-set equipment "oven, stovetop, Instant Pot, slow cooker, griddle"
uv run prov config-set no_repeat_days 30           # don't repeat a main within N days
```

Useful keys: `people`, `location`, `default_budget`, `default_meals`,
`dietary_restrictions`, `allergies`, `dislikes`, `pantry_staples`, `equipment`,
`stores`, `theme_nights`, `no_repeat_days`, `preferences`.

### Optional: real prices via Kroger

Budget estimates default to your **learned prices** (`price-set`) → AI estimate.
If you live near a **Kroger-family store** (Kroger, Dillons, Fry's, …) whose prices
track your local stores, you can opt in to real store prices:

1. Register a free app at **developer.kroger.com** (enable **Products** +
   **Locations**) → get a Client ID + Secret.
2. Save them (gitignored, never committed):
   `~/Library/Application Support/provender/kroger.json` →
   `{"client_id": "...", "client_secret": "..."}`
3. Pick a store: `uv run prov kroger-locations <zip> --chain DILLONS --save`
   (saves a `kroger_location_id`). Then `uv run prov kroger-price "ground beef"`.

The price tier becomes **learned → Kroger → estimate**. Without creds, it's
inert — nothing changes.

## Using it

Day to day you just talk to your agent from the repo directory. The four workflows:

| You say… | Workflow | What happens |
|---|---|---|
| "plan my week / next week, $120, 5 dinners, quick Monday" | **plan-week** | Reads Config + weather + recent history → proposes mains & sides → **stops for your approval** → scrapes recipes, fits budget → writes the calendar |
| "build my shopping list" | **build-shopping-list** | Combines the week's ingredients, merges duplicates, drops pantry staples → writes an aisle-by-aisle checklist |
| "scale the baked ziti to 12" / "double this" | **scale-recipe** | Scales quantities with judgment (spices, eggs, cook time) |
| "save this recipe <url>" | **add-recipe** | Scrapes, parses, costs, and stores it |

**In Claude Code:** these are slash commands — `/plan-week`, `/build-shopping-list`,
`/scale-recipe`, `/add-recipe`.

**In other agents:** just describe the task; the agent reads [`AGENTS.md`](AGENTS.md)
and follows the matching playbook in `.claude/skills/`.

A typical week:

1. **`/plan-week`** → review the proposed menu → approve → it writes the week.
2. **`/build-shopping-list`** → review → it writes the checklist.
3. Open the Google Sheets app (or AppSheet) on your phone → **tick items off** while
   shopping.
4. Cook from the recipe pages (link, ingredients, numbered steps).

## Command reference

Every command emits JSON to stdout; commands read JSON from a file argument or
stdin (`-`). Run from the repo root.

| Command | What it does |
|---|---|
| `prov set-spreadsheet <id-or-url>` | Save your target Sheet to local config |
| `prov init` | Create the tabs (safe to re-run) |
| `prov config` / `config-set KEY VALUE` | Read / upsert household settings |
| `prov prices` / `price-set ITEM PRICE [--unit] [--store]` | Read / record learned grocery prices |
| `prov kroger-locations <zip>` / `kroger-price "<item>"` | Optional: real store prices via the Kroger API |
| `prov weather [--location] [--days]` | Forecast for the configured location |
| `prov scrape <url>` | Scrape a recipe to JSON (no save) |
| `prov recipe-save [file]` | Save a recipe + ingredients (auto-renders its page) |
| `prov recipe-render <id>` / `--all` | (Re)render shareable recipe page(s) to `docs/recipes/` |
| `prov recipes` / `ingredients [--recipe-id]` | Read the library |
| `prov scale [file] --to N` | Scale a recipe to N servings |
| `prov convert QTY FROM TO` | Unit conversion, e.g. `convert 2 cup ml` |
| `prov plan-read` / `plan-write [file]` | Read / replace the week calendar |
| `prov history-recent [--days]` / `history-add [file]` | Repeat-avoidance (mains) |
| `prov history` / `rate RECIPE_ID 1-5 [--notes]` | Read full history / rate a cooked main (taste-learning) |
| `prov shopping-write [file]` / `shopping-clear` | Write / clear the shopping list |

## Phone GUI

The Google Sheets mobile app is enough day to day (tap the `bought` checkboxes to
shop). For a nicer calendar / recipe cards / shopping checklist, layer a free
**Google AppSheet** app on the same Sheet — see [`APPSHEET.md`](APPSHEET.md).

## Recipe pages (shareable, AppSheet-friendly)

Each recipe also renders to a clean, self-contained HTML page you can open on your
phone or share as a link — handy when AppSheet feels fiddly. The page is a
**derived view**, overwritten on every render; the Sheet stays the source of truth.

`recipe-save` renders automatically; re-render the whole library with
`prov recipe-render --all`. Pages are written to `docs/recipes/<slug>.html` and the
URL is stored in each recipe's `doc_url` column (link it from AppSheet to open the
page). To publish for free via **GitHub Pages** (one-time):

1. Push the repo, then enable **Settings → Pages → Source: `main`, folder `/docs`**.
2. Tell the CLI the public base so `doc_url` is a real link:
   `prov config-set render_base_url "https://<user>.github.io/<repo>"`.

Without `render_base_url`, `doc_url` is just a repo-relative path. (Pages serves the
files publicly — fine for recipes; if you fork this repo as a template, point
`docs/recipes` at a separate Pages repo instead.)

## Other AI agents

The CLI is the engine and the playbooks are plain Markdown, so any agent can drive
this. [`AGENTS.md`](AGENTS.md) is the cross-agent entry point (read by Codex,
Antigravity `agy`, Cursor, Gemini CLI, Copilot, …); Claude Code uses the native
skills in `.claude/skills/`. All of them share the same Sheet.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Credentials file not found …` | The key isn't at the default path. Move it there or set `PROVENDER_CREDENTIALS`. |
| `No spreadsheet configured` | Run `prov set-spreadsheet "<id>"` (or `export PROVENDER_SPREADSHEET="<id>"`). |
| `Could not open spreadsheet … Is it shared…?` | Share the Sheet with the service-account email (Editor). |
| `Could not geocode location` | Use `City, ST` or just the city; the geocoder matches city names. |
| A recipe fails to scrape (403) | Some sites block bots (Allrecipes, BBC Good Food). Try another source; Budget Bytes works reliably. |
| AppSheet: "table has N columns but schema has M" | The Sheet gained a column. In AppSheet: **Regenerate Structure** on that table → **Save** (reload the editor if it's stubborn). |

## Development

```bash
uv run ruff check .     # lint
uv run ruff format .    # format (Google docstring convention)
uv run ty check         # type check
uv run pytest           # tests
```

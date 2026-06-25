# AGENTS.md — Provender

Guidance for any AI coding agent (OpenAI **Codex**, Google **Antigravity / `agy`**,
Cursor, Gemini CLI, Copilot, …). **Claude Code** additionally invokes the workflows
below as native skills from `.claude/skills/`, but the playbooks are plain Markdown,
so any agent can follow them.

## What this project is

A weekly meal planner where **the AI agent is the brain** and a small Python CLI
(`prov`) is the deterministic engine. **Google Sheets is the data store and the
phone-facing UI.** The agent supplies judgment (menu selection, cost estimates,
ingredient parsing/merging, scaling); the CLI does the exact, repeatable work
(scrape, unit math, weather, Sheets I/O). See `PLAN.md` for the full design and
`APPSHEET.md` for the optional phone GUI.

## Setup (once per machine)

- Python 3.11+ and [uv](https://docs.astral.sh/uv/).
- `uv sync` to install.
- Google service-account JSON key at
  `~/Library/Application Support/provender/credentials.json` (or point
  `PROVENDER_CREDENTIALS` at it). The Sheet must be shared with the service-account
  email.
- Point at the Sheet: `uv run prov set-spreadsheet "<id or url>"` (saved to a
  local `config.json`), or set `PROVENDER_SPREADSHEET`. Resolution is **env var →
  saved config → error**. Nothing is hardcoded — each user points at their own
  Sheet + key.
- **Run every CLI command from the repo root:** `uv run prov <cmd>`.

## The CLI (deterministic tools — no AI inside)

Every command emits JSON to stdout; parse it. Commands read JSON from a file arg or
stdin (`-`).

| Command | Purpose |
|---|---|
| `init` | Create/verify the tabs (Config, WeekPlan, Recipes, Ingredients, ShoppingList, History, Prices) |
| `config` / `config-set KEY VALUE` | Read / upsert household settings |
| `prices` / `price-set ITEM PRICE [--unit] [--store]` | Read / record learned grocery prices |
| `kroger-locations <zip>` / `kroger-price "<item>"` | Optional real store prices (Kroger API, opt-in) |
| `weather [--location] [--days]` | Open-Meteo forecast for the configured location |
| `scrape <url>` | Scrape a recipe to JSON (title, image, ingredients, steps) |
| `recipe-save [file]` | Save (append) a recipe + ingredients (auto-formats display/instructions; auto-renders its page) |
| `recipe-update [file]` | Upsert a recipe by `recipe_id`: replace its row + ingredients in place (no duplicate); send the full recipe |
| `recipe-render <id>` / `--all` | (Re)render a shareable HTML recipe page to `render_dir` (Config; default `docs/recipes`), record `doc_url` |
| `recipes` / `ingredients [--recipe-id]` | Read the library |
| `scale [file] --to N` / `convert QTY FROM TO` | Scaling + unit conversion (pint) |
| `plan-read` / `plan-write [file]` | Read / replace the week calendar |
| `history-recent [--days]` / `history-add [file]` | Repeat-avoidance (mains only) |
| `history` / `rate RECIPE_ID 1-5 [--notes]` | Read full history / rate a cooked main (taste-learning) |
| `shopping-write [file]` / `shopping-clear` | Write / clear the shopping list (tappable checkboxes) |

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

- **Recipes are stored at the servings you'll cook** (not the original yield); the
  shopping step does not re-scale. Single-batch items (pizza, a roast) use their
  natural yield.
- **Display columns are formatted in the data**, not in the GUI: `Ingredients.display`
  and `ShoppingList.display` use fractions (½, ⅔, …); `Recipes.instructions` is
  numbered with blank lines; `Recipes.ingredients_text` is a bulleted block (AppSheet
  caps inline lists, so the full list lives on the recipe row).
- **Repeat-avoidance applies to mains only** (sides may repeat); only mains go to
  `History`.
- **Equipment honesty**: only cite a device in a day's note if the recipe uses it.
- `WeekPlan` is always **7 stable day-slots** (Mon-Sun), keyed by `day`. `plan-write`
  overwrites them in place (unplanned days blanked) rather than churning row keys —
  this is what keeps AppSheet's sync reliable. `shopping-write` replaces its tab;
  `recipe-save`/`history-add` append (History is keyed by a unique `id`).
  `recipe-update` upserts a recipe by `recipe_id` (replaces its row + ingredients
  in place) — use it to edit an existing recipe instead of re-running `recipe-save`,
  which would append a duplicate.
- Readers of `WeekPlan` (e.g. build-shopping-list) must **skip rows with a blank
  `recipe_id`** (unplanned days).
- **Recipe pages are a derived view, not a source.** `recipe-render` regenerates
  `docs/recipes/<slug>.html` from the `Recipes` row and overwrites it; never hand-edit
  the HTML or treat it as canonical. The Sheet is the source of truth; `doc_url` just
  points at the rendered page.

## Dev

```bash
uv run ruff check .     # lint
uv run ruff format .    # format (Google docstring convention)
uv run ty check         # type check (Astral ty)
uv run pytest           # tests
```

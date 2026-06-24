"""Command-line interface for the meal planner.

These commands are the deterministic "hands" that Claude Code skills drive. Every
command emits JSON to stdout so a skill can parse the result, and every command
that touches Google Sheets fails with a clear, actionable message when
credentials or the spreadsheet are not yet configured.
"""

from __future__ import annotations

import dataclasses
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Annotated, Any, NoReturn

import typer

from provender import config as config_mod
from provender import history as history_mod
from provender import kroger as kroger_mod
from provender import prices as prices_mod
from provender import render as render_mod
from provender import scale as scale_mod
from provender import scrape as scrape_mod
from provender import sheets as sheets_mod
from provender import weather as weather_mod
from provender.config import Settings
from provender.models import Ingredient, Recipe

app = typer.Typer(
    help="Provender — AI-driven weekly meal planner backed by Google Sheets.",
    no_args_is_help=True,
    add_completion=False,
)


def _emit(payload: Any) -> None:
    """Print ``payload`` as pretty JSON to stdout."""
    typer.echo(json.dumps(payload, indent=2, default=str))


def _fail(message: str) -> NoReturn:
    """Print an error to stderr and exit non-zero."""
    typer.echo(message, err=True)
    raise typer.Exit(code=1)


def _read_json_input(source: str | None) -> Any:
    """Read JSON from a file path, or from stdin when ``source`` is ``None``/``-``."""
    try:
        if source in (None, "-"):
            return json.load(sys.stdin)
        return json.loads(Path(source).read_text(encoding="utf-8"))
    except FileNotFoundError:
        _fail(f"File not found: {source}")
    except json.JSONDecodeError as exc:
        _fail(f"Invalid JSON input: {exc}")


def _connect():  # returns gspread.Spreadsheet
    """Connect to the configured spreadsheet or exit with a helpful error."""
    try:
        return sheets_mod.connect(Settings.load())
    except sheets_mod.SheetsError as exc:
        _fail(str(exc))


def _config_value(spreadsheet, key: str, default: str = "") -> str:
    """Read a single Config-tab value by key (``default`` if unset)."""
    for row in sheets_mod.read_table(spreadsheet, "Config"):
        if row.get("key") == key:
            return str(row.get("value") or "")
    return default


#: Where rendered recipe pages are written (served by GitHub Pages from /docs).
_RENDER_DIR = Path("docs/recipes")


def _recipe_doc_url(base_url: str, file_slug: str) -> str:
    """Build a recipe's published URL, or a repo-relative path if no base is set."""
    rel = f"recipes/{file_slug}.html"
    return f"{base_url.rstrip('/')}/{rel}" if base_url else rel


def _write_recipe_page(recipe_row: dict[str, Any], file_slug: str) -> Path:
    """Render ``recipe_row`` to ``docs/recipes/<slug>.html`` (overwriting)."""
    _RENDER_DIR.mkdir(parents=True, exist_ok=True)
    path = _RENDER_DIR / f"{file_slug}.html"
    path.write_text(render_mod.render_recipe_html(recipe_row), encoding="utf-8")
    return path


@app.command()
def init() -> None:
    """Create any missing tabs in the spreadsheet (safe to re-run)."""
    spreadsheet = _connect()
    created = sheets_mod.ensure_schema(spreadsheet)
    _emit({"spreadsheet": spreadsheet.title, "created_tabs": created})


@app.command(name="set-spreadsheet")
def set_spreadsheet(
    spreadsheet: Annotated[
        str, typer.Argument(help="Your Google Sheet's ID or full URL.")
    ],
) -> None:
    """Save the target spreadsheet to the local config (no env var needed).

    Resolution at runtime is env var (PROVENDER_SPREADSHEET) first, then this.
    """
    path = config_mod.write_config_value("spreadsheet", spreadsheet)
    _emit({"spreadsheet": spreadsheet, "saved_to": str(path)})


@app.command()
def config() -> None:
    """Dump the Config tab as a flat key/value object."""
    spreadsheet = _connect()
    records = sheets_mod.read_table(spreadsheet, "Config")
    _emit({row["key"]: row["value"] for row in records if row.get("key")})


@app.command(name="config-set")
def config_set(
    key: Annotated[str, typer.Argument(help="Config key, e.g. 'people'.")],
    value: Annotated[str, typer.Argument(help="Value to store.")],
) -> None:
    """Set (or update) a single key/value pair in the Config tab."""
    spreadsheet = _connect()
    action = sheets_mod.set_config_value(spreadsheet, key, value)
    _emit({"key": key, "value": value, "action": action})


@app.command(name="price-set")
def price_set(
    ingredient: Annotated[
        str, typer.Argument(help="Ingredient name, e.g. 'chicken breast'.")
    ],
    price: Annotated[float, typer.Argument(help="Unit price, e.g. 2.50.")],
    unit: Annotated[
        str, typer.Option(help="Unit the price is per, e.g. 'lb', 'ea'.")
    ] = "",
    store: Annotated[str, typer.Option(help="Store the price is from.")] = "",
) -> None:
    """Record a learned grocery price (sharpens budget estimates over time)."""
    spreadsheet = _connect()
    headers = sheets_mod.SCHEMA["Prices"]
    rows = sheets_mod.read_table(spreadsheet, "Prices")
    updated = prices_mod.upsert_price(
        rows, ingredient, price, unit, store, date.today().isoformat()
    )
    sheets_mod.replace_table(
        spreadsheet,
        "Prices",
        headers,
        [[r.get(h, "") for h in headers] for r in updated],
    )
    _emit(
        {"ingredient": ingredient, "price": price, "unit": unit, "rows": len(updated)}
    )


@app.command()
def prices() -> None:
    """Print the learned Prices tab as JSON."""
    spreadsheet = _connect()
    _emit(sheets_mod.read_table(spreadsheet, "Prices"))


@app.command(name="kroger-locations")
def kroger_locations(
    zip_code: Annotated[str, typer.Argument(help="ZIP to search near, e.g. '67206'.")],
    chain: Annotated[str, typer.Option(help="Filter to a chain, e.g. 'DILLONS'.")] = "",
    save: Annotated[
        bool, typer.Option(help="Save the first result as Config 'kroger_location_id'.")
    ] = False,
) -> None:
    """Find nearby Kroger-family stores (opt-in; to pick a store for pricing)."""
    if not kroger_mod.is_configured():
        _fail("Kroger not configured — add credentials to the kroger.json config file.")
    try:
        stores = kroger_mod.find_locations(zip_code, chain=chain)
    except Exception as exc:  # surface auth/network failures cleanly
        _fail(f"Kroger location lookup failed for ZIP {zip_code!r}: {exc}")
    saved = None
    if save and stores:
        saved = stores[0]["location_id"]
        sheets_mod.set_config_value(_connect(), "kroger_location_id", saved)
    _emit({"stores": stores, "saved": saved})


@app.command(name="kroger-price")
def kroger_price(
    item: Annotated[str, typer.Argument(help="Item to price, e.g. 'ground beef'.")],
    location: Annotated[
        str | None,
        typer.Option(help="Store id; defaults to Config 'kroger_location_id'."),
    ] = None,
) -> None:
    """Look up a real store price for an item (opt-in Kroger source)."""
    if not kroger_mod.is_configured():
        _fail("Kroger not configured — add credentials to the kroger.json config file.")
    if location is None:
        rows = sheets_mod.read_table(_connect(), "Config")
        location = next(
            (r["value"] for r in rows if r.get("key") == "kroger_location_id"), None
        )
        if not location:
            _fail(
                "No store set. Run kroger-locations <zip> --save, or pass --location."
            )
    try:
        candidates = kroger_mod.search_prices(item, str(location))
    except Exception as exc:  # surface auth/network failures cleanly
        _fail(f"Kroger price lookup failed for {item!r}: {exc}")
    _emit(
        {
            "item": item,
            "best": kroger_mod.representative_price(candidates),
            "candidates": candidates,
        }
    )


@app.command()
def scrape(url: Annotated[str, typer.Argument(help="Recipe page URL")]) -> None:
    """Scrape a recipe and print it as JSON (does not save)."""
    try:
        recipe = scrape_mod.scrape(url)
    except Exception as exc:  # surface any fetch/parse failure cleanly
        _fail(f"Failed to scrape {url}: {exc}")
    _emit(recipe.to_dict())


@app.command()
def weather(
    location: Annotated[
        str | None,
        typer.Option(help="Override location; defaults to the Config 'location'."),
    ] = None,
    days: Annotated[int, typer.Option(help="Number of forecast days.")] = 7,
) -> None:
    """Print a daily forecast for the configured (or given) location."""
    if location is None:
        spreadsheet = _connect()
        records = sheets_mod.read_table(spreadsheet, "Config")
        location = next(
            (r["value"] for r in records if r.get("key") == "location"), None
        )
        if not location:
            _fail("No location given and none found in the Config tab.")
    try:
        forecast = weather_mod.forecast(location, days=days)
    except Exception as exc:  # network or unexpected API shape -> clean message
        _fail(f"Could not fetch weather for {location}: {exc}")
    _emit([dataclasses.asdict(day) for day in forecast])


@app.command()
def scale(
    recipe_json: Annotated[
        str | None, typer.Argument(help="Path to a recipe JSON file, or '-' for stdin.")
    ] = None,
    *,
    to: Annotated[int, typer.Option(help="Target number of servings.")],
) -> None:
    """Scale a recipe's quantities to a target serving count (linear)."""
    recipe = Recipe.from_dict(_read_json_input(recipe_json))
    scaled = scale_mod.scale_recipe(recipe, to)
    _emit(scaled.to_dict())


@app.command()
def convert(
    qty: Annotated[float, typer.Argument(help="Quantity to convert.")],
    from_unit: Annotated[str, typer.Argument(help="Source unit, e.g. 'cup'.")],
    to_unit: Annotated[str, typer.Argument(help="Target unit, e.g. 'ml'.")],
) -> None:
    """Convert a quantity between two compatible units."""
    try:
        result = scale_mod.convert(qty, from_unit, to_unit)
    except Exception as exc:  # pint raises several distinct unit errors
        _fail(f"Cannot convert {qty} {from_unit} -> {to_unit}: {exc}")
    _emit({"qty": result, "unit": to_unit})


@app.command(name="recipe-save")
def recipe_save(
    recipe_json: Annotated[
        str | None, typer.Argument(help="Path to a recipe JSON file, or '-' for stdin.")
    ] = None,
) -> None:
    """Save a recipe + ingredients to the Sheet and render its shareable page."""
    recipe = Recipe.from_dict(_read_json_input(recipe_json))
    if not recipe.recipe_id:
        recipe.recipe_id = render_mod.slug(recipe.title)

    spreadsheet = _connect()
    recipe_row = {
        "recipe_id": recipe.recipe_id,
        "title": recipe.title,
        "source_url": recipe.source_url,
        "image_url": recipe.image_url,
        "base_servings": recipe.base_servings,
        "prep_min": recipe.prep_min,
        "cook_min": recipe.cook_min,
        "total_min": recipe.total_min,
        "cost_estimate": recipe.cost_estimate,
        "tags": ", ".join(recipe.tags),
        "instructions": _format_instructions(recipe.instructions),
        "rating": recipe.rating,
        "ingredients_text": _format_ingredients_block(recipe.ingredients),
    }
    base_url = _config_value(spreadsheet, "render_base_url")
    file_slug = render_mod.slug(recipe.recipe_id)
    recipe_row["doc_url"] = _recipe_doc_url(base_url, file_slug)
    recipe_headers = sheets_mod.SCHEMA["Recipes"]
    sheets_mod.append_rows(
        spreadsheet, "Recipes", [[recipe_row.get(h, "") for h in recipe_headers]]
    )

    ing_headers = sheets_mod.SCHEMA["Ingredients"]
    ing_rows = [
        {
            "recipe_id": recipe.recipe_id,
            "name": ing.name,
            "qty": ing.qty,
            "unit": ing.unit,
            "category": ing.category,
            "notes": ing.notes,
            "display": _format_ingredient(ing),
        }
        for ing in recipe.ingredients
    ]
    sheets_mod.append_rows(
        spreadsheet,
        "Ingredients",
        [[row.get(h, "") for h in ing_headers] for row in ing_rows],
    )
    page_rendered = True
    try:
        _write_recipe_page(recipe_row, file_slug)
    except OSError as exc:  # a failed page must not fail an already-saved recipe
        page_rendered = False
        typer.echo(
            f"Warning: recipe saved, but rendering its page failed ({exc}); "
            "re-run `prov recipe-render` once fixed.",
            err=True,
        )
    _emit(
        {
            "saved": recipe.recipe_id,
            "ingredients": len(recipe.ingredients),
            "doc_url": recipe_row["doc_url"],
            "page_rendered": page_rendered,
        }
    )


@app.command(name="recipe-render")
def recipe_render(
    recipe_id: Annotated[
        str | None, typer.Argument(help="Recipe to render; omit with --all.")
    ] = None,
    all_recipes: Annotated[
        bool, typer.Option("--all", help="Re-render every recipe in the library.")
    ] = False,
) -> None:
    """Render recipe page(s) to docs/recipes/ and record each doc_url in the Sheet.

    Pages are a derived view, overwritten on each render; the Sheet stays the
    source of truth. Push the repo to publish them via GitHub Pages. Set the
    public base with `prov config-set render_base_url <url>`.
    """
    if all_recipes and recipe_id:
        _fail("Pass either a recipe_id or --all, not both.")
    if not all_recipes and not recipe_id:
        _fail("Pass a recipe_id or --all.")
    spreadsheet = _connect()
    rows = sheets_mod.read_table(spreadsheet, "Recipes")
    base_url = _config_value(spreadsheet, "render_base_url")
    targets = (
        rows
        if all_recipes
        else [r for r in rows if str(r.get("recipe_id")) == recipe_id]
    )
    if not targets:
        _fail(f"No recipe found for recipe_id {recipe_id!r}.")

    rendered = []
    for row in targets:  # mutating row updates the shared `rows` list in place
        file_slug = render_mod.slug(str(row.get("recipe_id")))
        row["doc_url"] = _recipe_doc_url(base_url, file_slug)
        _write_recipe_page(row, file_slug)
        rendered.append({"recipe_id": row.get("recipe_id"), "doc_url": row["doc_url"]})

    headers = sheets_mod.SCHEMA["Recipes"]
    sheets_mod.replace_table(
        spreadsheet, "Recipes", headers, [[r.get(h, "") for h in headers] for r in rows]
    )
    _emit({"rendered": rendered})


@app.command()
def recipes() -> None:
    """Print the Recipes tab as JSON."""
    spreadsheet = _connect()
    _emit(sheets_mod.read_table(spreadsheet, "Recipes"))


@app.command()
def ingredients(
    recipe_id: Annotated[
        str | None, typer.Option(help="Filter to a single recipe_id.")
    ] = None,
) -> None:
    """Print the Ingredients tab as JSON, optionally filtered by recipe_id."""
    spreadsheet = _connect()
    rows = sheets_mod.read_table(spreadsheet, "Ingredients")
    if recipe_id:
        rows = [r for r in rows if str(r.get("recipe_id")) == recipe_id]
    _emit(rows)


@app.command(name="plan-read")
def plan_read() -> None:
    """Print the current WeekPlan rows as JSON."""
    spreadsheet = _connect()
    _emit(sheets_mod.read_table(spreadsheet, "WeekPlan"))


@app.command(name="history-recent")
def history_recent(
    days: Annotated[
        int | None,
        typer.Option(
            help="Look-back window. Defaults to Config 'no_repeat_days', then 30."
        ),
    ] = None,
) -> None:
    """Print meals planned within the repeat-avoidance window (dishes to avoid)."""
    spreadsheet = _connect()
    if days is None:
        config_rows = sheets_mod.read_table(spreadsheet, "Config")
        raw = next(
            (r["value"] for r in config_rows if r.get("key") == "no_repeat_days"), None
        )
        try:
            days = (
                int(raw)
                if raw not in (None, "")
                else history_mod.DEFAULT_NO_REPEAT_DAYS
            )
        except (TypeError, ValueError):
            days = history_mod.DEFAULT_NO_REPEAT_DAYS
    rows = sheets_mod.read_table(spreadsheet, "History")
    _emit(history_mod.filter_recent(rows, days, date.today()))


@app.command()
def history() -> None:
    """Print the full History tab (all meals + ratings) for taste-learning."""
    spreadsheet = _connect()
    _emit(sheets_mod.read_table(spreadsheet, "History"))


_RATING_RANGE = range(1, 6)  # valid ratings: 1-5


@app.command()
def rate(
    recipe_id: Annotated[str, typer.Argument(help="The main's recipe_id to rate.")],
    rating: Annotated[int, typer.Argument(help="Score 1-5.")],
    notes: Annotated[
        str, typer.Option(help="Optional note, e.g. 'kids loved it'.")
    ] = "",
) -> None:
    """Rate the most recent time you cooked a main (drives taste-learning)."""
    if rating not in _RATING_RANGE:
        _fail("Rating must be between 1 and 5.")
    spreadsheet = _connect()
    headers = sheets_mod.SCHEMA["History"]
    rows = sheets_mod.read_table(spreadsheet, "History")
    updated, matched = history_mod.apply_rating(rows, recipe_id, rating, notes)
    if not matched:
        _fail(f"No History entry found for recipe_id {recipe_id!r}.")
    sheets_mod.replace_table(
        spreadsheet,
        "History",
        headers,
        [[r.get(h, "") for h in headers] for r in updated],
    )
    _emit({"rated": recipe_id, "rating": rating})


@app.command(name="history-add")
def history_add(
    rows_json: Annotated[
        str | None, typer.Argument(help="JSON list of History row objects.")
    ] = None,
) -> None:
    """Append planned meals to the History tab (call after a plan is approved)."""
    rows = _read_json_input(rows_json)
    for row in rows:
        if not row.get("id"):
            row["id"] = f"{row.get('date', '')}-{row.get('recipe_id', '')}"
    headers = sheets_mod.SCHEMA["History"]
    spreadsheet = _connect()
    table = [[row.get(h, "") for h in headers] for row in rows]
    sheets_mod.append_rows(spreadsheet, "History", table)
    _emit({"tab": "History", "rows_added": len(table)})


_WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


def _normalize_weekplan(incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map the planned days onto a fixed Monday-Sunday set of 7 day-slots.

    Returns exactly 7 rows keyed by ``day``, in weekday order. Planned days carry
    their full data; unplanned days are blank except for the ``day`` key. Keeping
    the same 7 ``day`` keys every week means AppSheet sees in-place value updates
    instead of churning row keys (which froze its sync before).
    """
    by_day: dict[str, dict[str, Any]] = {}
    for row in incoming:
        day = str(row.get("day", "")).strip().capitalize()
        if day in _WEEKDAYS:
            normalized = dict(row)
            normalized["day"] = day
            by_day[day] = normalized
    return [by_day.get(day, {"day": day}) for day in _WEEKDAYS]


@app.command(name="plan-write")
def plan_write(
    rows_json: Annotated[
        str | None, typer.Argument(help="JSON list of WeekPlan row objects.")
    ] = None,
) -> None:
    """Write the week as 7 stable day-slots (in-place updates, AppSheet-friendly)."""
    incoming = _read_json_input(rows_json)
    week = _normalize_weekplan(incoming)
    headers = sheets_mod.SCHEMA["WeekPlan"]
    table = [[row.get(h, "") for h in headers] for row in week]
    spreadsheet = _connect()
    sheets_mod.replace_table(spreadsheet, "WeekPlan", headers, table)
    planned = sum(1 for row in week if row.get("recipe_id"))
    _emit({"tab": "WeekPlan", "days_planned": planned, "rows": len(table)})


# ShoppingList checkbox columns (bought, have_already), derived from SCHEMA so a
# column reorder can't silently move the checkboxes onto the wrong columns.
_SHOPPING_CHECKBOX_COLS = [
    sheets_mod.SCHEMA["ShoppingList"].index("bought"),
    sheets_mod.SCHEMA["ShoppingList"].index("have_already"),
]


def _assign_ids(rows: list[dict[str, Any]]) -> None:
    """Give each row a unique, stable ``id`` (slug of the item) for app keys."""
    seen: dict[str, int] = {}
    for row in rows:
        if row.get("id"):
            continue
        base = render_mod.slug(str(row.get("item", "item")))
        seen[base] = seen.get(base, 0) + 1
        row["id"] = base if seen[base] == 1 else f"{base}-{seen[base]}"


@app.command(name="shopping-write")
def shopping_write(
    rows_json: Annotated[
        str | None, typer.Argument(help="JSON list of ShoppingList row objects.")
    ] = None,
) -> None:
    """Replace the ShoppingList tab and make bought/have_already tappable checkboxes."""
    rows = _read_json_input(rows_json)
    _assign_ids(rows)
    for row in rows:
        qty = row.get("qty")
        row["display"] = _format_ingredient(
            Ingredient(
                name=str(row.get("item", "")),
                qty=(qty if qty not in ("", None) else None),
                unit=str(row.get("unit", "")),
            )
        )
    headers = sheets_mod.SCHEMA["ShoppingList"]
    spreadsheet = _connect()
    table = [[row.get(h, "") for h in headers] for row in rows]
    sheets_mod.replace_table(spreadsheet, "ShoppingList", headers, table)
    sheets_mod.apply_checkboxes(
        spreadsheet, "ShoppingList", _SHOPPING_CHECKBOX_COLS, len(table)
    )
    _emit(
        {
            "tab": "ShoppingList",
            "rows_written": len(table),
            "checkboxes": "bought, have_already",
        }
    )


@app.command(name="shopping-clear")
def shopping_clear() -> None:
    """Clear all items from the ShoppingList tab (keeps the header row)."""
    headers = sheets_mod.SCHEMA["ShoppingList"]
    spreadsheet = _connect()
    sheets_mod.replace_table(spreadsheet, "ShoppingList", headers, [])
    _emit({"tab": "ShoppingList", "cleared": True})


# Common cooking fractions, for rendering quantities like a real recipe.
_FRACTIONS = [
    (0.125, "⅛"),
    (0.25, "¼"),
    (0.333, "⅓"),
    (0.375, "⅜"),
    (0.5, "½"),
    (0.625, "⅝"),
    (0.667, "⅔"),
    (0.75, "¾"),
    (0.875, "⅞"),
]
_FRACTION_TOLERANCE = 0.02


def _pretty_qty(qty: float | int | str | None) -> str:
    """Render a quantity as a clean fraction/number string (e.g. 0.67 -> '⅔')."""
    if qty in (None, ""):
        return ""
    try:
        value = float(qty)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(qty)
    whole = int(value)
    frac = round(value - whole, 3)
    symbol = next(
        (s for f, s in _FRACTIONS if abs(frac - f) < _FRACTION_TOLERANCE), None
    )
    if symbol:
        return f"{whole}{symbol}" if whole else symbol
    if frac < _FRACTION_TOLERANCE:  # effectively a whole number
        return str(whole)
    return f"{value:g}"  # fallback: trim trailing zeros (3.50 -> 3.5)


def _format_ingredients_block(ingredients: list[Ingredient]) -> str:
    """Render all ingredients as one bulleted LongText block for the recipe page.

    AppSheet caps inline related-record lists, so the full ingredient list lives
    on the recipe row as text (like the instructions) to show holistically.
    """
    return "\n".join(f"• {_format_ingredient(ing)}" for ing in ingredients)


def _format_ingredient(ing: Ingredient) -> str:
    """Render an ingredient as one clean line: 'qty unit name — notes'.

    Counted items with no explicit unit get the grocery 'ea' (each) unit, so buns
    read as '24 ea buns'. Quantity-less items (e.g. 'salt to taste') stay as
    'name — notes' with no unit.
    """
    unit = ing.unit or ("ea" if ing.qty is not None else "")
    head = " ".join(part for part in (_pretty_qty(ing.qty), unit) if part)
    line = f"{head} {ing.name}".strip() if head else ing.name
    if ing.notes:
        line = f"{line} — {ing.notes}"
    return line


def _format_instructions(steps: list[str]) -> str:
    """Format steps as a numbered list with a blank line between each.

    Renders cleanly in AppSheet's LongText fields on mobile. Strips any
    pre-existing ``N.`` / ``N)`` prefix so steps aren't double-numbered.
    """
    cleaned = [
        re.sub(r"^\s*\d+[.)]\s*", "", str(step).strip())
        for step in steps
        if str(step).strip()
    ]
    return "\n\n".join(f"{i}. {step}" for i, step in enumerate(cleaned, 1))


def main() -> None:
    """Entry point that turns any unhandled error into a clean message.

    Commands already call :func:`_fail` for expected errors (which exits via
    ``typer.Exit``, a ``SystemExit`` we deliberately don't catch). This wrapper
    is the safety net for anything unanticipated — a gspread API error mid-write,
    an unexpected response shape — so the user sees a one-line message on stderr
    instead of a raw traceback.
    """
    try:
        app()
    except sheets_mod.SheetsError as exc:
        _fail(str(exc))
    except Exception as exc:  # last-resort guard for the CLI surface
        _fail(f"Error: {exc}")


if __name__ == "__main__":  # pragma: no cover
    main()

"""Tests for the ``recipe-update`` upsert command."""

import io
import json

import pytest
import typer

from provender import cli


def _wire(monkeypatch, tmp_path, recipes, ingredients):
    """Wire the CLI's sheet I/O to in-memory tables; return captured writes + emit.

    ``read_table`` serves the live lists (so a replace is visible to later reads);
    ``replace_table`` records the rows written per tab; ``_emit`` captures the
    final JSON payload.
    """
    tables = {"Recipes": recipes, "Ingredients": ingredients}
    captured: dict[str, list] = {}
    emitted: dict = {}

    monkeypatch.setattr(cli, "_connect", object)
    cfg = {"render_base_url": "https://x.io/p", "render_dir": str(tmp_path / "recipes")}
    monkeypatch.setattr(
        cli, "_config_value", lambda ss, key, default="": cfg.get(key, default)
    )
    monkeypatch.setattr(cli.sheets_mod, "read_table", lambda ss, tab: tables[tab])
    monkeypatch.setattr(
        cli.sheets_mod,
        "replace_table",
        lambda ss, tab, headers, data: captured.__setitem__(tab, data),
    )
    monkeypatch.setattr(cli, "_emit", emitted.update)
    return captured, emitted


def _stdin(monkeypatch, payload):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))


def test_update_replaces_row_and_ingredients_in_place(monkeypatch, tmp_path):
    recipes = [
        {"recipe_id": "soup", "title": "Old Soup", "rating": 4},
        {"recipe_id": "tacos", "title": "Tacos", "rating": 5},
    ]
    ingredients = [
        {"recipe_id": "soup", "name": "old", "qty": 1},
        {"recipe_id": "tacos", "name": "shell", "qty": 8},
    ]
    captured, emitted = _wire(monkeypatch, tmp_path, recipes, ingredients)
    _stdin(
        monkeypatch,
        {
            "recipe_id": "soup",
            "title": "New Soup",
            "instructions": ["Boil it."],
            "ingredients": [{"name": "broth", "qty": 2, "unit": "cup"}],
        },
    )

    cli.recipe_update(recipe_json="-")

    assert emitted["action"] == "updated"
    assert emitted["recipe_id"] == "soup"
    assert emitted["ingredients"] == 1
    rec_schema = cli.sheets_mod.SCHEMA["Recipes"]
    rid, title = rec_schema.index("recipe_id"), rec_schema.index("title")
    written = {r[rid]: r[title] for r in captured["Recipes"]}
    # exactly one 'soup' row, retitled; the other recipe is untouched
    assert [r[rid] for r in captured["Recipes"]].count("soup") == 1
    assert written == {"soup": "New Soup", "tacos": "Tacos"}

    ing_schema = cli.sheets_mod.SCHEMA["Ingredients"]
    irid = ing_schema.index("recipe_id")
    iname, iqty = ing_schema.index("name"), ing_schema.index("qty")
    soup_ings = [
        (r[iname], r[iqty]) for r in captured["Ingredients"] if r[irid] == "soup"
    ]
    taco_ings = [r[iname] for r in captured["Ingredients"] if r[irid] == "tacos"]
    assert soup_ings == [("broth", 2)]  # old 'old' line dropped, new qty kept
    assert taco_ings == ["shell"]  # other recipe's ingredients preserved
    assert (tmp_path / "recipes" / "soup.html").exists()


def test_save_appends_to_both_tabs(monkeypatch, tmp_path):
    """Guard the refactor: recipe-save still appends a Recipes + Ingredients row."""
    appended: dict[str, list] = {}
    emitted: dict = {}
    monkeypatch.setattr(cli, "_connect", object)
    cfg = {"render_base_url": "https://x.io/p", "render_dir": str(tmp_path / "recipes")}
    monkeypatch.setattr(
        cli, "_config_value", lambda ss, key, default="": cfg.get(key, default)
    )
    monkeypatch.setattr(
        cli.sheets_mod,
        "append_rows",
        lambda ss, tab, rows: appended.setdefault(tab, []).extend(rows),
    )
    monkeypatch.setattr(cli, "_emit", emitted.update)
    _stdin(
        monkeypatch,
        {
            "recipe_id": "stew",
            "title": "Stew",
            "instructions": ["Simmer."],
            "ingredients": [{"name": "beef", "qty": 1, "unit": "lb"}],
        },
    )

    cli.recipe_save(recipe_json="-")

    assert emitted["saved"] == "stew"
    assert emitted["ingredients"] == 1
    assert len(appended["Recipes"]) == 1
    assert len(appended["Ingredients"]) == 1
    assert (tmp_path / "recipes" / "stew.html").exists()


def test_update_missing_recipe_id_appends(monkeypatch, tmp_path):
    recipes = [{"recipe_id": "tacos", "title": "Tacos"}]
    captured, emitted = _wire(monkeypatch, tmp_path, recipes, [])
    _stdin(monkeypatch, {"recipe_id": "new", "title": "New", "ingredients": []})

    cli.recipe_update(recipe_json="-")

    assert emitted["action"] == "created"
    rec_schema = cli.sheets_mod.SCHEMA["Recipes"]
    rid = rec_schema.index("recipe_id")
    assert {r[rid] for r in captured["Recipes"]} == {"tacos", "new"}


def test_update_requires_recipe_id(monkeypatch, tmp_path):
    _wire(monkeypatch, tmp_path, [], [])
    _stdin(monkeypatch, {"title": "No Id", "ingredients": []})

    with pytest.raises(typer.Exit):
        cli.recipe_update(recipe_json="-")

"""Tests for instruction and ingredient formatting."""

from provender.cli import (
    _build_ingredient_rows,
    _format_ingredient,
    _format_instructions,
    _pretty_qty,
)
from provender.models import Ingredient, Recipe


def test_pretty_qty_fractions_and_wholes():
    assert _pretty_qty(0.5) == "½"
    assert _pretty_qty(0.67) == "⅔"
    assert _pretty_qty(0.125) == "⅛"
    assert _pretty_qty(1.5) == "1½"
    assert _pretty_qty(3.0) == "3"
    assert _pretty_qty(3.5) == "3½"
    assert _pretty_qty(None) == ""
    assert _pretty_qty("") == ""


def test_countable_items_use_ea_unit():
    assert _format_ingredient(Ingredient(name="buns", qty=24, unit="")) == "24 ea buns"
    assert _format_ingredient(Ingredient(name="limes", qty=3, unit="")) == "3 ea limes"
    # quantity-less items get no unit (not "ea")
    assert _format_ingredient(Ingredient(name="salt", qty=None, notes="to taste")) == (
        "salt — to taste"
    )


def test_stored_unit_uses_ea_for_countable_items():
    recipe = Recipe(
        title="Tacos",
        recipe_id="tacos",
        ingredients=[
            Ingredient(name="tortillas", qty=12, unit=""),  # countable -> 'ea'
            Ingredient(name="chicken", qty=1, unit="lb"),  # explicit unit kept
            Ingredient(name="salt", qty=None, notes="to taste"),  # unitless stays ""
        ],
    )
    rows = _build_ingredient_rows(recipe)
    stored = {r["name"]: r["unit"] for r in rows}
    assert stored == {"tortillas": "ea", "chicken": "lb", "salt": ""}


def test_format_ingredient_clean_lines():
    assert _format_ingredient(Ingredient(name="limes", qty=3, unit="")) == "3 ea limes"
    assert (
        _format_ingredient(Ingredient(name="chicken breast", qty=0.67, unit="lb"))
        == "⅔ lb chicken breast"
    )
    garlic = Ingredient(name="garlic", qty=2, unit="clove", notes="minced")
    assert _format_ingredient(garlic) == "2 clove garlic — minced"
    assert (
        _format_ingredient(Ingredient(name="parsley", qty=None, notes="optional"))
        == "parsley — optional"
    )


def test_numbers_steps_with_blank_lines():
    out = _format_instructions(["Preheat oven.", "Cook pasta."])
    assert out == "1. Preheat oven.\n\n2. Cook pasta."


def test_strips_existing_numbering_and_blanks():
    out = _format_instructions(["1. Do this", "  ", "2) Then that"])
    assert out == "1. Do this\n\n2. Then that"


def test_empty():
    assert _format_instructions([]) == ""

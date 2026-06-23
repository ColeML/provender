"""Tests for deterministic scaling and unit conversion."""

import pytest

from provender.models import Ingredient, Recipe
from provender.scale import convert, scale_factor, scale_recipe


def test_scale_factor_handles_unknown_base():
    assert scale_factor(None, 4) == 1.0
    assert scale_factor(0, 4) == 1.0
    assert scale_factor(2, 4) == 2.0


def test_scale_recipe_multiplies_quantities_and_preserves_to_taste():
    recipe = Recipe(
        title="Test",
        base_servings=2,
        ingredients=[
            Ingredient(name="flour", qty=1.0, unit="cup"),
            Ingredient(name="salt", qty=None, notes="to taste"),
        ],
    )
    scaled = scale_recipe(recipe, 4)
    assert scaled.base_servings == 4
    assert scaled.ingredients[0].qty == 2.0
    assert scaled.ingredients[1].qty is None
    # original is untouched
    assert recipe.ingredients[0].qty == 1.0


def test_scale_recipe_survives_empty_qty_from_sheet():
    # A quantity-less ingredient read back from Sheets has qty="" (empty cell).
    # from_dict must coerce it to None so scaling doesn't TypeError on "" * factor.
    recipe = Recipe.from_dict(
        {
            "title": "X",
            "base_servings": 4,
            "ingredients": [
                {"name": "salt", "qty": "", "notes": "to taste"},
                {"name": "flour", "qty": "2", "unit": "cup"},
            ],
        }
    )
    scaled = scale_recipe(recipe, 8)
    assert scaled.ingredients[0].qty is None  # "to taste" stays unscaled
    assert scaled.ingredients[1].qty == 4.0  # "2" coerced then doubled


def test_convert_volume():
    assert convert(1, "cup", "ml") == pytest.approx(236.588, rel=1e-3)


def test_convert_incompatible_units_raises():
    with pytest.raises(Exception):  # noqa: B017 - pint raises DimensionalityError
        convert(1, "cup", "gram")

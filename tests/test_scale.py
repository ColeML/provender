"""Tests for deterministic scaling and unit conversion."""

import pytest

from provender.models import Ingredient, Recipe
from provender.scale import convert, scale_factor, scale_recipe, snap_to_kitchen_unit


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


def test_snap_to_kitchen_unit_steps_down_for_a_clean_fraction():
    # 1/3 cup * 4/3 = 4/9 cup (0.444...), which isn't a clean cup fraction,
    # but converts to 7.11 tbsp -- within tolerance of a clean 7 1/8 tbsp.
    qty, unit = snap_to_kitchen_unit(4 / 9, "cup")
    assert unit == "tbsp"
    assert qty == pytest.approx(7.125, abs=0.001)


def test_snap_to_kitchen_unit_keeps_a_clean_cup_amount():
    qty, unit = snap_to_kitchen_unit(3.75, "cup")
    assert (qty, unit) == (3.75, "cup")


def test_scale_recipe_cleans_up_volume_fractions():
    recipe = Recipe(
        title="Test",
        base_servings=6,
        ingredients=[Ingredient(name="soy sauce", qty=1 / 3, unit="cup")],
    )
    scaled = scale_recipe(recipe, 8)
    assert scaled.ingredients[0].unit == "tbsp"
    assert scaled.ingredients[0].qty == pytest.approx(7.125, abs=0.001)


def test_scale_recipe_leaves_non_volume_units_untouched():
    recipe = Recipe(
        title="Test",
        base_servings=6,
        ingredients=[Ingredient(name="chicken breast", qty=1.5, unit="lb")],
    )
    scaled = scale_recipe(recipe, 8)
    assert scaled.ingredients[0].unit == "lb"
    assert scaled.ingredients[0].qty == pytest.approx(2.0, abs=0.001)

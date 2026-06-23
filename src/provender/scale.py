"""Deterministic recipe scaling and unit conversion using :mod:`pint`.

This module does only the mechanical part of scaling: multiply each numeric
quantity by ``target / base`` servings and, when asked, convert between
compatible physical units. The *judgment* calls — non-linear spices, rounding
eggs to whole numbers, adjusting cook time and pan size — are handled by Claude
in the ``scale-recipe`` skill, not here.
"""

from __future__ import annotations

import copy
from functools import lru_cache

import pint

from provender.models import Recipe


@lru_cache(maxsize=1)
def _registry() -> pint.UnitRegistry:
    """Return a shared, lazily-built unit registry."""
    return pint.UnitRegistry()


def convert(qty: float, from_unit: str, to_unit: str) -> float:
    """Convert ``qty`` from ``from_unit`` to ``to_unit``.

    Args:
        qty: The numeric amount to convert.
        from_unit: Source unit (e.g. ``"cup"``).
        to_unit: Target unit (e.g. ``"ml"``).

    Returns:
        The converted magnitude.

    Raises:
        pint.DimensionalityError: If the units are not compatible.
        pint.UndefinedUnitError: If a unit is not recognized.
    """
    ureg = _registry()
    return (qty * ureg(from_unit)).to(to_unit).magnitude


def scale_factor(base_servings: int | None, target_servings: int) -> float:
    """Return the multiplier to scale from ``base`` to ``target`` servings.

    Falls back to ``1.0`` when the base servings are unknown, so the caller can
    surface that ambiguity to the user rather than silently mis-scaling.
    """
    if not base_servings or base_servings <= 0:
        return 1.0
    return target_servings / base_servings


def scale_recipe(recipe: Recipe, target_servings: int) -> Recipe:
    """Return a copy of ``recipe`` with quantities scaled to ``target_servings``.

    Only numeric quantities are touched; units are left as written. Ingredients
    without a quantity (e.g. "salt to taste") pass through unchanged.

    Args:
        recipe: The recipe to scale.
        target_servings: Desired number of servings.

    Returns:
        A new :class:`Recipe`; the input is not mutated.
    """
    factor = scale_factor(recipe.base_servings, target_servings)
    scaled = copy.deepcopy(recipe)
    for ingredient in scaled.ingredients:
        if ingredient.qty is not None:
            ingredient.qty = round(ingredient.qty * factor, 3)
    scaled.base_servings = target_servings
    return scaled

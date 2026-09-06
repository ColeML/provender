"""Deterministic recipe scaling and unit conversion using :mod:`pint`.

This module does the mechanical part of scaling: multiply each numeric
quantity by ``target / base`` servings, snap volume quantities to a clean
kitchen fraction, and convert between compatible physical units when asked.
The remaining *judgment* calls — non-linear spices, rounding eggs to whole
numbers, adjusting cook time and pan size — are handled by Claude in the
``scale-recipe`` skill, not here.
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


#: Standard US volume units, largest to smallest, that scaling will step down
#: through (cup -> tbsp -> tsp) when a smaller unit yields a cleaner fraction.
_VOLUME_LADDER = ("cup", "tbsp", "tsp")

#: Kitchen-standard fractions (eighths, plus thirds since 1/3 and 2/3 cup are
#: standard measuring-cup sizes) that a scaled quantity should snap to.
_KITCHEN_FRACTIONS = (0.125, 0.25, 1 / 3, 0.375, 0.5, 0.625, 2 / 3, 0.75, 0.875, 1.0)
_FRACTION_TOLERANCE = 0.02


def _nearest_fraction(frac: float) -> float:
    """Return the ``_KITCHEN_FRACTIONS`` value closest to ``frac``."""
    return min(_KITCHEN_FRACTIONS, key=lambda f: abs(frac - f))


def snap_to_kitchen_unit(qty: float, unit: str) -> tuple[float, str]:
    """Round a scaled volume quantity to a clean kitchen fraction.

    Steps down ``_VOLUME_LADDER`` (cup -> tbsp -> tsp) to find a unit where the
    amount lands on a standard fraction, e.g. ``0.444 cup`` -> ``7⅛ tbsp``.
    """
    normalized = unit.strip().lower()
    candidates = [(qty, normalized)]
    if normalized in _VOLUME_LADDER:
        for smaller in _VOLUME_LADDER[_VOLUME_LADDER.index(normalized) + 1 :]:
            candidates.append((convert(qty, normalized, smaller), smaller))

    for candidate_qty, candidate_unit in candidates:
        whole, frac = divmod(candidate_qty, 1)
        nearest = _nearest_fraction(frac)
        if frac < _FRACTION_TOLERANCE or abs(frac - nearest) < _FRACTION_TOLERANCE:
            snapped = 0.0 if frac < _FRACTION_TOLERANCE else nearest
            return round(whole + snapped, 4), candidate_unit

    # Nothing in the ladder landed cleanly; snap in place on the original unit.
    whole, frac = divmod(qty, 1)
    return round(whole + _nearest_fraction(frac), 4), normalized


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

    Volume units (cup/tbsp/tsp) are snapped to a clean kitchen fraction via
    ``snap_to_kitchen_unit``, which may also change the unit (e.g. cup -> tbsp).
    Other units keep their linear-scaled value, rounded to 3 decimals.
    Ingredients without a quantity (e.g. "salt to taste") pass through unchanged.
    """
    factor = scale_factor(recipe.base_servings, target_servings)
    scaled = copy.deepcopy(recipe)
    for ingredient in scaled.ingredients:
        if ingredient.qty is None:
            continue
        raw = ingredient.qty * factor
        if (ingredient.unit or "").strip().lower() in _VOLUME_LADDER:
            ingredient.qty, ingredient.unit = snap_to_kitchen_unit(raw, ingredient.unit)
        else:
            ingredient.qty = round(raw, 3)
    scaled.base_servings = target_servings
    return scaled

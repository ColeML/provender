"""Core data models shared across the meal planner.

These are plain dataclasses that map onto the Google Sheets tabs described in
``PLAN.md``. They carry no behavior beyond (de)serialization helpers so they can
be passed to and from the CLI as JSON.
"""

from __future__ import annotations

import dataclasses
import json
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Ingredient:
    """A single ingredient line belonging to a recipe.

    Attributes:
        name: Canonical ingredient name, e.g. ``"garlic"``.
        qty: Numeric quantity. ``None`` when the source gives none (e.g. "to taste").
        unit: Unit string as written, e.g. ``"clove"``, ``"g"``, ``"cup"``.
        category: Store aisle / grouping, e.g. ``"produce"``. May be empty.
        notes: Free-text qualifiers such as ``"minced"`` or ``"divided"``.
    """

    name: str
    qty: float | None = None
    unit: str = ""
    category: str = ""
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict representation."""
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Ingredient:
        """Build an ``Ingredient`` from a plain dict, tolerant of sheet reads.

        Filters unknown keys and coerces ``qty`` to ``float | None`` — Google
        Sheets returns an empty numeric cell as ``""``, which would otherwise
        break arithmetic in :func:`provender.scale.scale_recipe`.
        """
        known = {f.name for f in dataclasses.fields(cls)}
        kwargs = {k: v for k, v in data.items() if k in known}
        qty = kwargs.get("qty")
        if qty in ("", None):
            kwargs["qty"] = None
        else:
            try:
                kwargs["qty"] = float(qty)
            except (TypeError, ValueError):
                kwargs["qty"] = None
        return cls(**kwargs)


@dataclass(slots=True)
class Recipe:
    """A recipe scraped from the web or stored in the library.

    Attributes:
        title: Human-readable recipe name.
        source_url: Original URL the recipe was scraped from.
        image_url: URL of the recipe's main photo, if available.
        base_servings: Servings the ingredient quantities are written for.
        ingredients: Parsed ingredient lines.
        instructions: Ordered preparation steps.
        prep_min: Prep time in minutes, if known.
        cook_min: Cook time in minutes, if known.
        total_min: Total time in minutes, if known.
        tags: Free-form labels (cuisine, "quick", "vegetarian", ...).
        cost_estimate: Estimated cost in local currency, filled in by Claude.
        recipe_id: Stable identifier once persisted to Sheets.
        rating: Optional 1-5 personal rating used for taste learning.
    """

    title: str
    source_url: str = ""
    image_url: str = ""
    base_servings: int | None = None
    ingredients: list[Ingredient] = field(default_factory=list)
    instructions: list[str] = field(default_factory=list)
    prep_min: int | None = None
    cook_min: int | None = None
    total_min: int | None = None
    tags: list[str] = field(default_factory=list)
    cost_estimate: float | None = None
    recipe_id: str = ""
    rating: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict representation."""
        return dataclasses.asdict(self)

    def to_json(self, *, indent: int | None = 2) -> str:
        """Serialize the recipe to a JSON string."""
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Recipe:
        """Build a ``Recipe`` from a plain dict (inverse of :meth:`to_dict`).

        ``tags`` and ``instructions`` are lists, but ``prov recipes`` reads them
        back from the Sheet as strings (a comma-joined ``tags`` and a
        blank-line-separated, numbered ``instructions`` block). Normalize those
        string shapes so a recipe round-tripped through the Sheet can be fed
        straight back to ``recipe-update`` — otherwise each character would be
        treated as its own tag/step.
        """
        ingredients = [Ingredient.from_dict(i) for i in data.get("ingredients", [])]
        known = {f.name for f in dataclasses.fields(cls)}
        kwargs = {k: v for k, v in data.items() if k in known}
        kwargs["ingredients"] = ingredients

        tags = kwargs.get("tags")
        if isinstance(tags, str):
            kwargs["tags"] = [t.strip() for t in tags.split(",") if t.strip()]

        instructions = kwargs.get("instructions")
        if isinstance(instructions, str):
            steps = re.split(r"\n\s*\n", instructions)
            if len(steps) <= 1:
                steps = instructions.split("\n")
            kwargs["instructions"] = [s.strip() for s in steps if s.strip()]

        return cls(**kwargs)

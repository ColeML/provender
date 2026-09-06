"""Merging rules for the shopping list.

The ``ShoppingList`` tab is the phone-facing checklist: ``bought`` and
``have_already`` are checkboxes ticked while standing in the store. Replacing the
tab wholesale wiped those ticks, so a late-added meal or a rebuilt list sent the
shopper back around the aisles. Both paths now merge against what is already
there.

The matching rules live here as pure functions so they can be tested without
touching Google Sheets.
"""

from __future__ import annotations

import re
from typing import Any

_WHITESPACE = re.compile(r"\s+")

#: Sheet values that count as a ticked checkbox (gspread returns bools or text).
_CHECKED = {"true", "yes", "1", "y", "x", "✓"}


def merge_key(row: dict[str, Any]) -> tuple[str, str]:
    """Identify a line by its item name and unit, both normalized.

    Unit is part of the key deliberately: "3 lb chicken breast" and "1 ea
    rotisserie chicken" are different purchases, so they stay on separate lines
    instead of summing into a meaningless total. Reconciling across units is a
    judgment call the planning agent makes, not something to guess here.
    """
    item = _WHITESPACE.sub(" ", str(row.get("item", "")).strip().lower())
    unit = str(row.get("unit", "")).strip().lower()
    return item, unit


def is_checked(value: Any) -> bool:
    """Report whether a checkbox cell is ticked."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in _CHECKED


def _num(value: Any) -> float | None:
    """Coerce a sheet value to a float, or ``None`` when blank or non-numeric."""
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _add_numeric(existing: Any, incoming: Any) -> Any:
    """Sum two sheet numbers, keeping whichever side is present when only one is."""
    left, right = _num(existing), _num(incoming)
    if left is None:
        return existing if right is None else right
    if right is None:
        return left
    return round(left + right, 2)


def _merge_feeds(existing: Any, incoming: Any) -> str:
    """Union two comma-separated recipe lists, keeping first-seen order."""
    out: list[str] = []
    for source in (existing, incoming):
        for part in str(source or "").split(","):
            name = part.strip()
            if name and name not in out:
                out.append(name)
    return ", ".join(out)


def merge_rows(
    existing: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int, int]:
    """Fold ``incoming`` lines into ``existing`` without disturbing check state.

    A line that already exists gains the new quantity, cost, and recipe names
    while keeping its ``id`` and its ticks. A line that is new is appended
    unticked.

    Args:
        existing: The current ShoppingList rows.
        incoming: Rows to add, in the same shape.

    Returns:
        ``(merged_rows, added, updated)``.
    """
    merged = [dict(row) for row in existing]
    index = {merge_key(row): i for i, row in enumerate(merged)}
    added = updated = 0
    for row in incoming:
        key = merge_key(row)
        position = index.get(key)
        if position is None:
            fresh = dict(row)
            fresh["bought"] = ""
            fresh["have_already"] = ""
            index[key] = len(merged)
            merged.append(fresh)
            added += 1
            continue
        target = merged[position]
        target["qty"] = _add_numeric(target.get("qty"), row.get("qty"))
        target["est_cost"] = _add_numeric(target.get("est_cost"), row.get("est_cost"))
        target["feeds_recipes"] = _merge_feeds(
            target.get("feeds_recipes"), row.get("feeds_recipes")
        )
        updated += 1
    return merged, added, updated


def carry_over_check_state(
    existing: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> int:
    """Copy ticks from ``existing`` onto matching rows in a regenerated list.

    Rebuilding the list from scratch would otherwise clear everything already
    bought. Only ticked values carry over, and only onto rows that are not
    already ticked.

    Args:
        existing: The rows currently on the tab.
        incoming: The replacement rows, mutated in place.

    Returns:
        How many rows kept a tick.
    """
    by_key = {merge_key(row): row for row in existing}
    kept = 0
    for row in incoming:
        prior = by_key.get(merge_key(row))
        if prior is None:
            continue
        carried = False
        for field in ("bought", "have_already"):
            if is_checked(prior.get(field)) and not is_checked(row.get(field)):
                row[field] = prior[field]
                carried = True
        if carried:
            kept += 1
    return kept

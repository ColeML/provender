"""Meal history and repeat-avoidance logic.

The ``History`` tab accumulates one row per planned meal (unlike ``WeekPlan``,
which is replaced each week). When planning, the ``plan-week`` skill consults the
recent window so it can avoid repeating dishes within a configurable number of
days (``no_repeat_days`` in Config, defaulting to :data:`DEFAULT_NO_REPEAT_DAYS`).

The window filtering lives here as a pure function so it can be unit-tested
without touching Google Sheets.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable

#: Default repeat-avoidance window in days when Config has no ``no_repeat_days``.
DEFAULT_NO_REPEAT_DAYS = 30


def _parse_date(value: Any) -> date | None:
    """Parse an ISO ``YYYY-MM-DD`` value, returning ``None`` if unparseable."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def filter_recent(
    rows: Iterable[dict[str, Any]], days: int, today: date
) -> list[dict[str, Any]]:
    """Return history rows planned within the last ``days`` days.

    Args:
        rows: History records, each with at least a ``date`` field.
        days: Size of the look-back window in days. Values <= 0 return nothing.
        today: The reference date (the window is ``[today - days, today]``).

    Returns:
        The subset of ``rows`` whose date falls inside the window, preserving
        input order.
    """
    if days <= 0:
        return []
    cutoff = today - timedelta(days=days)
    recent: list[dict[str, Any]] = []
    for row in rows:
        parsed = _parse_date(row.get("date"))
        if parsed and cutoff <= parsed <= today:
            recent.append(row)
    return recent


def apply_rating(
    rows: list[dict[str, Any]], recipe_id: str, rating: int, notes: str
) -> tuple[list[dict[str, Any]], bool]:
    """Set ``rating``/``notes`` on the most recent History row for ``recipe_id``.

    "Most recent" is the matching row with the latest parseable date (ties keep
    the last such row). Taste-learning then favors high-rated mains and avoids
    low-rated ones.

    Args:
        rows: History records.
        recipe_id: The main's recipe_id to rate.
        rating: Score 1-5 (validated by the caller).
        notes: Optional free-text note; left untouched when empty.

    Returns:
        ``(updated_rows, matched)`` — ``matched`` is ``False`` if no row had that
        ``recipe_id`` (the caller surfaces a clear error).
    """
    latest_idx: int | None = None
    latest_date: date | None = None
    for i, row in enumerate(rows):
        if str(row.get("recipe_id")) != recipe_id:
            continue
        parsed = _parse_date(row.get("date"))
        if latest_idx is None or (
            parsed and (latest_date is None or parsed >= latest_date)
        ):
            latest_idx, latest_date = i, parsed
    if latest_idx is None:
        return rows, False
    out = [dict(r) for r in rows]
    out[latest_idx]["rating"] = rating
    if notes:
        out[latest_idx]["notes"] = notes
    return out, True

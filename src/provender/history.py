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

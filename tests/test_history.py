"""Tests for repeat-avoidance window filtering and rating."""

from datetime import date

from provender.history import apply_rating, filter_recent

TODAY = date(2026, 6, 13)

ROWS = [
    {"date": "2026-06-10", "recipe_id": "a", "title": "Tacos"},  # 3 days ago
    {"date": "2026-05-20", "recipe_id": "b", "title": "Chili"},  # 24 days ago
    {"date": "2026-04-01", "recipe_id": "c", "title": "Lasagna"},  # 73 days ago
    {"date": "", "recipe_id": "d", "title": "No date"},  # unparseable
]


def test_filter_recent_includes_only_window():
    recent = filter_recent(ROWS, days=30, today=TODAY)
    ids = {r["recipe_id"] for r in recent}
    assert ids == {"a", "b"}  # lasagna too old, no-date dropped


def test_filter_recent_tighter_window():
    recent = filter_recent(ROWS, days=7, today=TODAY)
    assert {r["recipe_id"] for r in recent} == {"a"}


def test_filter_recent_zero_days_returns_nothing():
    assert filter_recent(ROWS, days=0, today=TODAY) == []


def test_filter_recent_preserves_order():
    recent = filter_recent(ROWS, days=30, today=TODAY)
    assert [r["recipe_id"] for r in recent] == ["a", "b"]


def test_apply_rating_targets_most_recent_occurrence():
    rows = [
        {"date": "2026-05-01", "recipe_id": "tacos", "rating": "", "notes": ""},
        {"date": "2026-06-10", "recipe_id": "tacos", "rating": "", "notes": ""},
        {"date": "2026-06-01", "recipe_id": "chili", "rating": "", "notes": ""},
    ]
    out, matched = apply_rating(rows, "tacos", 5, "kids loved it")
    assert matched is True
    assert out[1]["rating"] == 5  # the 2026-06-10 tacos, not the 2026-05-01 one
    assert out[1]["notes"] == "kids loved it"
    assert out[0]["rating"] == ""  # older occurrence untouched
    # original list not mutated
    assert rows[1]["rating"] == ""


def test_apply_rating_no_match_returns_false():
    _, matched = apply_rating([{"date": "2026-06-01", "recipe_id": "x"}], "y", 4, "")
    assert matched is False

"""Tests for the stable day-slot WeekPlan normalization."""

from provender.cli import _WEEKDAYS, _normalize_weekplan


def test_always_seven_rows_in_weekday_order():
    week = _normalize_weekplan([{"day": "Tuesday", "recipe_id": "tacos"}])
    assert [r["day"] for r in week] == _WEEKDAYS
    assert len(week) == 7


def test_planned_days_keep_data_unplanned_are_blank():
    week = _normalize_weekplan(
        [
            {"day": "Monday", "recipe_id": "ziti", "servings": 8},
            {"day": "Friday", "recipe_id": "pizza", "servings": 7},
        ]
    )
    by_day = {r["day"]: r for r in week}
    assert by_day["Monday"]["recipe_id"] == "ziti"
    assert by_day["Friday"]["recipe_id"] == "pizza"
    # unplanned days carry only the stable key, no meal
    assert by_day["Wednesday"] == {"day": "Wednesday"}
    assert "recipe_id" not in by_day["Sunday"]


def test_day_casing_is_normalized():
    week = _normalize_weekplan([{"day": "monDAY", "recipe_id": "x"}])
    by_day = {r["day"]: r for r in week}
    assert by_day["Monday"]["recipe_id"] == "x"

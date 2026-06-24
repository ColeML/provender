"""Tests for the learned-prices upsert."""

from provender.prices import upsert_price


def test_appends_a_new_ingredient():
    rows = upsert_price([], "chicken breast", 2.5, "lb", "Sam's Club", "2026-06-24")
    assert rows == [
        {
            "ingredient": "chicken breast",
            "unit": "lb",
            "price": 2.5,
            "store": "Sam's Club",
            "updated": "2026-06-24",
        }
    ]


def test_updates_existing_case_insensitively_in_place():
    existing = [
        {
            "ingredient": "Chicken Breast",
            "unit": "lb",
            "price": 3.0,
            "store": "",
            "updated": "x",
        },
        {"ingredient": "rice", "unit": "lb", "price": 1.0, "store": "", "updated": "x"},
    ]
    rows = upsert_price(existing, "chicken breast", 2.5, "lb", "Walmart", "2026-06-24")
    assert len(rows) == 2  # replaced, not appended
    assert rows[0]["price"] == 2.5
    assert rows[0]["store"] == "Walmart"
    assert rows[1]["ingredient"] == "rice"  # order preserved


def test_only_first_match_is_replaced():
    existing = [
        {"ingredient": "milk", "price": 1.0},
        {"ingredient": "milk", "price": 2.0},
    ]
    rows = upsert_price(existing, "milk", 9.0, "gal", "", "2026-06-24")
    assert [r["price"] for r in rows] == [9.0, 2.0]

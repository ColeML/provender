"""Tests for shopping-list merging and checkbox preservation."""

from provender.shopping import (
    carry_over_check_state,
    is_checked,
    merge_key,
    merge_rows,
)


def line(item, qty, unit="lb", **extra):
    row = {"item": item, "qty": qty, "unit": unit, "est_cost": 1.0}
    row.update(extra)
    return row


def test_merge_key_normalizes_case_and_spacing():
    assert merge_key({"item": "  Green   Onions ", "unit": "Bunch"}) == (
        "green onions",
        "bunch",
    )


def test_same_item_different_unit_stays_separate():
    existing = [line("chicken breast", 3, "lb")]
    merged, added, updated = merge_rows(existing, [line("chicken breast", 1, "ea")])
    assert (added, updated) == (1, 0)
    assert len(merged) == 2


def test_matching_line_sums_and_keeps_its_tick():
    existing = [
        line("milk", 1, "gallon", bought=True, id="milk", feeds_recipes="Pancakes")
    ]
    merged, added, updated = merge_rows(
        existing, [line("Milk", 1, "gallon", feeds_recipes="Queso")]
    )
    assert (added, updated) == (0, 1)
    assert merged[0]["qty"] == 2
    assert merged[0]["est_cost"] == 2.0
    assert merged[0]["bought"] is True  # the whole point: ticks survive
    assert merged[0]["id"] == "milk"
    assert merged[0]["feeds_recipes"] == "Pancakes, Queso"


def test_new_line_is_appended_unticked():
    merged, added, _ = merge_rows([line("milk", 1, "gallon", bought=True)], [])
    assert added == 0
    merged, added, _ = merge_rows([], [line("velveeta", 32, "oz", bought=True)])
    assert added == 1
    # an incoming row must never arrive pre-ticked
    assert merged[0]["bought"] == ""
    assert merged[0]["have_already"] == ""


def test_merge_handles_blank_and_non_numeric_quantities():
    existing = [line("salt", "", "tsp")]
    merged, _, _ = merge_rows(existing, [line("salt", 2, "tsp")])
    assert merged[0]["qty"] == 2
    merged, _, _ = merge_rows([line("bacon", "to taste", "")], [line("bacon", "", "")])
    assert merged[0]["qty"] == "to taste"


def test_carry_over_keeps_ticks_across_a_rebuild():
    existing = [
        line("bacon", 12, "oz", bought=True),
        line("eggs", 12, "large", have_already="TRUE"),
        line("gone", 1, "ea", bought=True),
    ]
    rebuilt = [line("bacon", 12, "oz"), line("eggs", 12, "large"), line("new", 1, "ea")]
    kept = carry_over_check_state(existing, rebuilt)
    assert kept == 2
    assert rebuilt[0]["bought"] is True
    assert rebuilt[1]["have_already"] == "TRUE"
    assert rebuilt[2].get("bought") in (None, "")  # a brand new line stays unticked


def test_carry_over_ignores_unticked_prior_rows():
    existing = [line("bacon", 12, "oz", bought="FALSE")]
    rebuilt = [line("bacon", 12, "oz")]
    assert carry_over_check_state(existing, rebuilt) == 0


def test_is_checked_accepts_the_shapes_sheets_returns():
    assert all(is_checked(v) for v in (True, "TRUE", "true", "Yes", "1", "x"))
    assert not any(is_checked(v) for v in (False, "FALSE", "", None, "no", 0))

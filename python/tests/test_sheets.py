"""Tests for the Google Sheets helpers using a mocked gspread spreadsheet."""

from unittest.mock import MagicMock

from provender import sheets


def _spreadsheet_with(worksheet):
    spreadsheet = MagicMock()
    spreadsheet.worksheet.return_value = worksheet
    return spreadsheet


def test_replace_table_clears_then_writes_headers_and_rows():
    ws = MagicMock()
    ss = _spreadsheet_with(ws)
    sheets.replace_table(ss, "Config", ["key", "value"], [["people", "4"]])
    ws.clear.assert_called_once()
    ws.update.assert_called_once_with([["key", "value"], ["people", "4"]], "A1")


def test_append_rows_skips_empty_and_appends_otherwise():
    ws = MagicMock()
    ss = _spreadsheet_with(ws)
    sheets.append_rows(ss, "Recipes", [])
    ws.append_rows.assert_not_called()
    sheets.append_rows(ss, "Recipes", [["a", "b"]])
    ws.append_rows.assert_called_once()


def test_set_config_value_updates_existing_key():
    ws = MagicMock()
    ws.col_values.return_value = ["key", "people", "location"]
    ss = _spreadsheet_with(ws)
    assert sheets.set_config_value(ss, "people", "4") == "updated"
    ws.update_cell.assert_called_once_with(2, 2, "4")  # row 2 (1-based), col B


def test_set_config_value_appends_new_key():
    ws = MagicMock()
    ws.col_values.return_value = ["key", "people"]
    ss = _spreadsheet_with(ws)
    assert sheets.set_config_value(ss, "location", "Edmond, OK") == "added"
    ws.append_row.assert_called_once()


def test_apply_checkboxes_builds_clear_plus_one_request_per_column():
    ws = MagicMock()
    ws.id = 1
    ws.col_count = 10
    ss = _spreadsheet_with(ws)
    sheets.apply_checkboxes(ss, "ShoppingList", [5, 8], n_rows=3)
    requests = ss.batch_update.call_args[0][0]["requests"]
    assert len(requests) == 3  # 1 clear-validation + 2 checkbox columns
    set_cols = [
        r["setDataValidation"]["range"]["startColumnIndex"] for r in requests[1:]
    ]
    assert set_cols == [5, 8]


def test_apply_checkboxes_is_a_noop_without_rows():
    ss = _spreadsheet_with(MagicMock())
    sheets.apply_checkboxes(ss, "ShoppingList", [5, 8], n_rows=0)
    ss.batch_update.assert_not_called()


def test_ensure_schema_creates_only_missing_tabs():
    existing = MagicMock()
    existing.title = "Sheet1"
    ss = MagicMock()
    ss.worksheets.return_value = [existing]
    created = sheets.ensure_schema(ss)
    assert created == list(sheets.SCHEMA)
    assert ss.add_worksheet.call_count == len(sheets.SCHEMA)

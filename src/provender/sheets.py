"""Google Sheets backend using ``gspread`` with service-account auth.

The spreadsheet is the planner's single source of truth and the phone-facing UI.
This module handles authentication, schema bootstrapping (creating the expected
tabs with headers), and generic table read/replace operations. Higher-level
record shaping is left to the CLI and the Claude skills.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import gspread
from google.oauth2.service_account import Credentials

from provender.config import Settings

if TYPE_CHECKING:
    from collections.abc import Sequence

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

#: Tab name -> ordered column headers. Mirrors the schema in ``PLAN.md``.
SCHEMA: dict[str, list[str]] = {
    "Config": ["key", "value"],
    "WeekPlan": [
        "date",
        "day",
        "meal_slot",
        "recipe_id",
        "servings",
        "day_prefs",
        "side_recipe_id",
        "status",
    ],
    "Recipes": [
        "recipe_id",
        "title",
        "source_url",
        "image_url",
        "base_servings",
        "prep_min",
        "cook_min",
        "total_min",
        "cost_estimate",
        "tags",
        "instructions",
        "rating",
        "ingredients_text",
    ],
    "Ingredients": ["recipe_id", "name", "qty", "unit", "category", "notes", "display"],
    "ShoppingList": [
        "id",
        "item",
        "qty",
        "unit",
        "category",
        "bought",
        "feeds_recipes",
        "est_cost",
        "have_already",
        "display",
    ],
    "History": ["id", "date", "recipe_id", "title", "meal_slot"],
}


class SheetsError(RuntimeError):
    """Raised when the spreadsheet cannot be opened or configured."""


def connect(settings: Settings) -> gspread.Spreadsheet:
    """Authenticate and open the configured spreadsheet.

    Args:
        settings: Resolved runtime settings (credentials path + spreadsheet ref).

    Returns:
        An open :class:`gspread.Spreadsheet`.

    Raises:
        SheetsError: If credentials are missing, the spreadsheet is unset, or it
            cannot be opened (e.g. not shared with the service account).
    """
    if not settings.credentials_path.exists():
        raise SheetsError(
            f"Credentials file not found at {settings.credentials_path}. "
            "Set MEALPLAN_CREDENTIALS or place the service-account key there."
        )
    if not settings.spreadsheet:
        raise SheetsError(
            "No spreadsheet configured. Set MEALPLAN_SPREADSHEET to the sheet ID "
            "or URL (and share the sheet with the service-account email)."
        )

    creds = Credentials.from_service_account_file(
        str(settings.credentials_path), scopes=_SCOPES
    )
    client = gspread.authorize(creds)
    ref = settings.spreadsheet
    try:
        if ref.startswith("http"):
            return client.open_by_url(ref)
        return client.open_by_key(ref)
    except gspread.exceptions.APIError as exc:  # pragma: no cover - network path
        raise SheetsError(
            f"Could not open spreadsheet {ref!r}. Is it shared with the "
            "service-account email?"
        ) from exc


def ensure_schema(spreadsheet: gspread.Spreadsheet) -> list[str]:
    """Create any missing tabs and write their header rows.

    Existing tabs are left untouched (headers are only written to freshly created
    worksheets), so this is safe to run repeatedly.

    Args:
        spreadsheet: The open spreadsheet to bootstrap.

    Returns:
        The names of tabs that were created during this call.
    """
    existing = {ws.title for ws in spreadsheet.worksheets()}
    created: list[str] = []
    for name, headers in SCHEMA.items():
        if name in existing:
            continue
        worksheet = spreadsheet.add_worksheet(name, rows=200, cols=max(len(headers), 8))
        worksheet.update([headers], "A1")
        created.append(name)
    return created


def read_table(spreadsheet: gspread.Spreadsheet, tab: str) -> list[dict[str, Any]]:
    """Read a tab as a list of records keyed by the header row.

    Args:
        spreadsheet: The open spreadsheet.
        tab: Worksheet/tab name.

    Returns:
        One dict per data row, keyed by column header.
    """
    return spreadsheet.worksheet(tab).get_all_records()


def replace_table(
    spreadsheet: gspread.Spreadsheet,
    tab: str,
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
) -> None:
    """Overwrite a tab's contents with ``headers`` followed by ``rows``.

    Args:
        spreadsheet: The open spreadsheet.
        tab: Worksheet/tab name. Must already exist.
        headers: Column header row.
        rows: Data rows, each a sequence aligned to ``headers``.
    """
    worksheet = spreadsheet.worksheet(tab)
    worksheet.clear()
    worksheet.update([list(headers), *[list(r) for r in rows]], "A1")


def append_rows(
    spreadsheet: gspread.Spreadsheet,
    tab: str,
    rows: Sequence[Sequence[Any]],
) -> None:
    """Append ``rows`` to the bottom of an existing tab.

    Args:
        spreadsheet: The open spreadsheet.
        tab: Worksheet/tab name. Must already exist.
        rows: Data rows, each a sequence aligned to the tab's headers.
    """
    if not rows:
        return
    worksheet = spreadsheet.worksheet(tab)
    worksheet.append_rows([list(r) for r in rows], value_input_option="USER_ENTERED")


def apply_checkboxes(
    spreadsheet: gspread.Spreadsheet,
    tab: str,
    column_indices: Sequence[int],
    n_rows: int,
) -> None:
    """Turn data cells in the given columns into tappable checkboxes.

    Applies BOOLEAN data validation so the cells render as checkboxes in both the
    web and mobile Google Sheets apps (one tap to mark on a phone). Empty cells
    show as unchecked.

    Args:
        spreadsheet: The open spreadsheet.
        tab: Worksheet/tab name.
        column_indices: Zero-based column indices to convert (e.g. ``[4]`` for E).
        n_rows: Number of data rows (excluding the header) to cover.
    """
    if n_rows <= 0:
        return
    worksheet = spreadsheet.worksheet(tab)
    # Clear any existing validation across the data rows first, so checkboxes from a
    # previous (differently-shaped) layout don't linger on the wrong columns.
    requests: list[dict[str, Any]] = [
        {
            "setDataValidation": {
                "range": {
                    "sheetId": worksheet.id,
                    "startRowIndex": 1,
                    "endRowIndex": 1 + n_rows,
                    "startColumnIndex": 0,
                    "endColumnIndex": worksheet.col_count,
                }
            }
        }
    ]
    requests += [
        {
            "setDataValidation": {
                "range": {
                    "sheetId": worksheet.id,
                    "startRowIndex": 1,
                    "endRowIndex": 1 + n_rows,
                    "startColumnIndex": col,
                    "endColumnIndex": col + 1,
                },
                "rule": {
                    "condition": {"type": "BOOLEAN"},
                    "showCustomUi": True,
                    "strict": True,
                },
            }
        }
        for col in column_indices
    ]
    spreadsheet.batch_update({"requests": requests})


def set_config_value(spreadsheet: gspread.Spreadsheet, key: str, value: str) -> str:
    """Upsert a key/value pair in the Config tab.

    Args:
        spreadsheet: The open spreadsheet.
        key: Config key (column A). Updated in place if it already exists.
        value: Value to store (column B).

    Returns:
        ``"updated"`` if the key existed, otherwise ``"added"``.
    """
    worksheet = spreadsheet.worksheet("Config")
    keys = worksheet.col_values(1)  # column A, including the "key" header
    if key in keys:
        worksheet.update_cell(keys.index(key) + 1, 2, value)
        return "updated"
    worksheet.append_row([key, value], value_input_option="USER_ENTERED")
    return "added"

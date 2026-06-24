"""Learned grocery prices for sharper budget estimates.

Neither Walmart nor Sam's Club exposes a usable pricing API, so the planner
learns prices instead: you record what things actually cost (``prov price-set``)
and the plan/shopping skills prefer those over AI guesses. The upsert lives here
as a pure function so it can be unit-tested without touching Google Sheets.

Future idea — a smarter *fallback* than an AI guess when no learned price exists,
for the generic items we typically buy (non-organic produce, ground beef, etc.):

- **BLS Average Price Data** — free official US averages for ~70 staple items,
  by Census region (we're South); real $/lb. https://www.bls.gov/cpi/factsheets/average-prices.htm
- **USDA ERS** — $/lb for ~150 fruits & vegetables.

Both are generic (non-branded) and regional, not store-specific — so they'd sit
*below* the learned Prices tab but *above* a pure estimate. (Open Prices was
evaluated and rejected: ~0 generic-ingredient coverage near us.)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable


def _key(ingredient: str) -> str:
    """Normalize an ingredient name for case-insensitive matching."""
    return ingredient.strip().lower()


def upsert_price(
    rows: Iterable[dict[str, Any]],
    ingredient: str,
    price: float,
    unit: str,
    store: str,
    updated: str,
) -> list[dict[str, Any]]:
    """Return the price rows with ``ingredient`` set to the given price.

    Matches case-insensitively on the ingredient name: an existing entry is
    replaced in place, otherwise a new row is appended. Input order is preserved.

    Args:
        rows: Existing Prices records.
        ingredient: Ingredient name (the match key).
        price: Unit price.
        unit: The unit the price is per (e.g. ``"lb"``, ``"ea"``).
        store: Optional store the price is from (e.g. ``"Sam's Club"``).
        updated: ISO date the price was recorded.

    Returns:
        The updated list of price-row dicts.
    """
    entry = {
        "ingredient": ingredient.strip(),
        "unit": unit,
        "price": price,
        "store": store,
        "updated": updated,
    }
    out: list[dict[str, Any]] = []
    replaced = False
    for row in rows:
        if not replaced and _key(str(row.get("ingredient", ""))) == _key(ingredient):
            out.append(entry)
            replaced = True
        else:
            out.append(dict(row))
    if not replaced:
        out.append(entry)
    return out

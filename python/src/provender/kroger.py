"""Optional Kroger price lookups — real store prices as a budgeting fallback.

**Opt-in.** Only used when the user has supplied Kroger API credentials at
``<config_dir>/kroger.json`` and chosen a store (``kroger_location_id`` in the
Config tab). Uses the OAuth client-credentials flow against the public Products
and Locations APIs.

Kroger doesn't operate everywhere, but a nearby Kroger-family banner (e.g.
Dillons) is a useful real-price proxy where in-store prices track the user's
local stores. The price tier is: learned Prices -> Kroger (if configured) ->
AI estimate.

The response parsers are pure functions (tested without the network); the HTTP
calls are thin wrappers around them.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from provender.config import config_dir

_TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
_API = "https://api.kroger.com/v1"
_CREDS_FILE = "kroger.json"
_TOKEN_CACHE = "kroger_token.json"

# Store-brand markers used to pick a "generic" representative price.
_STORE_BRANDS = ("kroger", "private selection", "simple truth", "dillons")


class KrogerError(RuntimeError):
    """Raised when Kroger is not configured or the API call fails."""


def credentials() -> tuple[str, str] | None:
    """Return ``(client_id, client_secret)`` from the creds file, or ``None``."""
    path = config_dir() / _CREDS_FILE
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    cid, secret = data.get("client_id"), data.get("client_secret")
    return (cid, secret) if cid and secret else None


def is_configured() -> bool:
    """Whether Kroger credentials are present (the opt-in switch)."""
    return credentials() is not None


# ---- pure parsers (network-free, unit-tested) ----


def parse_locations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract ``[{location_id, name, chain, address}]`` from a Locations response."""
    out: list[dict[str, Any]] = []
    for store in payload.get("data", []):
        addr = store.get("address") or {}
        line = ", ".join(
            p
            for p in (addr.get("addressLine1"), addr.get("city"), addr.get("state"))
            if p
        )
        out.append(
            {
                "location_id": store.get("locationId"),
                "name": store.get("name"),
                "chain": store.get("chain"),
                "address": line,
            }
        )
    return out


def parse_products(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract price candidates from a Products API response."""
    out: list[dict[str, Any]] = []
    for product in payload.get("data", []):
        item = (product.get("items") or [{}])[0]
        price = item.get("price") or {}
        out.append(
            {
                "description": product.get("description"),
                "brand": product.get("brand"),
                "size": item.get("size"),
                "regular": price.get("regular"),
                "promo": price.get("promo") or None,
            }
        )
    return out


def representative_price(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick a sensible "generic" price from product candidates.

    Prefers a store brand, prefers non-organic, then the lowest regular price —
    so a search for "ground beef" lands on the plain store-brand tray, not the
    organic grass-fed pack. Returns ``None`` if nothing has a price.
    """
    priced = [c for c in candidates if c.get("regular")]
    if not priced:
        return None

    def score(c: dict[str, Any]) -> tuple[int, int, float]:
        brand = (c.get("brand") or "").lower()
        text = f"{brand} {(c.get('description') or '').lower()}"
        store_brand = any(sb in brand for sb in _STORE_BRANDS)
        organic = "organic" in text
        return (0 if store_brand else 1, 1 if organic else 0, float(c["regular"]))

    return sorted(priced, key=score)[0]


# ---- HTTP (thin wrappers) ----


def _get_token() -> str:
    """Return a cached or freshly-minted OAuth token."""
    cache = config_dir() / _TOKEN_CACHE
    now = time.time()
    if cache.exists():
        try:
            cached = json.loads(cache.read_text(encoding="utf-8"))
            if cached.get("access_token") and cached.get("expires_at", 0) > now + 30:
                return cached["access_token"]
        except (json.JSONDecodeError, OSError):
            pass
    creds = credentials()
    if not creds:
        raise KrogerError(
            f"Kroger not configured. Add client_id/client_secret to "
            f"{config_dir() / _CREDS_FILE}."
        )
    resp = httpx.post(
        _TOKEN_URL,
        data={"grant_type": "client_credentials", "scope": "product.compact"},
        auth=creds,
        timeout=30,
    )
    if resp.status_code != httpx.codes.OK:
        raise KrogerError(f"Kroger auth failed (HTTP {resp.status_code}).")
    body = resp.json()
    cache.write_text(
        json.dumps(
            {
                "access_token": body["access_token"],
                "expires_at": now + body.get("expires_in", 1800),
            }
        ),
        encoding="utf-8",
    )
    cache.chmod(0o600)
    return body["access_token"]


def _get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    resp = httpx.get(
        f"{_API}{path}",
        params=params,
        headers={
            "Authorization": f"Bearer {_get_token()}",
            "Accept": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def find_locations(
    zip_code: str, *, chain: str = "", limit: int = 5
) -> list[dict[str, Any]]:
    """Find Kroger-family stores near a ZIP (optionally filtered to one chain)."""
    params: dict[str, Any] = {"filter.zipCode.near": zip_code, "filter.limit": limit}
    if chain:
        params["filter.chain"] = chain
    return parse_locations(_get("/locations", params))


def search_prices(
    term: str, location_id: str, *, limit: int = 10
) -> list[dict[str, Any]]:
    """Return product price candidates for ``term`` at a given store."""
    return parse_products(
        _get(
            "/products",
            {
                "filter.term": term,
                "filter.locationId": location_id,
                "filter.limit": limit,
            },
        )
    )

"""Tests for the Kroger parsers, credentials, and (mocked) HTTP wrappers."""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from provender import kroger


def test_parse_products_extracts_price_fields():
    payload = {
        "data": [
            {
                "description": "Kroger® 80/20 Ground Beef Tray 1 LB",
                "brand": "Kroger",
                "items": [{"size": "1 lb", "price": {"regular": 8.49, "promo": 7.99}}],
            }
        ]
    }
    assert kroger.parse_products(payload) == [
        {
            "description": "Kroger® 80/20 Ground Beef Tray 1 LB",
            "brand": "Kroger",
            "size": "1 lb",
            "regular": 8.49,
            "promo": 7.99,
        }
    ]


def test_parse_products_handles_missing_items_and_price():
    out = kroger.parse_products(
        {"data": [{"description": "X", "brand": "Y", "items": []}]}
    )
    assert out[0]["regular"] is None and out[0]["promo"] is None


def test_parse_locations_builds_address():
    payload = {
        "data": [
            {
                "locationId": "61500066",
                "name": "Dillons - Tallgrass",
                "chain": "DILLONS",
                "address": {
                    "addressLine1": "2244 N Rock Rd",
                    "city": "Wichita",
                    "state": "KS",
                },
            }
        ]
    }
    out = kroger.parse_locations(payload)
    assert out[0]["location_id"] == "61500066"
    assert out[0]["address"] == "2244 N Rock Rd, Wichita, KS"


def test_representative_prefers_store_brand_nonorganic_then_lowest():
    candidates = [
        {
            "description": "Organic grass-fed",
            "brand": "Simple Truth Organic",
            "regular": 25,
        },
        {"description": "Kroger 80/20 Tray 1 LB", "brand": "Kroger", "regular": 8.49},
        {"description": "Name-brand beef", "brand": "Acme", "regular": 7.0},
    ]
    best = kroger.representative_price(candidates)
    assert best is not None
    assert best["brand"] == "Kroger"  # store-brand
    assert best["regular"] == 8.49  # non-organic, lowest store-brand


def test_representative_none_when_nothing_priced():
    assert kroger.representative_price([{"description": "x", "regular": None}]) is None


def test_representative_none_when_empty():
    assert kroger.representative_price([]) is None


def test_credentials_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(kroger, "config_dir", lambda: tmp_path)
    (tmp_path / "kroger.json").write_text(
        json.dumps({"client_id": "a", "client_secret": "b"})
    )
    assert kroger.credentials() == ("a", "b")
    assert kroger.is_configured() is True


def test_credentials_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(kroger, "config_dir", lambda: tmp_path)
    assert kroger.credentials() is None
    assert kroger.is_configured() is False


# ---- HTTP wrappers (mocked; no network) ----


def _with_creds(tmp_path, monkeypatch):
    """Point config_dir at tmp_path and drop a valid creds file there."""
    monkeypatch.setattr(kroger, "config_dir", lambda: tmp_path)
    (tmp_path / "kroger.json").write_text(
        json.dumps({"client_id": "cid", "client_secret": "sec"})
    )


@patch("provender.kroger.time.time", return_value=1000.0)
def test_get_token_returns_unexpired_cache_without_calling_api(
    _time, tmp_path, monkeypatch
):
    monkeypatch.setattr(kroger, "config_dir", lambda: tmp_path)
    (tmp_path / "kroger_token.json").write_text(
        json.dumps({"access_token": "cached", "expires_at": 5000})
    )
    with patch("provender.kroger.httpx.post") as mock_post:
        assert kroger._get_token() == "cached"
    mock_post.assert_not_called()


@patch("provender.kroger.time.time", return_value=1000.0)
def test_get_token_refreshes_when_cache_expired_and_rewrites_cache(
    _time, tmp_path, monkeypatch
):
    _with_creds(tmp_path, monkeypatch)
    # expires_at == now (1000) is not > now + 30, so the cache is stale.
    (tmp_path / "kroger_token.json").write_text(
        json.dumps({"access_token": "old", "expires_at": 1000})
    )
    resp = MagicMock(status_code=httpx.codes.OK)
    resp.json.return_value = {"access_token": "fresh", "expires_in": 1800}
    with patch("provender.kroger.httpx.post", return_value=resp) as mock_post:
        assert kroger._get_token() == "fresh"
    mock_post.assert_called_once()
    assert mock_post.call_args.kwargs["auth"] == ("cid", "sec")
    cached = json.loads((tmp_path / "kroger_token.json").read_text())
    assert cached == {"access_token": "fresh", "expires_at": 1000.0 + 1800}


def test_get_token_raises_when_not_configured(tmp_path, monkeypatch):
    monkeypatch.setattr(kroger, "config_dir", lambda: tmp_path)  # no creds file
    with pytest.raises(kroger.KrogerError, match="not configured"):
        kroger._get_token()


@patch("provender.kroger.time.time", return_value=1000.0)
def test_get_token_raises_on_auth_failure(_time, tmp_path, monkeypatch):
    _with_creds(tmp_path, monkeypatch)
    resp = MagicMock(status_code=httpx.codes.UNAUTHORIZED)
    with (
        patch("provender.kroger.httpx.post", return_value=resp),
        pytest.raises(kroger.KrogerError, match="auth failed"),
    ):
        kroger._get_token()


@patch("provender.kroger.httpx.get")
@patch("provender.kroger._get_token", return_value="tok")
def test_get_sends_bearer_token_and_returns_json(_token, mock_get):
    resp = MagicMock()
    resp.json.return_value = {"data": []}
    mock_get.return_value = resp
    out = kroger._get("/locations", {"filter.limit": 5})
    assert out == {"data": []}
    assert mock_get.call_args.args[0] == "https://api.kroger.com/v1/locations"
    kwargs = mock_get.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["params"] == {"filter.limit": 5}
    resp.raise_for_status.assert_called_once()


@patch("provender.kroger._get")
def test_find_locations_wires_params_and_parses(mock_get):
    mock_get.return_value = {
        "data": [
            {
                "locationId": "1",
                "name": "Dillons",
                "chain": "DILLONS",
                "address": {"addressLine1": "1 Main", "city": "Wichita", "state": "KS"},
            }
        ]
    }
    out = kroger.find_locations("67206", chain="DILLONS", limit=3)
    assert out[0]["location_id"] == "1"
    path, params = mock_get.call_args.args
    assert path == "/locations"
    assert params["filter.zipCode.near"] == "67206"
    assert params["filter.limit"] == 3
    assert params["filter.chain"] == "DILLONS"


@patch("provender.kroger._get")
def test_find_locations_omits_chain_filter_when_blank(mock_get):
    mock_get.return_value = {"data": []}
    kroger.find_locations("67206")
    _, params = mock_get.call_args.args
    assert "filter.chain" not in params


@patch("provender.kroger._get")
def test_search_prices_wires_params_and_parses(mock_get):
    mock_get.return_value = {
        "data": [
            {
                "description": "Beef",
                "brand": "Kroger",
                "items": [{"size": "1 lb", "price": {"regular": 8.49, "promo": 0}}],
            }
        ]
    }
    out = kroger.search_prices("ground beef", "61500066", limit=5)
    assert out[0]["regular"] == 8.49
    path, params = mock_get.call_args.args
    assert path == "/products"
    assert params["filter.term"] == "ground beef"
    assert params["filter.locationId"] == "61500066"
    assert params["filter.limit"] == 5

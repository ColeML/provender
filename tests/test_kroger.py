"""Tests for the Kroger parsers and credential loading (no network)."""

import json

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

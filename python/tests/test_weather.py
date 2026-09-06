"""Tests for weather geocoding/forecast with mocked Open-Meteo calls."""

from unittest.mock import MagicMock, patch

import pytest

from provender.weather import _matches_hint, forecast, geocode


def test_matches_hint_handles_state_abbrev_and_country():
    result = {"admin1": "Oklahoma", "country": "United States", "country_code": "US"}
    assert _matches_hint(result, "OK") is True  # via US state-abbrev map
    assert _matches_hint(result, "Oklahoma") is True
    assert _matches_hint(result, "US") is True
    assert _matches_hint(result, "Texas") is False


@patch("provender.weather.httpx.get")
def test_geocode_resolves_and_disambiguates_by_hint(mock_get):
    response = MagicMock()
    response.json.return_value = {
        "results": [
            {
                "name": "Edmond",
                "latitude": 35.65,
                "longitude": -97.48,
                "admin1": "Oklahoma",
                "country_code": "US",
            }
        ]
    }
    mock_get.return_value = response
    lat, lon, name = geocode("Edmond, OK")
    assert (lat, lon) == (35.65, -97.48)
    assert "Edmond" in name and "Oklahoma" in name


@patch("provender.weather.httpx.get")
def test_geocode_raises_when_no_results(mock_get):
    response = MagicMock()
    response.json.return_value = {"results": []}
    mock_get.return_value = response
    with pytest.raises(ValueError):
        geocode("Nowhereville")


@patch("provender.weather.geocode")
@patch("provender.weather.httpx.get")
def test_forecast_maps_weather_codes(mock_get, mock_geocode):
    mock_geocode.return_value = (35.65, -97.48, "Edmond, OK")
    response = MagicMock()
    response.json.return_value = {
        "daily": {
            "time": ["2026-06-13", "2026-06-14"],
            "temperature_2m_max": [97.1, 85.2],
            "temperature_2m_min": [70.9, 67.9],
            "precipitation_probability_max": [30, 44],
            "weather_code": [95, 53],
        }
    }
    mock_get.return_value = response
    days = forecast("Edmond, OK", days=2)
    assert len(days) == 2
    assert days[0].high == 97.1
    assert days[0].conditions == "thunderstorm"
    assert days[1].conditions == "drizzle"

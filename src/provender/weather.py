"""Weather and geocoding via the free Open-Meteo API (no API key required).

Provides a 7-day daily forecast that the ``plan-week`` skill uses to bias the
menu (cold/rainy -> comfort food and soups; hot -> grilling, salads, no oven).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather interpretation codes, condensed to plain-language buckets.
_WMO_CODES: dict[int, str] = {
    0: "clear",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "rain showers",
    81: "rain showers",
    82: "violent rain showers",
    85: "snow showers",
    86: "snow showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "thunderstorm with hail",
}


@dataclass(slots=True)
class DayForecast:
    """A single day's forecast.

    Attributes:
        date: ISO date string (``YYYY-MM-DD``).
        high: Daily maximum temperature.
        low: Daily minimum temperature.
        precip_chance: Maximum precipitation probability (percent), if available.
        conditions: Plain-language summary derived from the WMO weather code.
    """

    date: str
    high: float | None
    low: float | None
    precip_chance: int | None
    conditions: str


# US state abbreviation -> full name, so "Edmond, OK" disambiguates correctly.
# Open-Meteo's geocoder matches on city name only and returns the state in
# ``admin1`` spelled out in full.
_US_STATES: dict[str, str] = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
}


def _matches_hint(result: dict, hint: str) -> bool:
    """Return whether a geocoder result matches a state/country hint."""
    hint = hint.strip()
    candidates = {
        str(result.get("admin1", "")).lower(),
        str(result.get("country", "")).lower(),
        str(result.get("country_code", "")).lower(),
    }
    wanted = {hint.lower(), _US_STATES.get(hint.upper(), "").lower()}
    wanted.discard("")
    return any(c and any(w in c for w in wanted) for c in candidates)


def geocode(location: str, *, timeout: float = 15.0) -> tuple[float, float, str]:
    """Resolve a free-text location to coordinates.

    Accepts ``"City"`` or ``"City, ST"`` / ``"City, Country"``. The geocoder is
    queried with the city alone; any trailing comma-separated parts are used to
    pick the best match from the candidates.

    Args:
        location: A place name such as ``"Edmond, OK"``.
        timeout: HTTP timeout in seconds.

    Returns:
        A ``(latitude, longitude, resolved_name)`` tuple.

    Raises:
        ValueError: If the location cannot be resolved.
        httpx.HTTPError: On network failure.
    """
    parts = [p.strip() for p in location.split(",") if p.strip()]
    city = parts[0] if parts else location
    hints = parts[1:]

    response = httpx.get(
        _GEOCODE_URL,
        params={"name": city, "count": 10, "format": "json"},
        timeout=timeout,
    )
    response.raise_for_status()
    results = response.json().get("results")
    if not results:
        raise ValueError(f"Could not geocode location: {location!r}")

    top = results[0]
    for hint in hints:
        match = next((r for r in results if _matches_hint(r, hint)), None)
        if match:
            top = match
            break

    name_parts = [top.get("name"), top.get("admin1"), top.get("country_code")]
    resolved = ", ".join(part for part in name_parts if part)
    return top["latitude"], top["longitude"], resolved


def forecast(
    location: str,
    *,
    days: int = 7,
    fahrenheit: bool = True,
    timeout: float = 15.0,
) -> list[DayForecast]:
    """Return a daily forecast for ``location``.

    Args:
        location: Free-text place name (geocoded via Open-Meteo).
        days: Number of forecast days (1-16).
        fahrenheit: Use Fahrenheit if ``True``, else Celsius.
        timeout: HTTP timeout in seconds.

    Returns:
        A list of :class:`DayForecast`, one per day.
    """
    lat, lon, _ = geocode(location, timeout=timeout)
    response = httpx.get(
        _FORECAST_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "daily": (
                "temperature_2m_max,temperature_2m_min,"
                "precipitation_probability_max,weather_code"
            ),
            "timezone": "auto",
            "forecast_days": days,
            "temperature_unit": "fahrenheit" if fahrenheit else "celsius",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    daily = response.json()["daily"]

    out: list[DayForecast] = []
    for i, date in enumerate(daily["time"]):
        code = daily["weather_code"][i]
        out.append(
            DayForecast(
                date=date,
                high=daily["temperature_2m_max"][i],
                low=daily["temperature_2m_min"][i],
                precip_chance=daily["precipitation_probability_max"][i],
                conditions=_WMO_CODES.get(code, "unknown"),
            )
        )
    return out

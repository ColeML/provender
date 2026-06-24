"""Recipe scraping built on :mod:`recipe_scrapers`.

Fetches a recipe page and extracts a :class:`~provender.models.Recipe`. Sites
explicitly supported by ``recipe-scrapers`` parse cleanly; unknown sites fall
back to ``wild_mode`` which reads schema.org/Recipe JSON-LD when present.

Ingredient *parsing* (splitting "2 cloves garlic, minced" into qty/unit/name) is
deliberately left to Claude in the calling skill — the raw ingredient strings are
returned untouched so no fragile regex guessing happens here.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
from recipe_scrapers import scrape_html

from provender.models import Ingredient, Recipe

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _first_int(text: object) -> int | None:
    """Return the first integer found in ``text``, or ``None``."""
    if not text:
        return None
    match = re.search(r"\d+", str(text))
    return int(match.group()) if match else None


def _try(method: Any) -> Any:
    """Call a scraper accessor, swallowing the errors unsupported sites raise."""
    try:
        return method()
    except Exception:  # recipe-scrapers raises many ad-hoc errors; treat all as missing
        return None


def scrape(url: str, *, timeout: float = 20.0) -> Recipe:
    """Scrape a recipe from ``url``.

    Args:
        url: Page URL to fetch and parse.
        timeout: HTTP timeout in seconds.

    Returns:
        A populated :class:`Recipe`. Ingredient strings are stored verbatim in
        the ``notes`` field of placeholder :class:`Ingredient` entries with the
        ``name`` left empty for the caller (Claude) to parse.

    Raises:
        httpx.HTTPError: If the page cannot be fetched.
    """
    response = httpx.get(
        url,
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT},
    )
    response.raise_for_status()

    scraper = scrape_html(response.text, org_url=url, wild_mode=True)

    raw_ingredients = _try(scraper.ingredients) or []
    ingredients = [Ingredient(name="", notes=str(line)) for line in raw_ingredients]

    instructions_list = _try(scraper.instructions_list)
    if not instructions_list:
        joined = _try(scraper.instructions)
        instructions_list = str(joined).split("\n") if joined else []
    instructions = [step.strip() for step in instructions_list if step and step.strip()]

    return Recipe(
        title=str(_try(scraper.title) or "").strip(),
        source_url=url,
        image_url=str(_try(scraper.image) or "").strip(),
        base_servings=_first_int(_try(scraper.yields)),
        ingredients=ingredients,
        instructions=instructions,
        prep_min=_first_int(_try(getattr(scraper, "prep_time", lambda: None))),
        cook_min=_first_int(_try(getattr(scraper, "cook_time", lambda: None))),
        total_min=_first_int(_try(scraper.total_time)),
    )

"""Tests for recipe scraping with mocked network and scraper."""

from unittest.mock import MagicMock, patch

from provender.scrape import _first_int, _try, scrape


def test_first_int_extracts_leading_number():
    assert _first_int("4 servings") == 4
    assert _first_int("serves 4-6") == 4
    assert _first_int("no number") is None
    assert _first_int(None) is None


def test_try_returns_value_and_swallows_errors():
    assert _try(lambda: "ok") == "ok"

    def boom():
        raise ValueError("scraper blew up")

    assert _try(boom) is None


@patch("provender.scrape.scrape_html")
@patch("provender.scrape.httpx.get")
def test_scrape_builds_recipe_from_scraper(mock_get, mock_scrape_html):
    response = MagicMock()
    response.text = "<html></html>"
    mock_get.return_value = response

    scraper = MagicMock()
    scraper.title.return_value = "Pasta"
    scraper.image.return_value = "http://img/x.jpg"
    scraper.yields.return_value = "4 servings"
    scraper.ingredients.return_value = ["2 cups flour", "1 egg"]
    scraper.instructions_list.return_value = ["Mix", "Bake"]
    scraper.total_time.return_value = 35
    scraper.prep_time.return_value = "10 min"
    scraper.cook_time.return_value = "25 min"
    mock_scrape_html.return_value = scraper

    recipe = scrape("http://example.com/recipe")

    assert recipe.title == "Pasta"
    assert recipe.image_url == "http://img/x.jpg"
    assert recipe.base_servings == 4
    # ingredient lines are stored verbatim in notes, name left for the caller
    assert [i.notes for i in recipe.ingredients] == ["2 cups flour", "1 egg"]
    assert all(i.name == "" for i in recipe.ingredients)
    assert recipe.instructions == ["Mix", "Bake"]
    assert (recipe.prep_min, recipe.cook_min, recipe.total_min) == (10, 25, 35)
    response.raise_for_status.assert_called_once()

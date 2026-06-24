"""Tests for the recipe HTML renderer and the CLI page-writer helper."""

from provender import cli, render


def _sample():
    return {
        "title": "Chicken Tikka",
        "image_url": "https://ex.com/a.jpg",
        "source_url": "https://ex.com/recipe",
        "base_servings": 4,
        "total_min": 45,
        "rating": 5,
        "tags": "indian, instant-pot",
        "ingredients_text": "• 1½ lb chicken thighs\n• 2 cloves garlic — minced",
        "instructions": "1. Sear the chicken.\n\n2. Add sauce & simmer.",
    }


def test_render_includes_core_sections():
    out = render.render_recipe_html(_sample())
    assert "<h1>Chicken Tikka</h1>" in out
    assert "<li>1½ lb chicken thighs</li>" in out
    assert "<li>2 cloves garlic — minced</li>" in out
    assert "<li>Sear the chicken.</li>" in out
    assert "<li>Add sauce &amp; simmer.</li>" in out  # ampersand escaped
    assert 'src="https://ex.com/a.jpg"' in out
    assert "Serves 4" in out
    assert "45 min total" in out
    assert "Rated 5/5" in out
    assert '<span class="tag">indian</span>' in out
    assert "Original recipe" in out


def test_render_escapes_html_in_title():
    out = render.render_recipe_html(
        {"title": "Mac & <Cheese>", "ingredients_text": "", "instructions": ""}
    )
    assert "Mac &amp; &lt;Cheese&gt;" in out
    assert "<h1>Mac & <Cheese></h1>" not in out


def test_render_omits_optional_blocks_when_absent():
    out = render.render_recipe_html(
        {"title": "Plain", "ingredients_text": "", "instructions": ""}
    )
    assert "<img" not in out  # no image
    assert "Original recipe" not in out  # no source link
    assert 'class="meta"' not in out  # no servings/time/rating line
    assert 'class="tags"' not in out  # no tag chips


def test_slug_normalizes_and_defaults():
    assert render.slug("Chicken Tikka!") == "chicken-tikka"
    assert render.slug("") == "recipe"


def test_parsing_strips_bullets_and_step_numbers():
    assert render._ingredient_items("• a\n• b\n") == ["a", "b"]
    assert render._step_items("1. first\n\n2. second") == ["first", "second"]


def test_recipe_doc_url_absolute_and_relative():
    assert (
        cli._recipe_doc_url("https://x.io/provender/", "beef-stew")
        == "https://x.io/provender/recipes/beef-stew.html"
    )
    assert cli._recipe_doc_url("", "beef-stew") == "recipes/beef-stew.html"


def test_write_recipe_page_overwrites_in_place(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "_RENDER_DIR", tmp_path)
    row = _sample()
    first = cli._write_recipe_page(row, "chicken-tikka")
    assert first == tmp_path / "chicken-tikka.html"
    assert "Chicken Tikka" in first.read_text(encoding="utf-8")

    row["title"] = "Chicken Tikka v2"
    second = cli._write_recipe_page(row, "chicken-tikka")
    assert second == first  # same path
    assert "Chicken Tikka v2" in second.read_text(encoding="utf-8")

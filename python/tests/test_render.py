"""Tests for the recipe HTML renderer and the CLI page-writer helper."""

import pytest
import typer

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


def test_write_recipe_page_overwrites_in_place(tmp_path):
    row = _sample()
    first = cli._write_recipe_page(row, "chicken-tikka", tmp_path)
    assert first == tmp_path / "chicken-tikka.html"
    assert "Chicken Tikka" in first.read_text(encoding="utf-8")

    row["title"] = "Chicken Tikka v2"
    second = cli._write_recipe_page(row, "chicken-tikka", tmp_path)
    assert second == first  # same path
    assert "Chicken Tikka v2" in second.read_text(encoding="utf-8")


def test_render_blocks_javascript_and_data_urls():
    out = render.render_recipe_html(
        {
            "title": "x",
            "source_url": "javascript:alert(1)",
            "image_url": "data:text/html,<script>alert(2)</script>",
            "ingredients_text": "",
            "instructions": "",
        }
    )
    assert "javascript:" not in out
    assert "data:text/html" not in out
    assert "Original recipe" not in out  # unsafe source link omitted
    assert "<img" not in out  # unsafe image omitted


def test_render_allows_https_urls():
    out = render.render_recipe_html(
        {
            "title": "x",
            "source_url": "https://ex.com/r",
            "image_url": "https://ex.com/i.jpg",
            "ingredients_text": "",
            "instructions": "",
        }
    )
    assert 'href="https://ex.com/r"' in out
    assert 'src="https://ex.com/i.jpg"' in out


def test_recipe_render_writes_target_page_and_persists_doc_url(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "_connect", object)
    site = tmp_path / "site"
    cfg = {
        "render_base_url": "https://x.io/provender",
        "render_dir": str(site / "recipes"),
    }
    monkeypatch.setattr(
        cli, "_config_value", lambda ss, key, default="": cfg.get(key, default)
    )
    rows = [
        {
            "recipe_id": "beef-stew",
            "title": "Beef Stew",
            "ingredients_text": "• 1 lb beef",
            "instructions": "1. Cook.",
        },
        {
            "recipe_id": "tacos",
            "title": "Tacos",
            "ingredients_text": "• tortillas",
            "instructions": "1. Assemble.",
        },
    ]
    monkeypatch.setattr(cli.sheets_mod, "read_table", lambda ss, tab: rows)
    captured = {}
    monkeypatch.setattr(
        cli.sheets_mod,
        "replace_table",
        lambda ss, tab, headers, data: captured.update(data=data),
    )

    cli.recipe_render(recipe_id="beef-stew", all_recipes=False)

    # only the target recipe's page is written; the index lists the full library
    assert (site / "recipes" / "beef-stew.html").exists()
    assert not (site / "recipes" / "tacos.html").exists()
    index = (site / "index.html").read_text(encoding="utf-8")
    assert "Beef Stew" in index and "Tacos" in index
    assert rows[0]["doc_url"] == "https://x.io/provender/recipes/beef-stew.html"

    # doc_url is persisted for the target, left blank for the untouched recipe
    schema = cli.sheets_mod.SCHEMA["Recipes"]
    rid, doc = schema.index("recipe_id"), schema.index("doc_url")
    written = {r[rid]: r[doc] for r in captured["data"]}
    assert written["beef-stew"] == "https://x.io/provender/recipes/beef-stew.html"
    assert written["tacos"] == ""


def test_recipe_render_rejects_both_flags():
    with pytest.raises(typer.Exit):
        cli.recipe_render(recipe_id="x", all_recipes=True)


def test_render_index_lists_links_sorted_and_skips_blank():
    out = render.render_index_html(
        [
            {"recipe_id": "tacos", "title": "Tacos"},
            {"recipe_id": "beef-stew", "title": "Beef Stew"},
            {"recipe_id": "", "title": "skip me"},
        ]
    )
    assert '<a href="recipes/beef-stew.html">Beef Stew</a>' in out
    assert '<a href="recipes/tacos.html">Tacos</a>' in out
    assert "skip me" not in out  # blank recipe_id skipped
    assert out.index("Beef Stew") < out.index("Tacos")  # sorted by title

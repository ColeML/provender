"""Render a recipe to a self-contained, shareable HTML page.

The page is a **derived view** of a ``Recipes`` row — regenerated and overwritten
on every render. The Google Sheet stays the single source of truth; nothing here
writes recipe content back. The output is one file per recipe with inline CSS, so
it is portable: open it on a phone, share the link, or print it.
"""

from __future__ import annotations

import html
import re
from typing import Any

_CSS = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  font: 17px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  max-width: 46rem; margin: 0 auto; padding: 1.5rem; color: #1a1a1a;
}
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #161616; } }
h1 { font-size: 1.9rem; margin: 0 0 .3rem; }
img.hero { width: 100%; border-radius: 12px; margin: 1rem 0; }
.meta { color: #666; font-size: .95rem; margin: 0 0 1rem; }
.tags { margin: .5rem 0 1.5rem; }
.tag {
  display: inline-block; background: #eee; color: #444; border-radius: 999px;
  padding: .15rem .6rem; font-size: .8rem; margin: 0 .3rem .3rem 0;
}
@media (prefers-color-scheme: dark) { .tag { background: #2a2a2a; color: #ccc; } }
h2 { font-size: 1.2rem; margin: 1.8rem 0 .6rem; border-bottom: 1px solid #ddd;
     padding-bottom: .3rem; }
ul.ingredients { padding-left: 1.2rem; }
ol.steps li { margin: 0 0 .9rem; }
a.source { color: #b5651d; }
@media print { body { max-width: none; } .source { display: none; } }
"""


def slug(recipe_id: str) -> str:
    """Return a filesystem-safe slug for ``recipe_id`` (lowercase, hyphenated)."""
    cleaned = "".join(c if c.isalnum() else "-" for c in str(recipe_id).lower())
    return "-".join(part for part in cleaned.split("-") if part) or "recipe"


def _ingredient_items(ingredients_text: str) -> list[str]:
    """Split a stored bulleted ``ingredients_text`` block back into lines."""
    return [
        line.lstrip("•").strip()
        for line in str(ingredients_text).splitlines()
        if line.strip()
    ]


def _step_items(instructions: str) -> list[str]:
    """Split a stored numbered ``instructions`` block back into steps."""
    chunks = re.split(r"\n\s*\n", str(instructions).strip())
    return [
        re.sub(r"^\s*\d+[.)]\s*", "", chunk.strip())
        for chunk in chunks
        if chunk.strip()
    ]


def _meta_line(recipe: dict[str, Any]) -> str:
    """Build the servings / time / rating summary line."""
    parts: list[str] = []
    if recipe.get("base_servings") not in (None, ""):
        parts.append(f"Serves {html.escape(str(recipe['base_servings']))}")
    if recipe.get("total_min") not in (None, ""):
        parts.append(f"{html.escape(str(recipe['total_min']))} min total")
    if recipe.get("rating") not in (None, ""):
        parts.append(f"Rated {html.escape(str(recipe['rating']))}/5")
    return " · ".join(parts)


def render_recipe_html(recipe: dict[str, Any]) -> str:
    """Render a ``Recipes`` row dict into a complete HTML document string.

    Args:
        recipe: A Recipes row (title, image_url, source_url, base_servings,
            total_min, tags, rating, ingredients_text, instructions, ...).

    Returns:
        A self-contained HTML page as a string.
    """
    title = html.escape(str(recipe.get("title") or "Recipe"))

    image = ""
    if recipe.get("image_url"):
        image = (
            f'<img class="hero" src="{html.escape(str(recipe["image_url"]))}" alt="">'
        )

    meta = _meta_line(recipe)
    meta_html = f'<p class="meta">{meta}</p>' if meta else ""

    tags = [t.strip() for t in str(recipe.get("tags") or "").split(",") if t.strip()]
    tags_html = ""
    if tags:
        chips = "".join(f'<span class="tag">{html.escape(t)}</span>' for t in tags)
        tags_html = f'<div class="tags">{chips}</div>'

    ingredients = "".join(
        f"<li>{html.escape(item)}</li>"
        for item in _ingredient_items(recipe.get("ingredients_text", ""))
    )
    steps = "".join(
        f"<li>{html.escape(item)}</li>"
        for item in _step_items(recipe.get("instructions", ""))
    )

    source = ""
    if recipe.get("source_url"):
        url = html.escape(str(recipe["source_url"]))
        source = f'<p><a class="source" href="{url}">Original recipe ↗</a></p>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{_CSS}</style>
</head>
<body>
<h1>{title}</h1>
{meta_html}
{tags_html}
{image}
<h2>Ingredients</h2>
<ul class="ingredients">{ingredients}</ul>
<h2>Steps</h2>
<ol class="steps">{steps}</ol>
{source}
</body>
</html>
"""

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  durationToMinutes,
  extractRecipe,
  NoRecipeFoundError,
  PageUnavailableError,
  parseInstructions,
  parseYield,
  scrapeRecipe,
  toScrapedRecipe,
  yieldText,
} from "./scrape";

function page(jsonLd: unknown, extra = "") {
  return `<!doctype html><html><head>${extra}
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    </head><body></body></html>`;
}

const RECIPE = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Chicken Fajitas",
  image: "https://example.test/fajitas.jpg",
  recipeYield: "8 servings",
  prepTime: "PT15M",
  cookTime: "PT25M",
  totalTime: "PT40M",
  recipeIngredient: ["2 lb chicken breast", "3 bell peppers"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Slice the peppers." },
    { "@type": "HowToStep", text: "Cook the chicken." },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("durationToMinutes", () => {
  it.each([
    ["PT25M", 25],
    ["PT1H", 60],
    ["PT1H30M", 90],
    ["PT2H15M", 135],
    ["P1D", 1440],
    ["P1DT2H", 1560],
    ["PT30M45S", 30],
  ])("reads %s as %i minutes", (value, expected) => {
    expect(durationToMinutes(value)).toBe(expected);
  });

  it.each(["", "PT0M", "45 minutes", null, undefined, {}])("reads %p as unknown", (value) => {
    expect(durationToMinutes(value)).toBeNull();
  });

  it("accepts a plain number, which some sites publish", () => {
    expect(durationToMinutes(40)).toBe(40);
  });
});

describe("parseYield", () => {
  it.each([
    [8, 8],
    ["8", 8],
    ["8 servings", 8],
    ["Serves 6", 6],
    [["4", "4 servings"], 4],
  ])("reads %p as %i", (value, expected) => {
    expect(parseYield(value)).toBe(expected);
  });

  it.each(["a dozen", "", null, undefined])("reads %p as unknown", (value) => {
    expect(parseYield(value)).toBeNull();
  });

  it("keeps the descriptive half of a yield array, not the bare number", () => {
    // What King Arthur Baking actually publishes, checked live.
    expect(yieldText(["10", 'about 10 large (8") waffles'])).toBe('about 10 large (8") waffles');
    expect(parseYield(["10", 'about 10 large (8") waffles'])).toBe(10);
  });

  it("keeps the servings wording when both entries are plain", () => {
    // budgetbytes.com, checked live.
    expect(yieldText(["4", "4 (2 fajitas each)"])).toBe("4 (2 fajitas each)");
    expect(parseYield(["4", "4 (2 fajitas each)"])).toBe(4);
  });

  it("takes the number out of a yield that is not servings, and keeps the words", () => {
    // "1 loaf" parses to 1, which would be a disaster to scale from without the text beside it.
    expect(parseYield("1 loaf")).toBe(1);
    expect(yieldText("1 loaf")).toBe("1 loaf");
  });
});

describe("parseInstructions", () => {
  it("reads an array of HowToStep objects", () => {
    expect(parseInstructions(RECIPE.recipeInstructions)).toEqual([
      "Slice the peppers.",
      "Cook the chicken.",
    ]);
  });

  it("reads an array of plain strings", () => {
    expect(parseInstructions(["One.", "Two."])).toEqual(["One.", "Two."]);
  });

  it("splits a single blob on its lines", () => {
    expect(parseInstructions("One.\n\nTwo.\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("keeps a one-line blob whole", () => {
    expect(parseInstructions("Just mix it.")).toEqual(["Just mix it."]);
  });

  it("descends into HowToSections rather than losing their steps", () => {
    expect(
      parseInstructions([
        {
          "@type": "HowToSection",
          name: "For the sauce",
          itemListElement: [
            { "@type": "HowToStep", text: "Whisk." },
            { "@type": "HowToStep", text: "Simmer." },
          ],
        },
        { "@type": "HowToStep", text: "Serve." },
      ]),
    ).toEqual(["Whisk.", "Simmer.", "Serve."]);
  });

  it("falls back to a step's name when it has no text", () => {
    expect(parseInstructions([{ "@type": "HowToStep", name: "Preheat." }])).toEqual(["Preheat."]);
  });

  it.each([null, undefined, 42, {}])("reads %p as no steps", (value) => {
    expect(parseInstructions(value)).toEqual([]);
  });
});

describe("extractRecipe", () => {
  it("finds a bare Recipe node", () => {
    expect(extractRecipe(page(RECIPE))?.name).toBe("Chicken Fajitas");
  });

  it("finds one inside @graph, which is how most WordPress sites publish", () => {
    const html = page({
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebSite", name: "A blog" }, RECIPE],
    });

    expect(extractRecipe(html)?.name).toBe("Chicken Fajitas");
  });

  it("finds one in a top-level array", () => {
    expect(extractRecipe(page([{ "@type": "Person" }, RECIPE]))?.name).toBe("Chicken Fajitas");
  });

  it("handles @type given as an array", () => {
    const html = page({ ...RECIPE, "@type": ["Recipe", "NewsArticle"] });

    expect(extractRecipe(html)?.name).toBe("Chicken Fajitas");
  });

  it("skips a malformed block and keeps reading the rest", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">${JSON.stringify(RECIPE)}</script>
      </head></html>`;

    expect(extractRecipe(html)?.name).toBe("Chicken Fajitas");
  });

  it("reads the escaped closing tag that valid pages emit", () => {
    // A bare `</script>` ends the element per the HTML spec, whatever the JSON quoting — a
    // browser does the same, which is why pages escape it. The escaped form must survive.
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      ...RECIPE,
      recipeIngredient: ["2 lb chicken", "a note about </script> tags"],
    }).replace(/<\//g, String.raw`<\/`)}</script></head></html>`;

    expect(extractRecipe(html)?.recipeIngredient).toHaveLength(2);
  });

  it("reads a block whose attributes are ordered or cased unusually", () => {
    const html = `<html><head><SCRIPT TYPE="application/ld+json" id="x">${JSON.stringify(
      RECIPE,
    )}</SCRIPT></head></html>`;

    expect(extractRecipe(html)?.name).toBe("Chicken Fajitas");
  });

  it("returns nothing for a page with no recipe", () => {
    expect(extractRecipe(page({ "@type": "WebSite", name: "A blog" }))).toBeUndefined();
    expect(extractRecipe("<html><body>no structured data</body></html>")).toBeUndefined();
  });
});

describe("toScrapedRecipe", () => {
  it("maps every field the API needs", () => {
    expect(toScrapedRecipe(RECIPE, "https://example.test/fajitas")).toEqual({
      title: "Chicken Fajitas",
      sourceUrl: "https://example.test/fajitas",
      imageUrl: "https://example.test/fajitas.jpg",
      baseServings: 8,
      yieldText: "8 servings",
      prepMin: 15,
      cookMin: 25,
      totalMin: 40,
      ingredients: [{ text: "2 lb chicken breast" }, { text: "3 bell peppers" }],
      instructions: ["Slice the peppers.", "Cook the chicken."],
    });
  });

  it("reads an image published as an ImageObject", () => {
    const scraped = toScrapedRecipe(
      { ...RECIPE, image: { "@type": "ImageObject", url: "https://example.test/o.jpg" } },
      "https://example.test/x",
    );

    expect(scraped.imageUrl).toBe("https://example.test/o.jpg");
  });

  it("keeps ingredient lines raw, since parsing them is judgment", () => {
    const scraped = toScrapedRecipe(
      { ...RECIPE, recipeIngredient: ["  2 cloves garlic, minced  ", "", "salt to taste"] },
      "https://example.test/x",
    );

    expect(scraped.ingredients).toEqual([
      { text: "2 cloves garlic, minced" },
      { text: "salt to taste" },
    ]);
  });
});

describe("scrapeRecipe", () => {
  function stubFetch(response: Partial<Response> & { text?: () => Promise<string> }) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, ...response }));
  }

  it("returns a draft, and sends a browser user-agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => page(RECIPE) });

    vi.stubGlobal("fetch", fetchMock);

    await expect(scrapeRecipe("https://example.test/fajitas")).resolves.toMatchObject({
      title: "Chicken Fajitas",
      baseServings: 8,
    });

    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toContain("Mozilla/5.0");
  });

  it("reports a page with no recipe as the caller's mistake", async () => {
    stubFetch({ text: async () => "<html><body>a blog post</body></html>" });

    await expect(scrapeRecipe("https://example.test/blog")).rejects.toBeInstanceOf(
      NoRecipeFoundError,
    );
  });

  it("refuses a Recipe node with no ingredients rather than returning an empty draft", async () => {
    stubFetch({ text: async () => page({ "@type": "Recipe", name: "Mystery" }) });

    await expect(scrapeRecipe("https://example.test/x")).rejects.toBeInstanceOf(NoRecipeFoundError);
  });

  it("reports a bot block as unavailable, not as a bad URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(scrapeRecipe("https://example.test/x")).rejects.toBeInstanceOf(
      PageUnavailableError,
    );
  });

  it("reports a network failure as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));

    await expect(scrapeRecipe("https://example.test/x")).rejects.toBeInstanceOf(
      PageUnavailableError,
    );
  });
});

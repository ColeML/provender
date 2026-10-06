import { expect, test } from "@playwright/test";

/** The wordmark's treatment is a decision DESIGN.md records, so it is worth a regression guard. */
test("sets the header wordmark in capitals, in the display face", async ({ page }) => {
  await page.goto("/recipes");

  const wordmark = page.getByRole("banner").getByText("Provender");

  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveCSS("text-transform", "uppercase");
  await expect(wordmark).toHaveCSS("font-family", /Charis/);
});

test("gives every header link a tap target of at least 44px", async ({ page }) => {
  await page.goto("/recipes");

  for (const name of ["Provender", "Plan", "Notes", "Shop", "Recipes", "Settings"]) {
    const box = await page.getByRole("banner").getByRole("link", { name }).boundingBox();

    expect.soft(box?.height, name).toBeGreaterThanOrEqual(44);
    expect.soft(box?.width, name).toBeGreaterThanOrEqual(44);
  }
});

test("leaves no dead space between the header tabs", async ({ page }) => {
  await page.goto("/recipes");

  const banner = page.getByRole("banner");
  const boxes = [];
  for (const name of ["Plan", "Notes", "Shop", "Recipes"]) {
    boxes.push(await banner.getByRole("link", { name }).boundingBox());
  }

  for (let i = 1; i < boxes.length; i++) {
    const previous = boxes[i - 1]!;
    expect(boxes[i]!.x - (previous.x + previous.width)).toBeLessThanOrEqual(1);
  }
});

test("draws an unplanned week as a blank page, not an error", async ({ page }) => {
  await page.goto("/plan");

  await expect(page.getByText("That week is not planned yet.")).toBeVisible();
  await expect(page.getByText(/Ask Claude Code to plan it/)).toBeVisible();
});

test("says there is nothing to buy when no week is planned", async ({ page }) => {
  await page.goto("/shop");

  await expect(page.getByText(/That week is not planned yet/)).toBeVisible();
});

/**
 * The bug an empty database surfaced: this read `Nothing matches ""` before.
 *
 * An empty library keeps saying so even with a query typed, which is deliberate — the library
 * being empty is the actionable fact, and "nothing matches" would imply a recipe might. The
 * no-match path needs a stocked library, so it is covered by the component test instead.
 */
test("tells an empty recipe library apart from a search that found nothing", async ({ page }) => {
  await page.goto("/recipes");

  await expect(page.getByText("No recipes saved yet.")).toBeVisible();
  await expect(page.getByText(/Nothing matches/)).toBeHidden();

  await page.getByRole("searchbox", { name: "Search recipes" }).fill("kimchi");

  await expect(page.getByText("No recipes saved yet.")).toBeVisible();
  await expect(page.getByText(/Nothing matches/)).toBeHidden();
});

import { expect, test } from "@playwright/test";

/**
 * Stepping between weeks, which is what lets a Sunday shopper buy for the week starting tomorrow.
 *
 * Runs against an empty database, so every week here is unplanned. That is the state the arrows
 * most need to survive: with no navigation on the empty page, the only way back is the URL bar.
 */
for (const path of ["/plan", "/shop"] as const) {
  test(`steps forward and back a week from ${path}`, async ({ page }) => {
    await page.goto(`${path}?week=2026-W39`);

    await expect(page.getByRole("link", { name: "Next week" })).toHaveAttribute(
      "href",
      `${path}?week=2026-W40`,
    );

    await page.getByRole("link", { name: "Next week" }).click();
    await expect(page).toHaveURL(`${path}?week=2026-W40`);

    await page.getByRole("link", { name: "Previous week" }).click();
    await expect(page).toHaveURL(`${path}?week=2026-W39`);
  });

  test(`returns to the current week from ${path}`, async ({ page }) => {
    await page.goto(`${path}?week=2026-W39`);

    await page.getByRole("link", { name: "This week" }).click();

    await expect(page).toHaveURL(path);
    await expect(page.getByRole("link", { name: "This week" })).toBeHidden();
  });

  test(`keeps the arrows on an unplanned week at ${path}`, async ({ page }) => {
    await page.goto(`${path}?week=2026-W44`);

    await expect(page.getByText(/not planned yet/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Previous week" })).toBeVisible();
  });

  // `?week=` is typed by hand often enough that a typo must not be a dead end.
  test(`falls back to the current week for a bad ?week= at ${path}`, async ({ page }) => {
    await page.goto(`${path}?week=not-a-week`);

    await expect(page.getByRole("link", { name: "Next week" })).toBeVisible();
    await expect(page.getByRole("link", { name: "This week" })).toBeHidden();
  });
}

/**
 * A week picked on one surface is the week meant on the other: you plan Thursday, then shop for
 * it. The header carries it, so the two never disagree.
 */
test("carries the selected week from the shopping list to the plan", async ({ page }) => {
  await page.goto("/shop?week=2026-W40");

  await page.getByRole("link", { name: "Plan" }).click();

  await expect(page).toHaveURL("/plan?week=2026-W40");
});

test("carries the selected week from the plan to the shopping list", async ({ page }) => {
  await page.goto("/plan?week=2026-W40");

  await page.getByRole("link", { name: "Shop" }).click();

  await expect(page).toHaveURL("/shop?week=2026-W40");
});

test("leaves the header bare on the default view", async ({ page }) => {
  await page.goto("/shop");

  await expect(page.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/plan");
});

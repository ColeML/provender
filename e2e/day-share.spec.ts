import { expect, test } from "@playwright/test";

/** A date no other test reads. A rerun finds the link this one made and shows it again. */
const FAR_DATE = "2031-03-04";

test("shares a day by a link that opens without a session", async ({ page, browser, baseURL }) => {
  await page.goto(`/plan/${FAR_DATE}`);
  await page.getByRole("button", { name: "Share this day" }).click();

  const create = page.getByRole("button", { name: "Create link" });

  if (await create.isVisible()) {
    await expect(page.getByText(/every meal, recipe and note/)).toBeVisible();
    await create.click();
  }

  const link = page.getByRole("textbox", { name: "Share link" });

  await expect(link).toHaveValue(/\/d\/[A-Za-z0-9_-]{43}$/);

  const url = await link.inputValue();
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await stranger.newPage();

  await visitor.goto(url);

  await expect(visitor).toHaveURL(url);
  await expect(visitor.getByRole("heading", { level: 1, name: "Tuesday" })).toBeVisible();
  await expect(visitor.getByText("Nothing planned")).toBeVisible();
  await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const unknown = await visitor.goto(`${baseURL}/d/not-a-real-token`);

  expect(unknown?.status()).toBe(404);

  await stranger.close();
});

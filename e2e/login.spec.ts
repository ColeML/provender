import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("gives the password field and the Sign in button a tap target of at least 44px", async ({
  page,
}) => {
  await page.goto("/login");

  for (const control of [
    page.getByLabel("Password"),
    page.getByRole("button", { name: "Sign in" }),
  ]) {
    const box = await control.boundingBox();

    expect.soft(box?.height).toBeGreaterThanOrEqual(44);
  }
});

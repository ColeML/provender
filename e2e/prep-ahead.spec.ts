import { readFileSync } from "node:fs";

import { expect, type APIRequestContext, test } from "@playwright/test";

/**
 * A slug no other test reads, deleted again at the end. It runs in the `phone-seeded` project,
 * after the rest, because the empty-library test fails while this recipe exists.
 */
const RECIPE = "e2e-prep-ahead";

/**
 * The bearer token for /v1, found where `next dev` finds it: the process environment, which dotenv
 * never overwrites, then `.env.local`, then `.env`.
 */
function apiToken() {
  if (process.env.PROVENDER_API_TOKEN) {
    return process.env.PROVENDER_API_TOKEN;
  }

  for (const file of [".env.local", ".env"]) {
    try {
      const token = /^PROVENDER_API_TOKEN=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();

      if (token) {
        return token;
      }
    } catch {
      // Missing file: try the next one.
    }
  }

  throw new Error("PROVENDER_API_TOKEN is empty. Set it in .env.local");
}

function v1(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${apiToken()}` };

  return {
    create: () =>
      request.post(`/v1/recipes?recipeId=${RECIPE}`, {
        headers,
        data: {
          title: "E2E Fajitas",
          baseServings: 4,
          instructions: ["Marinate the chicken overnight.", "Sear it."],
        },
      }),
    share: () => request.post(`/v1/recipes/${RECIPE}/shares`, { headers, data: {} }),
    remove: () => request.delete(`/v1/recipes/${RECIPE}`, { headers }),
  };
}

test.beforeEach(async ({ request }) => {
  await v1(request).remove();
  expect((await v1(request).create()).ok()).toBe(true);
});

test.afterEach(async ({ request }) => {
  await v1(request).remove();
});

test("adds, edits and removes a prep-ahead task, and shows it read-only on the share", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  await page.goto(`/recipes/${RECIPE}`);

  // No tasks: an add control and no empty heading.
  await expect(page.getByRole("heading", { name: "Prep ahead" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add prep ahead" }).click();
  await page.getByRole("textbox", { name: "New task" }).fill("Marinate the chicken.");
  await page.getByRole("button", { name: "Save" }).click();

  const list = page.getByRole("list", { name: "Prep ahead" });

  await expect(list.getByRole("listitem")).toHaveText(["Marinate the chicken."]);

  await list.getByRole("button", { name: "Marinate the chicken.", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Edit task" }).fill("Marinate the chicken overnight.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(list.getByRole("listitem")).toHaveText(["Marinate the chicken overnight."]);

  // Survives a reload: it is stored, not just drawn.
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveText(["Marinate the chicken overnight."]);

  const share = (await (await v1(request).share()).json()) as { token: string };
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await stranger.newPage();

  await visitor.goto(`${baseURL}/r/${share.token}`);
  await expect(visitor.getByRole("list", { name: "Prep ahead" }).getByRole("listitem")).toHaveText([
    "Marinate the chicken overnight.",
  ]);
  await expect(visitor.getByRole("main").getByRole("button")).toHaveCount(0);
  await stranger.close();

  await page.getByRole("button", { name: "Remove task: Marinate the chicken overnight." }).click();
  await expect(page.getByRole("heading", { name: "Prep ahead" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add prep ahead" })).toBeFocused();
});

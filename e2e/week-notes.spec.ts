import { expect, test } from "@playwright/test";

/**
 * Notes are written for a week far from today, so a rerun against the same database adds rows to
 * a week no other test reads. The body is unique per run so each assertion finds its own note.
 */
const FAR_WEEK = "2031-W10";

test("adds a note for any day and one for a day, grouped in that order", async ({ page }) => {
  const run = Date.now();

  await page.goto(`/notes?week=${FAR_WEEK}`);

  const note = page.getByRole("textbox", { name: "Note" });

  await page.getByRole("combobox", { name: "Day" }).selectOption({ label: "Thu 6" });
  await note.fill(`Soccer until 7 ${run}`);
  await note.press("Enter");
  await expect(page.getByText(`Soccer until 7 ${run}`)).toBeVisible();

  await note.fill(`Mom asked for pot roast ${run}`);
  await note.press("Enter");
  await expect(page.getByText(`Mom asked for pot roast ${run}`)).toBeVisible();

  const headings = page.getByRole("main").getByRole("heading", { level: 2 });

  await expect(headings.first()).toHaveText("Any day");
  await expect(
    page.getByRole("region", { name: "Thursday, Mar 6" }).getByText(`Soccer until 7 ${run}`),
  ).toBeVisible();
});

test("opens on next week and leaves ?week= off the Notes tab", async ({ page }) => {
  await page.goto("/plan?week=2026-W40");

  await expect(page.getByRole("link", { name: "Notes" })).toHaveAttribute("href", "/notes");

  await page.getByRole("link", { name: "Notes" }).click();

  await expect(page).toHaveURL("/notes");
  await expect(page.getByText("Next week", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to next week" })).toBeHidden();
});

test("steps to another week and back to next week", async ({ page }) => {
  await page.goto("/notes");

  await page.getByRole("link", { name: "Previous week" }).click();
  await expect(page).toHaveURL(/\/notes\?week=\d{4}-W\d{2}$/);

  await page.getByRole("link", { name: "Back to next week" }).click();
  await expect(page).toHaveURL("/notes");
});

test("edits a note in place, keeps its text on a blank edit, and deletes it", async ({ page }) => {
  const run = Date.now();
  const add = page.getByRole("textbox", { name: "Note" });

  await page.goto(`/notes?week=${FAR_WEEK}`);
  await add.fill(`Socer ${run}`);
  await add.press("Enter");
  await page.getByRole("button", { name: `Edit note: Socer ${run}` }).click();

  const editor = page.getByRole("form", { name: "Edit note" });

  await editor.getByRole("textbox", { name: "Note" }).fill(`Soccer ${run}`);
  await editor.getByRole("combobox", { name: "Day" }).selectOption({ label: "Thu 6" });
  await editor.getByRole("textbox", { name: "Note" }).press("Enter");

  const thursday = page.getByRole("region", { name: "Thursday, Mar 6" });

  // The note moved to Thursday, so it remounted there; focus follows it rather than the page.
  await expect(thursday.getByRole("button", { name: `Edit note: Soccer ${run}` })).toBeFocused();

  await page.reload();
  await thursday.getByRole("button", { name: `Edit note: Soccer ${run}` }).click();
  await editor.getByRole("textbox", { name: "Note" }).fill("");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(editor).toBeHidden();

  await page.reload();
  await thursday.getByRole("button", { name: `Edit note: Soccer ${run}` }).click();
  await editor.getByRole("textbox", { name: "Note" }).fill(`Canceled ${run}`);
  await editor.getByRole("textbox", { name: "Note" }).press("Escape");
  await expect(thursday.getByRole("button", { name: `Edit note: Soccer ${run}` })).toBeFocused();

  await thursday.getByRole("button", { name: `Delete note: Soccer ${run}` }).click();
  await expect(page.getByText(`Soccer ${run}`)).toBeHidden();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(`Soccer ${run}`)).toBeHidden();
});

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a local dev server, signed in without the login form.
 *
 * Preconditions, because these are not hermetic: `docker compose up -d` and `pnpm db:migrate`.
 * The empty-state tests read a freshly migrated database and expect it to hold nothing, so
 * seeding data locally will fail them — that is the point of them, not a flaw.
 *
 * Not wired into CI. The `check` job has no database, and standing one up there would trade a
 * fast required check for a slow one; the Neon branch these would need is also the one a preview
 * deploy uses.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/auth.setup.ts",
  // Chrome that is already installed, rather than Playwright's own download.
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    storageState: "./e2e/.auth/state.json",
    trace: "on-first-retry",
  },
  projects: [
    // 390px is the phone the cook view and /shop are designed against.
    {
      name: "phone",
      use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config for PAAW
 *
 * Prerequisites:
 *   - PAAW server running on localhost:4097 (npm run dev:server)
 *   - UI built (npm run build) OR Vite dev server on :5173 (npm run dev:ui)
 *
 * Usage:
 *   npx playwright test              — run all E2E
 *   npx playwright test --ui         — interactive mode
 *   npx playwright test --reporter=line
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // PAAW is single-user, run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    // Test against production build (server serves UI on 4097)
    // For dev mode, change to http://localhost:5173
    baseURL: process.env.PAAW_E2E_URL || "http://localhost:4097",

    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Auto-start PAAW server before tests (uncomment to enable)
  // webServer: {
  //   command: "npm run build && npm run dev:server",
  //   url: "http://localhost:4097",
  //   reuseExistingServer: true,
  //   timeout: 60_000,
  // },
});

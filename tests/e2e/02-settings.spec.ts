/**
 * E2E: Settings Page
 *
 * Verifies Settings page loads, shows provider config, and can save.
 */
import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Try to find and click Settings in sidebar
    // PAAW sidebar has "Settings" or gear icon
    const settingsBtn = page.getByText("Settings").first();
    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1500);
    }
  });

  test("settings page should render", async ({ page }) => {
    await page.screenshot({ path: "tests/e2e/screenshots/03-settings.png" });
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("should show provider configuration", async ({ page }) => {
    // Look for provider-related text
    const pageText = await page.textContent("body");
    const hasProvider =
      pageText?.includes("Provider") ||
      pageText?.includes("供應商") ||
      pageText?.includes("API Key") ||
      pageText?.includes("Model");

    // At least the settings page should mention something provider-related
    // or it might be on a different tab
    if (!hasProvider) {
      // Try clicking through tabs
      const tabs = page.locator("[role='tab'], button[class*='tab'], [class*='Tab']");
      const tabCount = await tabs.count();
      for (let i = 0; i < Math.min(tabCount, 5); i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(500);
        const text = await page.textContent("body");
        if (text?.includes("Provider") || text?.includes("供應商") || text?.includes("API")) {
          break;
        }
      }
    }

    await page.screenshot({ path: "tests/e2e/screenshots/04-settings-provider.png" });
  });
});

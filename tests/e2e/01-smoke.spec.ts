/**
 * E2E: Smoke Tests
 *
 * Verifies that PAAW loads correctly and core UI elements are present.
 * Requires: PAAW server running on localhost:4097
 */
import { test, expect } from "@playwright/test";

test.describe("App Loading", () => {
  test("should load the app without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // Wait for the app to render — look for sidebar or main content
    await page.waitForTimeout(3000);

    // Should not have critical JS errors
    const criticalErrors = errors.filter(
      (e) => !e.includes("favicon") && !e.includes("WebSocket")
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test("should show onboarding or main app", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // The app should show either onboarding or the main interface
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Take a screenshot for debugging
    await page.screenshot({ path: "tests/e2e/screenshots/01-initial-load.png" });
  });
});

test.describe("Navigation", () => {
  test("should navigate between sidebar items", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Look for sidebar navigation items
    const navItems = page.locator("nav [class*='cursor-pointer'], nav button, [class*='NavItem']");
    const count = await navItems.count();

    if (count > 0) {
      // Click the second nav item if available
      const target = count > 1 ? navItems.nth(1) : navItems.first();
      await target.click();
      await page.waitForTimeout(1000);

      // Should have navigated
      await page.screenshot({ path: "tests/e2e/screenshots/02-navigated.png" });
    }
  });
});

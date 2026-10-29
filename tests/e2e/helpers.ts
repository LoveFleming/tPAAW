/**
 * Shared helpers for PAAW E2E tests
 */
import { Page, Locator, expect } from "@playwright/test";

export const SCREENSHOT_DIR = "tests/e2e/screenshots";

/**
 * Navigate to PAAW home and wait for the app to fully load.
 * Handles both onboarding (first run) and main app states.
 */
export async function gotoHome(page: Page, opts: { waitFor?: number } = {}) {
  await page.goto("/");
  // Wait for either onboarding or main app to render
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(opts.waitFor ?? 2500);
}

/**
 * Click a sidebar nav item by its visible text.
 * Sidebar items may be i18n'd but many are hard-coded English (Notes, Mind Map, Projects, etc.)
 */
export async function clickSidebarItem(page: Page, text: string, timeout = 5000) {
  // Try sidebar first
  const item = page.locator("aside, nav").getByText(text, { exact: false }).first();
  if (await item.isVisible({ timeout: 2000 }).catch(() => false)) {
    await item.click();
    await page.waitForTimeout(1500);
    return true;
  }
  // Fallback: search entire page
  const fallback = page.getByText(text, { exact: false }).first();
  if (await fallback.isVisible({ timeout: timeout }).catch(() => false)) {
    await fallback.click();
    await page.waitForTimeout(1500);
    return true;
  }
  return false;
}

/**
 * Take a standardized screenshot.
 */
export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: false });
}

/**
 * Dismiss any onboarding overlay if present.
 */
export async function dismissOnboarding(page: Page) {
  // PAAW shows onboarding if user profile not set.
  // Since the test server already has an onboarded user, this is usually a no-op.
  const startBtn = page.getByText(/開始使用|Get Started/i).first();
  if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Fill onboarding fields
    const nameInput = page.locator("input").first();
    if (await nameInput.isVisible()) {
      await nameInput.fill("Test User");
    }
    await startBtn.click();
    await page.waitForTimeout(2000);
  }
}

/**
 * Wait for a visible, non-empty main content area.
 */
export async function waitForContent(page: Page, timeout = 10_000) {
  await expect(page.locator("body")).toBeVisible();
  // Wait for something to render (not just blank page)
  await page.waitForFunction(
    () => document.querySelector("main")?.children.length > 0 ||
          document.querySelector("#root")?.children.length > 0,
    { timeout }
  ).catch(() => {}); // Non-fatal
}

/**
 * Get all visible text content from the page (for assertions).
 */
export async function getPageText(page: Page): Promise<string> {
  return (await page.locator("body").textContent()) ?? "";
}

/**
 * Check if an element exists and is visible within timeout.
 */
export async function isVisible(locator: Locator, timeout = 3000): Promise<boolean> {
  return await locator.isVisible({ timeout }).catch(() => false);
}

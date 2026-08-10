/**
 * E2E: Additional Pages (Legacy)
 *
 * Basic page render tests for Mind Map, Projects, and Skill Builder.
 * More comprehensive tests are in 11-nav-comprehensive.spec.ts
 */
import { test, expect } from "@playwright/test";
import { gotoHome, screenshot, waitForContent, clickSidebarItem } from "./helpers";

test.describe("Page Render Tests", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);
  });

  test("mind map page should render", async ({ page }) => {
    await clickSidebarItem(page, "Mind Map");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    await screenshot(page, "04-mindmap-page");
  });

  test("projects page should render", async ({ page }) => {
    await clickSidebarItem(page, "Projects");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    await screenshot(page, "04-projects-page");
  });

  test("skill builder page should render", async ({ page }) => {
    await clickSidebarItem(page, "Skill Builder");
    const body = page.locator("body");
    await expect(body).toBeVisible();
    await screenshot(page, "04-skill-builder-page");
  });
});

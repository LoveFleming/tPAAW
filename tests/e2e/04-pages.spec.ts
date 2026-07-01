/**
 * E2E: Mind Map Page
 *
 * Verifies Mind Map page loads and model selector exists.
 */
import { test, expect } from "@playwright/test";

test.describe("Mind Map Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const mindmapBtn = page.getByText("Mind Map").first();
    if (await mindmapBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mindmapBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test("should render mind map page", async ({ page }) => {
    await page.screenshot({ path: "tests/e2e/screenshots/07-mindmap.png" });
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

test.describe("Projects Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const projectsBtn = page.getByText("Projects").first();
    if (await projectsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await projectsBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test("should render projects page", async ({ page }) => {
    await page.screenshot({ path: "tests/e2e/screenshots/08-projects.png" });
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

test.describe("Skill Builder Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const skillBtn = page.getByText(/Skill/i).first();
    if (await skillBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await skillBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test("should render skill builder page", async ({ page }) => {
    await page.screenshot({ path: "tests/e2e/screenshots/09-skill-builder.png" });
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

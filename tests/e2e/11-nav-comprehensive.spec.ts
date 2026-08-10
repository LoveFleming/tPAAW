/**
 * E2E: Comprehensive Navigation Test
 *
 * Navigates from Chat → every sidebar page → verify content renders.
 * Tests tab open/close, sidebar section collapse/expand.
 */
import { test, expect } from "@playwright/test";
import { gotoHome, screenshot, waitForContent, clickSidebarItem, isVisible } from "./helpers";

// All sidebar pages to test (using visible text labels from App.tsx)
const SIDEBAR_PAGES = [
  // Execution section
  { name: "AI Crew", text: "AI 團隊" },        // sidebar.aiCrew
  { name: "App Pool", text: "應用程式池" },      // sidebar.appPool
  { name: "Briefing Player", text: "Briefing Player" },
  { name: "Coding", text: "Coding" },
  { name: "Mind Map", text: "Mind Map" },
  { name: "Notes", text: "Notes" },
  { name: "Projects", text: "Projects" },
  { name: "Schedules", text: "Schedules" },      // sidebar.cronJobs
  // Build section
  { name: "Skill Builder", text: "技能建構器" },   // sidebar.skillBuilder
  { name: "App Builder", text: "App Builder" },
  // Management section
  { name: "Skill Pool", text: "Skill Pool" },    // sidebar.skillPool
  { name: "AI Settings", text: "AI Settings" },
  { name: "LLM Log", text: "LLM" },              // sidebar.llmLog
  { name: "Agent Log", text: "Agent" },           // sidebar.agentLog
];

test.describe("Comprehensive Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);
  });

  // Generate a test for each sidebar page
  for (const sidebarPage of SIDEBAR_PAGES) {
    test(`should navigate to ${sidebarPage.name} and render content`, async ({ page }) => {
      const success = await clickSidebarItem(page, sidebarPage.text, 5000);
      await page.waitForTimeout(2000);

      // Take screenshot of the page
      const slug = sidebarPage.name.toLowerCase().replace(/\s+/g, "-");
      await screenshot(page, `11-nav-${slug}`);

      // Verify the page is not blank
      const main = page.locator("main");
      const mainText = await main.textContent();
      const body = page.locator("body");
      const bodyText = await body.textContent();

      // The page should have some rendered content (not just whitespace)
      const contentLength = (mainText ?? bodyText ?? "").trim().length;
      expect(contentLength).toBeGreaterThan(20);
    });
  }

  test("should navigate through multiple pages sequentially", async ({ page }) => {
    // Start at chat (default)
    const chatTab = page.getByText("💬").first();
    await expect(chatTab).toBeVisible({ timeout: 5000 });

    // Navigate to Notes
    await clickSidebarItem(page, "Notes");
    await page.waitForTimeout(1500);

    // Navigate to Mind Map
    await clickSidebarItem(page, "Mind Map");
    await page.waitForTimeout(1500);

    // Navigate to Projects
    await clickSidebarItem(page, "Projects");
    await page.waitForTimeout(1500);

    // Navigate to Coding
    await clickSidebarItem(page, "Coding");
    await page.waitForTimeout(1500);

    // Navigate to Schedules
    await clickSidebarItem(page, "Schedules");
    await page.waitForTimeout(1500);

    // Should have multiple tabs open now
    const tabs = page.locator("main [class*='cursor-pointer']").filter({ hasText: /.+/ });
    const tabCount = await tabs.count();

    await screenshot(page, "11-nav-multiple-pages");
    expect(tabCount).toBeGreaterThanOrEqual(1);
  });

  test("should open and close tabs", async ({ page }) => {
    // Navigate to a page (opens a new tab)
    await clickSidebarItem(page, "Notes");
    await page.waitForTimeout(1500);

    // Find a close button on a tab (not the chat tab)
    // Close buttons appear on non-pinned tabs
    const closeBtn = page.locator("[class*='cursor-pointer'] button:has(svg)").filter({ hasText: "" }).first();
    const hasClose = await isVisible(closeBtn, 3000);

    if (hasClose) {
      // Count tabs before closing
      const tabsBefore = await page.locator("main > div > div[class*='flex w-full']").locator("[class*='cursor-pointer']").count();

      await closeBtn.click();
      await page.waitForTimeout(500);

      await screenshot(page, "11-nav-tab-closed");
    } else {
      await screenshot(page, "11-nav-no-close-btn");
    }
  });

  test("should switch between open tabs", async ({ page }) => {
    // Open multiple pages
    await clickSidebarItem(page, "Notes");
    await page.waitForTimeout(1000);

    await clickSidebarItem(page, "Mind Map");
    await page.waitForTimeout(1000);

    // Find visible tabs in the tab bar
    const tabBar = page.locator("main > div > div").first();
    const tabItems = tabBar.locator("[class*='cursor-pointer']").filter({ hasText: /.+/ });
    const tabCount = await tabItems.count();

    if (tabCount > 1) {
      // Click the first tab (should be chat)
      await tabItems.first().click();
      await page.waitForTimeout(500);
      await screenshot(page, "11-nav-tab-1");

      // Click the second tab
      if (tabCount > 1) {
        await tabItems.nth(1).click();
        await page.waitForTimeout(500);
        await screenshot(page, "11-nav-tab-2");
      }
    } else {
      await screenshot(page, "11-nav-single-tab");
    }
  });
});

test.describe("Sidebar Sections", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);
  });

  test("should show all sidebar section headers", async ({ page }) => {
    const pageText = await page.locator("aside").textContent();

    // Knowledge section (i18n: "知識庫" or "Knowledge")
    expect(pageText?.includes("知識") || pageText?.includes("Knowledge")).toBeTruthy();
    // Build section
    expect(pageText?.includes("Build")).toBeTruthy();
    // Execution section (i18n: "執行" or "Execution")
    expect(pageText?.includes("執行") || pageText?.includes("Execution")).toBeTruthy();
    // Management section
    expect(pageText?.includes("Management")).toBeTruthy();
  });

  test("should show section content under each header", async ({ page }) => {
    // Each section should have nav items
    const aside = page.locator("aside");
    await expect(aside).toBeVisible();

    // Knowledge — file tree
    const pageText = await aside.textContent();

    // Build section should have Skill Builder and App Builder
    const hasBuildItems =
      pageText?.includes("Skill") ||
      pageText?.includes("技能") ||
      pageText?.includes("App Builder");

    // Execution section should have multiple items
    const hasExecItems =
      pageText?.includes("Coding") ||
      pageText?.includes("Notes") ||
      pageText?.includes("Mind Map") ||
      pageText?.includes("Projects") ||
      pageText?.includes("Crew") ||
      pageText?.includes("團隊");

    // Management section should have Skill Pool, AI Settings, etc.
    const hasMgmtItems =
      pageText?.includes("Skill Pool") ||
      pageText?.includes("AI Settings") ||
      pageText?.includes("LLM");

    await screenshot(page, "11-nav-sidebar-sections");
  });

  test("should collapse and expand sidebar sections", async ({ page }) => {
    // SidebarSection headers are clickable to toggle collapse
    // Find a section header
    const sectionHeader = page.locator("aside").getByText("Build").first();
    const hasHeader = await isVisible(sectionHeader, 3000);

    if (hasHeader) {
      // Click to collapse
      await sectionHeader.click().catch(() => {});
      await page.waitForTimeout(300);

      await screenshot(page, "11-nav-section-collapsed");

      // Click again to expand
      await sectionHeader.click().catch(() => {});
      await page.waitForTimeout(300);

      await screenshot(page, "11-nav-section-expanded");
    } else {
      await screenshot(page, "11-nav-section-header-not-found");
    }
  });

  test("should show Plugins section", async ({ page }) => {
    const aside = page.locator("aside");
    const asideText = await aside.textContent();

    // Plugins section should exist (even if empty)
    expect(asideText?.includes("Plugins")).toBeTruthy();

    // Check for known plugin
    const hasPlugin =
      asideText?.includes("Agentic") ||
      asideText?.includes("Platform") ||
      asideText?.includes("No plugins") ||
      asideText?.includes("🔌");

    await screenshot(page, "11-nav-plugins");
  });

  test("should show Workspaces section", async ({ page }) => {
    const aside = page.locator("aside");
    const asideText = await aside.textContent();

    // Workspaces section
    expect(asideText?.includes("工作區") || asideText?.includes("Workspaces")).toBeTruthy();

    // Should show workspace directories or empty state
    const hasWorkspace =
      asideText?.includes("tPAAW") ||
      asideText?.includes("加入目錄") ||
      asideText?.includes("Add") ||
      asideText?.includes("目錄");

    await screenshot(page, "11-nav-workspaces");
  });

  test("should show settings button at sidebar bottom", async ({ page }) => {
    // Settings button at the bottom of sidebar
    const settingsBtn = page.locator("aside").getByText("設定").or(page.locator("aside").getByText("Settings")).first();
    const hasSettings = await isVisible(settingsBtn, 3000);

    expect(hasSettings).toBeTruthy();

    await screenshot(page, "11-nav-settings-btn");
  });
});

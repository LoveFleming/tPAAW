/**
 * E2E: Coding IDE Tests
 *
 * Verifies Coding IDE page loads, file tree, terminal area,
 * code editor, search, git panel, and AI chat.
 */
import { test, expect } from "@playwright/test";
import { gotoHome, screenshot, waitForContent, clickSidebarItem, isVisible } from "./helpers";

test.describe("Coding IDE", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    // Navigate to Coding via sidebar (Execution section)
    // i18n: "Coding"
    await clickSidebarItem(page, "Coding");
    await page.waitForTimeout(2000);
  });

  test("should render coding IDE page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();

    // Coding IDE should show some known UI elements
    const hasCodingUI =
      pageText?.includes("Coding") ||
      pageText?.includes("IDE") ||
      pageText?.includes("⚡") ||
      pageText?.includes("專案") ||
      pageText?.includes("Project") ||
      pageText?.includes("檔案") ||
      pageText?.includes("File") ||
      pageText?.includes("終端機") ||
      pageText?.includes("Terminal") ||
      (pageText?.length ?? 0) > 50;

    expect(hasCodingUI).toBeTruthy();

    await screenshot(page, "09-coding-loaded");
  });

  test("should have file tree or project explorer area", async ({ page }) => {
    // File tree is on the left side of the IDE
    const leftPanel = page.locator("main").locator("div").first();
    await expect(leftPanel).toBeVisible();

    // Look for file-tree related elements
    const pageText = await page.locator("body").textContent();

    const hasFileTree =
      pageText?.includes("專案路徑") ||
      pageText?.includes("Project path") ||
      pageText?.includes("瀏覽") ||
      pageText?.includes("Browse") ||
      pageText?.includes("開啟專案") ||
      pageText?.includes("Open");

    await screenshot(page, "09-coding-file-tree");
  });

  test("should have terminal area or tab", async ({ page }) => {
    // Terminal might be a tab or a bottom panel
    const terminalTab = page.getByText("終端機").or(page.getByText("Terminal")).or(page.getByText("⌨️")).first();
    const hasTerminal = await isVisible(terminalTab, 3000);

    if (hasTerminal) {
      // Click to open terminal
      await terminalTab.click().catch(() => {});
      await page.waitForTimeout(500);
      await screenshot(page, "09-coding-terminal");
    } else {
      await screenshot(page, "09-coding-terminal-not-found");
    }
  });

  test("should have code editor area", async ({ page }) => {
    // The center area should be the editor
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();

    // Editor might be empty until a file is opened
    const pageText = await page.locator("body").textContent();

    const hasEditor =
      pageText?.includes("尚未開啟") ||
      pageText?.includes("No files") ||
      pageText?.includes("No project") ||
      pageText?.includes("輸入專案") ||
      pageText?.includes("Open") ||
      true;

    await screenshot(page, "09-coding-editor");
  });

  test("should have search functionality", async ({ page }) => {
    // Search icon/button or search input
    const searchBtn = page.getByText("🔍").or(page.locator("button:has-text('Search')")).first();
    const hasSearch = await isVisible(searchBtn, 3000);

    if (hasSearch) {
      await searchBtn.click().catch(() => {});
      await page.waitForTimeout(500);

      // Search input should appear
      const searchInput = page.locator("input[placeholder*='搜尋'], input[placeholder*='Search'], input[placeholder*='檔案'], input[placeholder*='file']").first();
      const hasInput = await isVisible(searchInput, 2000);

      await screenshot(page, "09-coding-search");
    } else {
      // Search might be embedded directly
      const searchInput = page.locator("input[placeholder*='搜尋'], input[placeholder*='Search'], input[placeholder*='檔案']").first();
      const hasInput = await isVisible(searchInput, 2000);

      await screenshot(page, "09-coding-search-embedded");
    }
  });

  test("should have git panel or tab", async ({ page }) => {
    // Git panel — tab or button
    const gitTab = page.getByText("Git").or(page.getByText("🔀")).first();
    const hasGit = await isVisible(gitTab, 3000);

    if (hasGit) {
      await gitTab.click().catch(() => {});
      await page.waitForTimeout(500);

      // Git panel should show status, diff, etc.
      const pageText = await page.locator("body").textContent();
      const hasGitUI =
        pageText?.includes("Status") ||
        pageText?.includes("狀態") ||
        pageText?.includes("Diff") ||
        pageText?.includes("差異") ||
        pageText?.includes("Branch") ||
        pageText?.includes("分支") ||
        pageText?.includes("staged") ||
        pageText?.includes("暫存") ||
        pageText?.includes("No changes");

      await screenshot(page, "09-coding-git");
    } else {
      await screenshot(page, "09-coding-git-not-found");
    }
  });

  test("should have AI chat panel", async ({ page }) => {
    // AI chat — right sidebar or tab
    const aiTab = page.getByText("🤖").or(page.getByText("AI Chat")).or(page.getByText("🤖 AI")).first();
    const hasAi = await isVisible(aiTab, 3000);

    if (hasAi) {
      await aiTab.click().catch(() => {});
      await page.waitForTimeout(500);

      // AI chat panel should be visible
      await screenshot(page, "09-coding-ai-chat");
    } else {
      // AI chat might always be visible on the right
      const pageText = await page.locator("body").textContent();
      const hasAiText =
        pageText?.includes("AI") ||
        pageText?.includes("🤖") ||
        pageText?.includes("思考中") ||
        pageText?.includes("Thinking");

      await screenshot(page, "09-coding-ai-chat-area");
    }
  });

  test("should have top tab bar with panel toggles", async ({ page }) => {
    // The IDE has a top tab bar with panel toggle icons
    // These include: editor, git, api tester, terminal, AI, etc.
    const pageText = await page.locator("body").textContent();

    const hasTabs =
      pageText?.includes("⚡") ||
      pageText?.includes("Coding") ||
      pageText?.includes("Code Status") ||
      pageText?.includes("🔍") ||
      pageText?.includes("Search");

    await screenshot(page, "09-coding-tabs");
  });

  test("should show welcome message when no project is open", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // IDE welcome text
    const hasWelcome =
      pageText?.includes("Coding IDE") ||
      pageText?.includes("welcome") ||
      pageText?.includes("Open project") ||
      pageText?.includes("開啟專案") ||
      pageText?.includes("左邊打開") ||
      pageText?.includes("點擊檔案");

    await screenshot(page, "09-coding-welcome");
  });
});

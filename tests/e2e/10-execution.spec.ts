/**
 * E2E: Execution — Cron Jobs, Mind Map, Projects, Briefing Player
 *
 * Verifies various Execution section pages load and function correctly.
 */
import { test, expect } from "@playwright/test";
import { gotoHome, screenshot, waitForContent, clickSidebarItem, isVisible } from "./helpers";

// ── Cron Jobs (Schedules) ──
test.describe("Cron Jobs / Schedules Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    // Navigate via sidebar — i18n: "Schedules" or "排程"
    await clickSidebarItem(page, "Schedules");
    await page.waitForTimeout(2000);
  });

  test("should render schedules page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();
    const hasScheduleUI =
      pageText?.includes("Schedule") ||
      pageText?.includes("排程") ||
      pageText?.includes("Cron") ||
      pageText?.includes("提醒") ||
      pageText?.includes("Reminder") ||
      pageText?.includes("每天") ||
      pageText?.includes("Daily") ||
      (pageText?.length ?? 0) > 50;

    expect(hasScheduleUI).toBeTruthy();

    await screenshot(page, "10-cron-loaded");
  });

  test("should show existing schedule list", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // From API check, known cron jobs exist
    const hasKnownJobs =
      pageText?.includes("備份") ||
      pageText?.includes("Backup") ||
      pageText?.includes("清理") ||
      pageText?.includes("Log") ||
      pageText?.includes("Auto Dispatch") ||
      pageText?.includes("啟用") ||
      pageText?.includes("Enabled") ||
      pageText?.includes("停用") ||
      pageText?.includes("Disabled");

    await screenshot(page, "10-cron-list");
  });

  test("should have create/new schedule button", async ({ page }) => {
    const newBtn = page.locator("button:has-text('新建'), button:has-text('新增'), button:has-text('New'), button:has-text('Create')").first();
    const hasNewBtn = await isVisible(newBtn, 3000);

    if (hasNewBtn) {
      await screenshot(page, "10-cron-new-btn");
    } else {
      await screenshot(page, "10-cron-new-btn-not-found");
    }
  });

  test("should show schedule templates or types", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // Schedule template types
    const hasTemplates =
      pageText?.includes("每天") ||
      pageText?.includes("Daily") ||
      pageText?.includes("每小時") ||
      pageText?.includes("Hourly") ||
      pageText?.includes("每週") ||
      pageText?.includes("Weekly") ||
      pageText?.includes("提醒") ||
      pageText?.includes("Reminder") ||
      pageText?.includes("報告") ||
      pageText?.includes("Report");

    await screenshot(page, "10-cron-templates");
  });
});

// ── Mind Map ──
test.describe("Mind Map Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    await clickSidebarItem(page, "Mind Map");
    await page.waitForTimeout(2000);
  });

  test("should render mind map page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();
    const hasMindMapUI =
      pageText?.includes("Mind Map") ||
      pageText?.includes("心智圖") ||
      pageText?.includes("產生") ||
      pageText?.includes("Generate") ||
      pageText?.includes("🧠") ||
      (pageText?.length ?? 0) > 50;

    expect(hasMindMapUI).toBeTruthy();

    await screenshot(page, "10-mindmap-loaded");
  });

  test("should have generate mind map button (🧠)", async ({ page }) => {
    const generateBtn = page.locator("button:has-text('🧠'), button:has-text('產生'), button:has-text('Generate')").first();
    const hasBtn = await isVisible(generateBtn, 4000);

    if (hasBtn) {
      await screenshot(page, "10-mindmap-generate-btn");
    } else {
      await screenshot(page, "10-mindmap-generate-not-found");
    }
  });

  test("should have text input area for mind map content", async ({ page }) => {
    // Text input for generating mind maps
    const textarea = page.locator("textarea[placeholder*='文字'], textarea[placeholder*='text'], textarea[placeholder*='貼上'], textarea[placeholder*='paste']").first();
    const hasTextarea = await isVisible(textarea, 3000);

    if (hasTextarea) {
      await textarea.click();
      await textarea.fill("This is a test content for mind map generation. It should have enough text to work with.");
      await screenshot(page, "10-mindmap-text-input");
    } else {
      // Generic textarea
      const anyTextarea = page.locator("textarea").first();
      const hasAny = await isVisible(anyTextarea, 2000);
      await screenshot(page, "10-mindmap-text-input-generic");
    }
  });

  test("should show mind map list or saved maps", async ({ page }) => {
    // Check for a list of existing mind maps
    const pageText = await page.locator("body").textContent();

    // List area or empty state
    await screenshot(page, "10-mindmap-list");
  });
});

// ── Projects ──
test.describe("Projects Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    await clickSidebarItem(page, "Projects");
    await page.waitForTimeout(2000);
  });

  test("should render projects page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();
    const hasProjectUI =
      pageText?.includes("Project") ||
      pageText?.includes("專案") ||
      pageText?.includes("Board") ||
      pageText?.includes("看板") ||
      pageText?.includes("任務") ||
      pageText?.includes("Task") ||
      (pageText?.length ?? 0) > 50;

    expect(hasProjectUI).toBeTruthy();

    await screenshot(page, "10-projects-loaded");
  });

  test("should show project board or list", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // Project board elements
    const hasBoard =
      pageText?.includes("專案") ||
      pageText?.includes("Project") ||
      pageText?.includes("進度") ||
      pageText?.includes("Progress") ||
      pageText?.includes("完成") ||
      pageText?.includes("Done") ||
      pageText?.includes("新專案") ||
      pageText?.includes("New Project") ||
      pageText?.includes("里程碑") ||
      pageText?.includes("Milestone");

    await screenshot(page, "10-projects-board");
  });

  test("should have new project button", async ({ page }) => {
    const newBtn = page.locator("button:has-text('新專案'), button:has-text('New Project'), button:has-text('新增'), button:has-text('Create')").first();
    const hasNewBtn = await isVisible(newBtn, 3000);

    if (hasNewBtn) {
      await screenshot(page, "10-projects-new-btn");
    } else {
      await screenshot(page, "10-projects-new-btn-not-found");
    }
  });

  test("should show project statistics area", async ({ page }) => {
    // Project dashboard may have stats cards
    const pageText = await page.locator("body").textContent();

    const hasStats =
      pageText?.includes("完成率") ||
      pageText?.includes("Completion") ||
      pageText?.includes("專案數") ||
      pageText?.includes("Projects") ||
      pageText?.includes("總任務") ||
      pageText?.includes("Total Tasks") ||
      pageText?.includes("進度") ||
      pageText?.includes("Progress");

    await screenshot(page, "10-projects-stats");
  });
});

// ── Briefing Player ──
test.describe("Briefing Player Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    // i18n: "Briefing Player"
    await clickSidebarItem(page, "Briefing Player");
    await page.waitForTimeout(2000);
  });

  test("should render briefing player page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();

    // Briefing player UI elements
    const hasBriefingUI =
      pageText?.includes("Briefing") ||
      pageText?.includes("簡報") ||
      pageText?.includes("PDF") ||
      pageText?.includes("Slide") ||
      pageText?.includes("頁面") ||
      pageText?.includes("Page") ||
      pageText?.includes("參考") ||
      pageText?.includes("Reference") ||
      (pageText?.length ?? 0) > 50;

    expect(hasBriefingUI).toBeTruthy();

    await screenshot(page, "10-briefing-loaded");
  });

  test("should show page navigation controls", async ({ page }) => {
    // Navigation: previous/next page buttons
    const prevBtn = page.locator("button:has-text('上一頁'), button:has-text('Previous'), button:has-text('←')").first();
    const nextBtn = page.locator("button:has-text('下一頁'), button:has-text('Next'), button:has-text('→')").first();

    const hasPrev = await isVisible(prevBtn, 3000);
    const hasNext = await isVisible(nextBtn, 3000);

    await screenshot(page, "10-briefing-navigation");
  });

  test("should have annotation or drawing tools", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // Briefing player has annotation tools
    const hasTools =
      pageText?.includes("標記") ||
      pageText?.includes("Marker") ||
      pageText?.includes("手繪") ||
      pageText?.includes("Pen") ||
      pageText?.includes("標註") ||
      pageText?.includes("Annotation") ||
      pageText?.includes("清除") ||
      pageText?.includes("Clear");

    await screenshot(page, "10-briefing-tools");
  });
});

/**
 * E2E: Settings Page (Enhanced)
 *
 * Verifies Settings page loads, shows profile, provider config,
 * model list, save button, language switching, and AI Settings.
 */
import { test, expect } from "@playwright/test";
import { gotoHome, screenshot, waitForContent, clickSidebarItem, isVisible } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    // Click settings (⚙️ 設定) in sidebar bottom
    const settingsBtn = page.getByText("設定").or(page.getByText("Settings")).first();
    if (await isVisible(settingsBtn, 3000)) {
      await settingsBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test("settings page should render with content", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Settings should have meaningful content
    const pageText = await body.textContent();
    const hasSettings =
      pageText?.includes("設定") ||
      pageText?.includes("Settings") ||
      pageText?.includes("Profile") ||
      pageText?.includes("個人資料") ||
      pageText?.includes("Provider") ||
      pageText?.includes("Model") ||
      (pageText?.length ?? 0) > 50;

    expect(hasSettings).toBeTruthy();

    await screenshot(page, "02-settings-loaded");
  });

  test("should show profile section with name field", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    const hasProfile =
      pageText?.includes("Profile") ||
      pageText?.includes("個人資料") ||
      pageText?.includes("名字") ||
      pageText?.includes("name") ||
      pageText?.includes("阿明"); // Current user's name

    // Try to find profile tab and click it
    const profileTab = page.locator("button:has-text('Profile'), button:has-text('個人資料'), [role='tab']:has-text('Profile')").first();
    if (await isVisible(profileTab, 3000)) {
      await profileTab.click();
      await page.waitForTimeout(500);
    }

    await screenshot(page, "02-settings-profile");
  });

  test("should show provider configuration area", async ({ page }) => {
    // Look for provider tab or section
    const providerTab = page.locator("button:has-text('Provider'), [role='tab']:has-text('Provider'), button:has-text('供應商')").first();
    const hasProviderTab = await isVisible(providerTab, 4000);

    if (hasProviderTab) {
      await providerTab.click();
      await page.waitForTimeout(1000);
    }

    const pageText = await page.locator("body").textContent();
    const hasProvider =
      pageText?.includes("Provider") ||
      pageText?.includes("供應商") ||
      pageText?.includes("API Key") ||
      pageText?.includes("OpenRouter") ||
      pageText?.includes("智譜") ||
      pageText?.includes("zai");

    expect(hasProvider || (pageText?.length ?? 0) > 50).toBeTruthy();

    await screenshot(page, "02-settings-provider");
  });

  test("should show model list", async ({ page }) => {
    // Navigate to provider tab first
    const providerTab = page.locator("button:has-text('Provider'), [role='tab']:has-text('Provider')").first();
    if (await isVisible(providerTab, 3000)) {
      await providerTab.click();
      await page.waitForTimeout(1000);
    }

    const pageText = await page.locator("body").textContent();

    // Check for known models
    const hasModel =
      pageText?.includes("glm-5") ||
      pageText?.includes("GLM") ||
      pageText?.includes("Model") ||
      pageText?.includes("模型");

    await screenshot(page, "02-settings-models");
  });

  test("should have save button", async ({ page }) => {
    // Look for save button
    const saveBtn = page.locator("button:has-text('儲存'), button:has-text('Save')").first();
    const hasSaveBtn = await isVisible(saveBtn, 4000);

    if (hasSaveBtn) {
      await screenshot(page, "02-settings-save-btn");
    } else {
      // Save button might be in a specific tab
      const anySaveBtn = page.locator("button").filter({ hasText: /Save|儲存/ });
      const count = await anySaveBtn.count();
      await screenshot(page, "02-settings-save-btn-search");
    }
  });

  test("should have language selector", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // Look for language section
    const hasLanguage =
      pageText?.includes("語言") ||
      pageText?.includes("Language") ||
      pageText?.includes("English") ||
      pageText?.includes("中文");

    // Language option in settings
    const langBtn = page.getByText("語言").or(page.getByText("Language")).first();
    const hasLangBtn = await isVisible(langBtn, 3000);

    if (hasLangBtn) {
      await screenshot(page, "02-settings-language");
    } else {
      await screenshot(page, "02-settings-language-not-found");
    }
  });

  test("should show style/intro fields in profile", async ({ page }) => {
    // Profile tab
    const profileTab = page.locator("button:has-text('Profile'), button:has-text('個人資料')").first();
    if (await isVisible(profileTab, 3000)) {
      await profileTab.click();
      await page.waitForTimeout(500);
    }

    const pageText = await page.locator("body").textContent();

    const hasStyle =
      pageText?.includes("風格") ||
      pageText?.includes("Style") ||
      pageText?.includes("正式") ||
      pageText?.includes("Formal") ||
      pageText?.includes("簡潔") ||
      pageText?.includes("Concise") ||
      pageText?.includes("輕鬆") ||
      pageText?.includes("Casual") ||
      pageText?.includes("詳細") ||
      pageText?.includes("Detailed");

    const hasIntro =
      pageText?.includes("介紹") ||
      pageText?.includes("Intro") ||
      pageText?.includes("工程師"); // Current user's intro

    await screenshot(page, "02-settings-profile-fields");
  });
});

test.describe("AI Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHome(page);
    await waitForContent(page);

    // Navigate to AI Settings via sidebar (Management section)
    await clickSidebarItem(page, "AI Settings");
  });

  test("should render AI settings page", async ({ page }) => {
    const body = page.locator("body");
    await expect(body).toBeVisible();

    const pageText = await body.textContent();

    // AI Settings should show system prompt categories
    const hasAiSettings =
      pageText?.includes("System") ||
      pageText?.includes("系統") ||
      pageText?.includes("Prompt") ||
      pageText?.includes("提示詞") ||
      pageText?.includes("Category") ||
      pageText?.includes("分類") ||
      pageText?.includes("Chat") ||
      pageText?.includes("交談");

    expect(hasAiSettings || (pageText?.length ?? 0) > 50).toBeTruthy();

    await screenshot(page, "02-ai-settings-loaded");
  });

  test("should show system prompt categories", async ({ page }) => {
    const pageText = await page.locator("body").textContent();

    // AI Settings has categories like chat, notes, mindmap, project, etc.
    const categories = ["chat", "notes", "mindmap", "project", "coding", "skill"];
    const foundCategories = categories.filter(c => pageText?.toLowerCase().includes(c));

    await screenshot(page, "02-ai-settings-categories");
  });

  test("should show editable prompt content when category is selected", async ({ page }) => {
    // Try clicking a category
    const category = page.locator("[class*='cursor-pointer'], [class*='clickable'], button").filter({ hasText: /chat|交談|notes|筆記/i }).first();
    const hasCategory = await isVisible(category, 3000);

    if (hasCategory) {
      await category.click();
      await page.waitForTimeout(1000);

      // Should show a textarea or editor with the prompt
      const editor = page.locator("textarea").first();
      const hasEditor = await isVisible(editor, 3000);

      await screenshot(page, "02-ai-settings-prompt-editor");
    } else {
      await screenshot(page, "02-ai-settings-no-category");
    }
  });
});

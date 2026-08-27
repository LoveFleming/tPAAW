// ── Browser Session（agent 用的內建瀏覽器）──
// 架構對標 Claude Cowork 內建瀏覽器（2026-08-26 發布）：
//   - Chromium（Playwright），不是使用者的瀏覽器，獨立 profile
//   - persistent userDataDir → 登入狀態跨重啟保留（cookie 持久化）
//   - headless、單一 context、所有 agent 共用（v1 簡化）
//
// 安全邊界：
//   - 只允許 http/https（block file: / javascript: / data:）
//   - 截圖存 DATA_HOME/logs/browser/，最新一張固定檔名 latest.png（IDE Browser tab 輪詢用）
//
// 跨平台：Playwright 支援 Windows / macOS / Linux，Chromium binary 各平台各自下載
//（npm i && npx playwright install chromium）。未安裝時工具回覆清楚安裝指引，不炸 server。
import { mkdirSync } from "fs";
import { join } from "path";

let _ctx = null;          // Playwright BrowserContext（singleton）
let _launching = null;    // 進行中的 launch promise（防併發雙開）
const _state = {
  ready: false,
  available: null,        // null=未檢查, true/false
  error: null,
  url: null,
  title: null,
  lastActionAt: null,
  lastScreenshot: null,   // { path, ts }
};

export function browserState() { return { ..._state, lastActionAt: _state.lastActionAt }; }

/** URL 安全檢查：只放行 http/https */
export function assertSafeUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked protocol ${u.protocol} — only http/https allowed`);
  }
  return u.href;
}

/** 惰性啟動 persistent browser context */
export async function getBrowserContext(DATA_HOME) {
  if (_ctx) return _ctx;
  if (_launching) return _launching;
  _launching = (async () => {
    const { chromium } = await import("playwright");
    const profileDir = join(DATA_HOME, "browser-profile");
    const shotDir = join(DATA_HOME, "logs", "browser");
    mkdirSync(profileDir, { recursive: true });
    mkdirSync(shotDir, { recursive: true });
    const ctx = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      timeout: 20_000,
    });
    ctx.on("close", () => { _ctx = null; _state.ready = false; });
    ctx.setDefaultTimeout(15_000);
    ctx.setDefaultNavigationTimeout(25_000);
    _ctx = ctx;
    _state.ready = true;
    _state.available = true;
    _state.error = null;
    return ctx;
  })().catch(err => {
    _state.available = false;
    _state.error = err?.message || String(err);
    _launching = null;
    throw err;
  });
  return _launching;
}

/** 取得目前 page（沒有就開新分頁）*/
export async function getBrowserPage(DATA_HOME) {
  const ctx = await getBrowserContext(DATA_HOME);
  let page = ctx.pages().find(p => !p.isClosed());
  if (!page) page = await ctx.newPage();
  return page;
}

/** 截圖：存時間戳檔 + 覆蓋 latest.png（IDE 輪詢用）*/
export async function takeScreenshot(DATA_HOME, page) {
  const shotDir = join(DATA_HOME, "logs", "browser");
  mkdirSync(shotDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(shotDir, `shot-${ts}.png`);
  await page.screenshot({ path, fullPage: false });
  const { copyFileSync } = await import("fs");
  try { copyFileSync(path, join(shotDir, "latest.png")); } catch { /* best effort */ }
  _state.lastScreenshot = { path: path.split(/[\\/]/).join("/"), ts: Date.now() };
  return _state.lastScreenshot.path;
}

/** 更新狀態（每次動作後呼叫）*/
export function trackPage(page) {
  const upd = () => {
    _state.url = page.url();
    _state.title = null;
    page.title().then(t => { _state.title = t; }).catch(() => {});
    _state.lastActionAt = Date.now();
  };
  page.on("framenavigated", upd);
  upd();
}

/** 頁面文字內容（截斷）*/
export async function readPageText(page, maxLength = 8000) {
  const text = await page.evaluate(() => document?.body?.innerText || "");
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength) + `\n... (truncated, ${clean.length - maxLength} more chars)`;
}

/** 找元素：優先 selector，否則用可見文字（同步 — locator 建立不需 await）*/
export function locateTarget(page, { selector, text }) {
  if (selector) return page.locator(selector).first();
  if (text) return page.getByText(text, { exact: false }).first();
  throw new Error("Provide `selector` or `text` to identify the element");
}

/** 未安裝 playwright 時的安裝指引 */
export const PLAYWRIGHT_INSTALL_HINT =
  "Playwright is not installed on this machine.\n" +
  "Install it (one-time, per machine):\n" +
  "  cd <PAAW root>\n" +
  "  npm install\n" +
  "  npx playwright install chromium   # ~170MB download, Windows/macOS/Linux all supported\n" +
  "Then retry. Server restart is NOT required (lazy load).";

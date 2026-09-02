// ── BrowserExecutor — per-ReleaseUnit 瀏覽器執行器（操作可視化 + 完整審計）──
//
// 與 browser-session.mjs（IDE 共用 Cowork 瀏覽器）的分工：
//   - browser-session.mjs：headless、單一共用 profile、screencast 串流 — agent 日常瀏覽
//   - browser-executor.mjs：headless: false（使用者親眼看見操作）、每 RU 獨立 persistent
//     profile、每次操作落盤 JSONL 審計日誌 — release unit 的驗收 / 演示 / 自動化操作
//
// 規格（Fleming 2026-08-27 22:39，2026-09-02 改：統一用系統 Chrome）：
//   1. Playwright chromium.launchPersistentContext（channel: "chrome" — 用系統已安裝的 Google Chrome）
//   2. 每個 releaseUnit 獨立 persistent profile（DATA_HOME/browser-executor-profiles/<ruId>/）
//   3. v1 methods：open / readPage / click / type / screenshot / getConsoleErrors / getFailedRequests / close
//   4. headless: false — 讓使用者看見操作
//   5. 所有操作記錄 releaseUnitId、traceId、URL、action、result、screenshotPath、timestamp
//      → 記憶體（session 內，供查詢）+ JSONL 落盤（DATA_HOME/logs/browser-executor/<ruId>.jsonl）
//   6. 絕不使用使用者預設 Chrome profile — userDataDir 一律在 PAAW data 目錄下。
//      PAAW 不再用自帶 chromium — 統一 channel: "chrome" 操控系統 Chrome（不載 ~170MB bundled）
//
// 生命週期：open 時惰性啟動（防併發雙開）；close 或使用者手動關視窗 → session 移除（日誌已落盤）
// traceId：session 建立時自動生成；open 可帶入指定值（把一輪驗收的全部操作綁在同一 trace）
//
// 跨平台紀律：路徑輸出一律 split(/[\\/]/).join("/")；isMain 判斷用 pathToFileURL（不用 new URL().pathname）
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import { DATA_HOME } from "../data-home.mjs";
import { assertSafeUrl, readPageText, locateTarget } from "./browser-session.mjs";

const PROFILE_ROOT = join(DATA_HOME, "browser-executor-profiles"); // 每 RU 獨立 profile
const LOG_ROOT = join(DATA_HOME, "logs", "browser-executor");

const _MAX_LOG = 1000;      // in-memory 操作日誌上限（JSONL 不受影響）
const _MAX_ERRORS = 500;    // console errors 上限
const _MAX_FAILED = 500;    // failed requests 上限

const _sessions = new Map(); // releaseUnitId（原始字串）→ session

// ── helpers ──
function _safeRuId(releaseUnitId) {
  if (!releaseUnitId || typeof releaseUnitId !== "string") throw new Error("releaseUnitId required");
  const safe = releaseUnitId.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!safe || safe === "." || safe === "..") throw new Error(`invalid releaseUnitId: ${releaseUnitId}`);
  return safe;
}

function _nowTs() { return new Date().toISOString(); }
function _newTraceId() { return `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function _normPath(p) { return p ? p.split(/[\\/]/).join("/") : null; }

function _get(releaseUnitId) {
  const s = _sessions.get(releaseUnitId);
  if (!s) throw new Error(`BrowserExecutor: release unit "${releaseUnitId}" 沒有開啟的 session — 先呼叫 open()`);
  return s;
}

/** 惰性啟動 / 取得 RU 的 session（context + 單一 page v1）*/
async function _ensureSession(releaseUnitId) {
  let s = _sessions.get(releaseUnitId);
  if (s) {
    if (!s.page || s.page.isClosed()) {
      s.page = s.ctx.pages().find(p => !p.isClosed()) || await s.ctx.newPage();
      s._hookPage(s.page);
    }
    return s;
  }
  const ru = _safeRuId(releaseUnitId);
  const { chromium } = await import("playwright");
  const profileDir = join(PROFILE_ROOT, ru);
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(join(LOG_ROOT, ru, "shots"), { recursive: true });
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome", // 用系統已安裝的 Google Chrome，不再用自帶 chromium
    headless: false, // ← 規格：讓使用者看見操作
    viewport: { width: 1280, height: 800 },
    timeout: 20_000,
  });
  ctx.setDefaultTimeout(15_000);
  ctx.setDefaultNavigationTimeout(25_000);

  const s2 = {
    ru, id: releaseUnitId, ctx, page: null, traceId: _newTraceId(),
    consoleErrors: [], failedRequests: [], log: [], openedAt: _nowTs(),
  };
  _attachHooks(s2);
  s2.page = ctx.pages().find(p => !p.isClosed()) || await ctx.newPage();
  s2._hookPage(s2.page); // ⚠️ launch 時已存在的初始 page 不會觸發 ctx.on("page") — 必須明確掛勾
  ctx.on("close", () => { _sessions.delete(releaseUnitId); }); // 使用者手動關視窗也算結案（日誌已落盤）
  _sessions.set(releaseUnitId, s2);
  return s2;
}

/** console error / pageerror / requestfailed / HTTP≥400 收集（context 層攔所有請求；console 需 page 層掛勾）*/
function _attachHooks(s) {
  const pushErr = (e) => { s.consoleErrors.push(e); if (s.consoleErrors.length > _MAX_ERRORS) s.consoleErrors.shift(); };
  const pushFailed = (f) => { s.failedRequests.push(f); if (s.failedRequests.length > _MAX_FAILED) s.failedRequests.shift(); };
  const hookPage = (page) => {
    if (page.__executorHooked) return; // 防重複掛勾
    page.__executorHooked = true;
    page.on("console", m => {
      if (m.type() === "error") pushErr({ ts: _nowTs(), url: page.url(), text: m.text().slice(0, 2000) });
    });
    page.on("pageerror", e => pushErr({ ts: _nowTs(), url: page.url(), text: String(e?.message || e).slice(0, 2000), pageError: true }));
  };
  s._hookPage = hookPage;
  s.ctx.on("page", page => { s.page = s.page || page; hookPage(page); }); // 之後新開的分頁
  s.ctx.on("requestfailed", r => pushFailed({
    ts: _nowTs(), url: r.url(), method: r.method(), failure: r.failure()?.errorText || null,
  }));
  s.ctx.on("response", res => {
    if (res.status() >= 400) pushFailed({ ts: _nowTs(), url: res.url(), method: res.request().method(), status: res.status() });
  });
}

/** 操作日誌：記憶體 + JSONL 落盤（兩者欄位一致）*/
function _log(s, { action, url, result = "ok", detail = null, error = null, screenshotPath = null, traceId = null }) {
  const rec = {
    ts: _nowTs(),
    releaseUnitId: s.id,
    traceId: traceId || s.traceId,
    url: url ?? s.page?.url() ?? null,
    action,
    result,
    detail,
    error,
    screenshotPath,
  };
  s.log.push(rec);
  if (s.log.length > _MAX_LOG) s.log.shift();
  try { appendFileSync(join(LOG_ROOT, `${s.ru}.jsonl`), JSON.stringify(rec) + "\n"); } catch { /* best effort — 不因日誌失敗擋操作 */ }
  return rec;
}

/** best-effort 截圖（自動審計用 jpeg；explicit screenshot 用 png）*/
async function _shot(s, name, { png = false, fullPage = false } = {}) {
  if (!s.page || s.page.isClosed()) return null;
  const dir = join(LOG_ROOT, s.ru, "shots");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = png ? join(dir, `${name}-${ts}.png`) : join(dir, `${name}-${ts}.jpeg`);
  try {
    await s.page.screenshot(png ? { path, fullPage } : { path, type: "jpeg", quality: 60, fullPage });
    return _normPath(path);
  } catch { return null; }
}

function _normalizeTarget(url) {
  const target = /^https?:\/\//i.test(url) ? url : "https://" + url;
  return assertSafeUrl(target);
}

// ══════════════════════════════════════════════════════════════
// Public API — 每個方法：執行 → 自動截圖（best effort）→ 落盤日誌
// ══════════════════════════════════════════════════════════════

/** open — 開啟（或重導）RU 的瀏覽器到指定 URL */
export async function open({ releaseUnitId, url, traceId } = {}) {
  if (!url) throw new Error("url required");
  const target = _normalizeTarget(url);
  const s = await _ensureSession(releaseUnitId);
  if (traceId) s.traceId = traceId;
  try {
    await s.page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
    const title = await s.page.title();
    const shot = await _shot(s, "open");
    _log(s, { action: "open", url: s.page.url(), detail: { title, target }, screenshotPath: shot, traceId });
    return { ok: true, url: s.page.url(), title, screenshot: shot, traceId: s.traceId };
  } catch (e) {
    _log(s, { action: "open", url: target, result: "error", error: e.message, traceId });
    throw e;
  }
}

/** readPage — 頁面文字內容（innerText，截斷）*/
export async function readPage({ releaseUnitId, maxLength = 8000, traceId } = {}) {
  const s = _get(releaseUnitId);
  try {
    const text = await readPageText(s.page, maxLength);
    const shot = await _shot(s, "readPage");
    _log(s, { action: "readPage", detail: { length: text.length }, screenshotPath: shot, traceId });
    return { ok: true, url: s.page.url(), text, screenshot: shot };
  } catch (e) {
    _log(s, { action: "readPage", result: "error", error: e.message, traceId });
    throw e;
  }
}

/** click — 點擊元素（selector 或可見文字）*/
export async function click({ releaseUnitId, selector, text, traceId } = {}) {
  const s = _get(releaseUnitId);
  const how = selector ? `selector=${selector}` : `text=${text}`;
  try {
    const loc = locateTarget(s.page, { selector, text });
    await loc.click();
    const shot = await _shot(s, "click");
    _log(s, { action: "click", detail: { target: how }, screenshotPath: shot, traceId });
    return { ok: true, url: s.page.url(), screenshot: shot };
  } catch (e) {
    _log(s, { action: "click", detail: { target: how }, result: "error", error: e.message, traceId });
    throw e;
  }
}

/** type — 填入輸入框（fill：取代原值）+ 可選 Enter 送出 */
export async function type({ releaseUnitId, selector, text, pressEnter = false, traceId } = {}) {
  if (typeof text !== "string" || !text.length) throw new Error("text required");
  const s = _get(releaseUnitId);
  const how = selector ? `selector=${selector}` : "focused element";
  try {
    if (selector) {
      await s.page.locator(selector).first().fill(text);
    } else {
      await s.page.keyboard.insertText(text); // 直接打在目前焦點（IME 安全路徑）
    }
    if (pressEnter) await s.page.keyboard.press("Enter");
    const shot = await _shot(s, "type");
    _log(s, { action: "type", detail: { target: how, length: text.length, pressEnter }, screenshotPath: shot, traceId });
    return { ok: true, url: s.page.url(), screenshot: shot };
  } catch (e) {
    _log(s, { action: "type", detail: { target: how }, result: "error", error: e.message, traceId });
    throw e;
  }
}

/** screenshot — 明確截圖（png，可全頁）*/
export async function screenshot({ releaseUnitId, fullPage = false, traceId } = {}) {
  const s = _get(releaseUnitId);
  try {
    const path = await _shot(s, "screenshot", { png: true, fullPage });
    _log(s, { action: "screenshot", detail: { fullPage }, screenshotPath: path, traceId });
    if (!path) throw new Error("screenshot failed (page closed?)");
    return { ok: true, url: s.page.url(), screenshot: path };
  } catch (e) {
    _log(s, { action: "screenshot", result: "error", error: e.message, traceId });
    throw e;
  }
}

/** getConsoleErrors — 本次 session 收集的 console.error + pageerror */
export async function getConsoleErrors({ releaseUnitId, traceId } = {}) {
  const s = _get(releaseUnitId);
  const items = [...s.consoleErrors];
  const shot = await _shot(s, "getConsoleErrors");
  _log(s, { action: "getConsoleErrors", detail: { count: items.length }, screenshotPath: shot, traceId });
  return { ok: true, count: items.length, items };
}

/** getFailedRequests — requestfailed（網路層失敗）+ HTTP ≥400 */
export async function getFailedRequests({ releaseUnitId, traceId } = {}) {
  const s = _get(releaseUnitId);
  const items = [...s.failedRequests];
  const shot = await _shot(s, "getFailedRequests");
  _log(s, { action: "getFailedRequests", detail: { count: items.length }, screenshotPath: shot, traceId });
  return { ok: true, count: items.length, items };
}

/** close — 關閉 RU 瀏覽器（先留最後一張畫面再關）*/
export async function close({ releaseUnitId, traceId } = {}) {
  const s = _get(releaseUnitId);
  const lastUrl = s.page?.url() || null;
  const shot = await _shot(s, "close");
  try {
    await s.ctx.close();
    _log(s, { action: "close", url: lastUrl, detail: { durationMs: Date.now() - Date.parse(s.openedAt) }, screenshotPath: shot, traceId });
    _sessions.delete(releaseUnitId);
    return { ok: true, closedAt: _nowTs(), screenshot: shot };
  } catch (e) {
    _log(s, { action: "close", url: lastUrl, result: "error", error: e.message, traceId });
    _sessions.delete(releaseUnitId);
    throw e;
  }
}

/** status — 目前開啟中的 sessions（管理/除錯用，不落盤）*/
export function status() {
  return {
    profileRoot: _normPath(PROFILE_ROOT),
    logRoot: _normPath(LOG_ROOT),
    sessions: [..._sessions.values()].map(s => ({
      releaseUnitId: s.id,
      url: s.page?.url() || null,
      traceId: s.traceId,
      openedAt: s.openedAt,
      consoleErrors: s.consoleErrors.length,
      failedRequests: s.failedRequests.length,
      logEntries: s.log.length,
    })),
  };
}

// 統一出口（符合規格的 method 名）
const BrowserExecutor = {
  open, readPage, click, type, screenshot, getConsoleErrors, getFailedRequests, close, status,
};
export default BrowserExecutor;

// ══════════════════════════════════════════════════════════════
// CLI self-test — node packages/server/src/lib/browser-executor.mjs --self-test
// （會開一個「看得見的」Chromium 視窗跑完整流程，結束自動關閉）
// ══════════════════════════════════════════════════════════════
const _isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isMain && process.argv.includes("--self-test")) {
  const RU = "selftest";
  const results = [];
  const step = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); };
  try {
    const { readFileSync } = await import("fs");
    // 1. open
    const o = await open({ releaseUnitId: RU, url: "https://example.com", traceId: "selftest-trace-001" });
    step("open example.com", o.ok && /Example Domain/i.test(o.title || ""), o.title);
    // 2. readPage
    const rp = await readPage({ releaseUnitId: RU });
    step("readPage", rp.ok && /Example Domain/i.test(rp.text), `${rp.text.length} chars`);
    // 3. click（文字定位）
    await click({ releaseUnitId: RU, text: "Learn more" });
    await new Promise(r => setTimeout(r, 1500));
    const urlNow = status().sessions.find(x => x.releaseUnitId === RU)?.url || "";
    step("click link → iana", /iana\.org/i.test(urlNow), urlNow);
    // 4. type（Wikipedia 搜尋框 + Enter）
    await open({ releaseUnitId: RU, url: "https://en.wikipedia.org" });
    await type({ releaseUnitId: RU, selector: "#searchInput", text: "TSMC", pressEnter: true });
    await new Promise(r => setTimeout(r, 1500));
    const urlAfter = status().sessions.find(x => x.releaseUnitId === RU)?.url || "";
    step("type TSMC + Enter", /TSMC/i.test(urlAfter), urlAfter);
    // 5. console error（頁面內觸發）
    const page = _get(RU).page;
    await page.evaluate(() => { console.error("selftest-console-error"); });
    const ce = await getConsoleErrors({ releaseUnitId: RU });
    step("getConsoleErrors", ce.items.some(x => /selftest-console-error/.test(x.text)), `${ce.count} errors`);
    // 6. failed request（連不通的 port）
    await page.evaluate(() => { fetch("http://127.0.0.1:59999/x").catch(() => {}); });
    await new Promise(r => setTimeout(r, 800));
    const fr = await getFailedRequests({ releaseUnitId: RU });
    step("getFailedRequests", fr.items.length > 0, `${fr.count} failed`);
    // 7. screenshot
    const sc = await screenshot({ releaseUnitId: RU });
    step("screenshot", sc.ok && existsSync(sc.screenshot), sc.screenshot);
    // 8. 日誌欄位齊全
    const logPath = join(LOG_ROOT, `${_safeRuId(RU)}.jsonl`);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").map(l => JSON.parse(l));
    const required = ["ts", "releaseUnitId", "traceId", "url", "action", "result", "screenshotPath"];
    const allFields = lines.every(l => required.every(k => k in l));
    const traceOk = lines.every(l => l.traceId === "selftest-trace-001");
    step("JSONL 欄位齊全", allFields && lines.length >= 7, `${lines.length} entries`);
    step("traceId 全程一致", traceOk);
    // 9. profile 獨立存在（非使用者 Chrome）
    const profileDir = join(PROFILE_ROOT, _safeRuId(RU));
    step("獨立 profile 存在", existsSync(profileDir), profileDir);
    // 10. close
    const c = await close({ releaseUnitId: RU });
    step("close", c.ok);
    const pass = results.filter(r => r.ok).length;
    console.log(`\n${pass}/${results.length} PASS${pass === results.length ? " 🎉" : ""}`);
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error("SELF-TEST FAILED:", e.message);
    try { await close({ releaseUnitId: RU }); } catch {}
    process.exit(1);
  }
}

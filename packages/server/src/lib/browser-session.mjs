// ── Browser Session（agent 用的內建瀏覽器）──
// 架構對標 Claude Cowork 內建瀏覽器（2026-08-26 發布）：
//   - Chromium（Playwright），不是使用者的瀏覽器，獨立 profile
//   - persistent userDataDir → 登入狀態跨重啟保留（cookie 持久化）
//   - headless、單一 context、所有 agent 共用（v1 簡化）
//   - Cowork 級共用體驗：CDP Page.startScreencast 下行串流 + 輸入回注（人與 agent 操作同一個 browser）
//
// 安全邊界：
//   - 只允許 http/https（block file: / javascript: / data:）
//   - 截圖存 DATA_HOME/logs/browser/，最新一張固定檔名 latest.png（IDE Browser tab 輪詢用）
//
// 跨平台：Playwright 支援 Windows / macOS / Linux — 統一 channel:"chrome" 操控系統已安裝的 Google Chrome
//（不再下載自帶 chromium）。找不到系統 Chrome 時工具回覆清楚指引，不炸 server。
import { mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join } from "path";

import { DATA_HOME } from "../data-home.mjs";
import { resolveBrowserChannel } from "./browser-setup.mjs";

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
    // channel: "chrome" → 用系統已安裝的 Google Chrome / Chromium，不再下載自帶 chromium
    // （Playwright 透過 CDP 操控，功能完全一致：screencast 串流/分頁/dialog/下載/clipboard 全部可用）
    const ctx = await chromium.launchPersistentContext(profileDir, {
      ...resolveBrowserChannel(), // 依系統實際安裝選 chrome/msedge/executablePath（跨平台，Edge 也能用）
      headless: true, // 畫面顯示在 coding app tab 的串流面板（Fleming：要 tab 內看得到畫面，不是彈出真實窗）
      viewport: { width: 1280, height: 800 },
      timeout: 20_000,
      permissions: ["clipboard-read", "clipboard-write"], // GitHub 等 copy 按鈕需要
      args: ["--disable-smooth-scrolling"], // 遠控必需：平滑捲動會 latching 連續 wheel 事件（第二發之後全被丢掉）
    });
    // 保險：runtime 再授權一次（舊 context 起來時沒帶 permissions 的情況）
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    // 捲軸常駐顯示（headless 預設 overlay scrollbars 自動隱藏，人看不到捲軸會以為不能捲）
    // 注意：init script 執行時 documentElement 可能還是 null（loading 早期）— 用 MutationObserver 等 <html> 出現
    await ctx.addInitScript(`(() => {
      const inject = () => {
        const de = document.documentElement;
        if (!de) return false;
        if (de.dataset.paawScrollbar) return true;
        de.dataset.paawScrollbar = "1";
        const st = document.createElement("style");
        st.textContent = "::-webkit-scrollbar{width:12px;height:12px}::-webkit-scrollbar-thumb{background:rgba(130,130,140,.75);border-radius:8px;border:2px solid transparent;background-clip:content-box}::-webkit-scrollbar-track{background:rgba(120,120,120,.12)}::-webkit-scrollbar-corner{background:rgba(120,120,120,.12)}";
        (document.head || de).appendChild(st);
        return true;
      };
      if (!inject()) {
        const mo = new MutationObserver(() => { if (inject()) mo.disconnect(); });
        mo.observe(document, { childList: true, subtree: false });
      }
    })();`).catch(() => {});
    ctx.on("close", () => { _ctx = null; _state.ready = false; _pagesById.clear(); _titlesById.clear(); _activePageRef = null; });
    ctx.setDefaultTimeout(15_000);
    ctx.setDefaultNavigationTimeout(25_000);
    // 下載：自動存 DATA_HOME/downloads + SSE 廣播（Cowork 級下載管理）
    mkdirSync(join(DATA_HOME, "downloads"), { recursive: true });
    ctx.on("download", async (dl) => {
      const entry = { id: String(++_dlSeq), filename: dl.suggestedFilename() || `download-${Date.now()}`, state: "saving", path: null, ts: Date.now() };
      _downloads.unshift(entry);
      if (_downloads.length > 30) _downloads.pop();
      broadcastToStream({ type: "download", ...entry });
      try {
        const safe = entry.filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
        const path = join(DATA_HOME, "downloads", `${Date.now()}-${safe}`);
        await dl.saveAs(path);
        entry.state = "done";
        entry.path = path.split(/[\\/]/).join("/");
      } catch (e) {
        entry.state = "failed";
      }
      broadcastToStream({ type: "download", ...entry });
    });
    // popup（target=_blank、window.open）→ 白動 wire + 切成 active（Chrome 行為：新分頁自動跳過去）
    ctx.on("page", (p) => {
      _wirePage(p);
      _activePageRef = p;
      broadcastTabs();
      ensureScreencast().then(() => kickScreencast()).catch(() => {});
    });
    // 既有分頁（persistent profile 回復）全部 wire
    for (const p of ctx.pages()) _wirePage(p);
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

/** 取得目前 active page（沒有就開新分頁）— 所有 tool/route/input 都操作 active tab */
export async function getBrowserPage(DATA_HOME) {
  const ctx = await getBrowserContext(DATA_HOME);
  let page = _resolveActive();
  if (!page) page = await ctx.newPage();
  return _wirePage(page);
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
  try { pruneBrowserShots(shotDir, 40); } catch { /* 清理失敗不影響截圖 */ }
  return _state.lastScreenshot.path;
}

/**
 * 磁碟清理（Vision Phase 4，2026-08-30）：data/logs/browser 只留最新 keep 張
 * — latest.png 永遠保留（IDE 輪詢用）；每次截圖順手清（純函數可單測）
 * @returns {{ removed: number, kept: number }}
 */
export function pruneBrowserShots(shotDir, keep = 40) {
  if (!shotDir) return { removed: 0, kept: 0 };
  let files;
  try { files = readdirSync(shotDir); } catch { return { removed: 0, kept: 0 }; }
  const shots = files
    .filter(f => /^shot-/.test(f) && /\.(png|jpe?g)$/i.test(f))
    .map(f => {
      let mtime = 0;
      try { mtime = statSync(join(shotDir, f)).mtimeMs; } catch {}
      return { f, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime); // 新 → 舊
  const victims = shots.slice(keep).map(x => x.f);
  for (const f of victims) {
    try { rmSync(join(shotDir, f), { force: true }); } catch {}
  }
  return { removed: victims.length, kept: shots.length - victims.length };
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

/** 安裝 chromium 元件後重置「未安裝」狀態（UI 不再顯示未安裝；下次操作 lazy 重啟） */
export function resetBrowserAvailability() {
  if (!_ctx && _state.available === false) {
    _state.available = null;
    _state.error = null;
  }
}

/** 未安裝 playwright 或找不到系統 Chrome 時的安裝指引（channel: "chrome" 模式） */
export const PLAYWRIGHT_INSTALL_HINT =
  "需要一個 Chrome 家族的瀏覽器（Google Chrome 或 Chromium）。\n" +
  "PAAW 不再下載自帶 chromium — 直接偵測你系統已安裝的 Chrome。\n\n" +
  "macOS：裝好 Google Chrome 即可\n" +
  "Windows：裝好 Google Chrome 即可\n" +
  "Linux：sudo apt install chromium-browser 或裝 google-chrome-stable\n" +
  "\n" +
  "另外需確認 playwright 套件已裝（PAAW root）：npm install\n" +
  "裝好後重試即可，Server 不用重啟（lazy load）。" + (process.platform === "linux" ? "\n\n（Linux 若缺系統依賴：sudo npx playwright install-deps chromium）" : "");

// ══════════════════════════════════════════════════════════════
// Cowork 級共用串流 — CDP screencast 下行 + 輸入回注上行
//
// 下行：Page.startScreencast → Page.screencastFrame 事件（base64 JPEG + viewport metadata）
//       → SSE 廣播給所有 viewer（IDE 共用模式）。ack 是 CDP 原生 flow control。
// 上行：POST /api/browser/input → page.mouse / page.keyboard 回注（點擊/滾輪/按鍵/IME 文字）
// 生命週期：第一個 SSE client 連上才開串流；全部斷線就停（headless 無人看不必耗資源）。
//          watchdog 每 2s 確認 page 身分 — agent 換頁/關頁自動重綁 CDP。
// ══════════════════════════════════════════════════════════════
// 每個 page 專用的 CDP session（wheel 回注用 — WeakMap 隨 page 回收）
const _cdpByPage = new WeakMap();

// ── 多分頁狀態（Cowork 級 tab 管理）──
let _pageSeq = 0;
const _pagesById = new Map();     // pageId → Page
const _titlesById = new Map();     // pageId → title（同步快取，title() 是 async）
let _activePageRef = null;         // 目前的 active tab
const _dialogs = new Map();       // dialogId → Dialog（等 UI 回應）
let _dialogSeq = 0;
const _downloads = [];            // 最近 30 筆下載
let _dlSeq = 0;

function _resolveActive() {
  if (_activePageRef && !_activePageRef.isClosed()) return _activePageRef;
  const open = [..._pagesById.values()].filter(p => !p.isClosed());
  _activePageRef = open[0] || null;
  return _activePageRef;
}

/** wire 一個 page：id、tab 狀態廣播、dialog、關閉清理。全部 page 都要過這個 */
function _wirePage(page) {
  if (!page || page.isClosed() || page.__paawWired) return page;
  page.__paawWired = true;
  page.__paawId = String(++_pageSeq);
  _pagesById.set(page.__paawId, page);
  const upd = () => {
    if (_resolveActive() === page) { _state.url = page.url(); _state.lastActionAt = Date.now(); }
    page.title().then(t => { _titlesById.set(page.__paawId, t || ""); broadcastTabs(); }).catch(() => {});
    broadcastTabs();
  };
  page.on("framenavigated", upd);
  page.on("close", () => {
    _pagesById.delete(page.__paawId);
    _titlesById.delete(page.__paawId);
    broadcastTabs();
  });
  page.on("dialog", (dlg) => {
    const id = String(++_dialogSeq);
    _dialogs.set(id, dlg);
    try {
      broadcastToStream({ type: "dialog", id, kind: dlg.type(), message: dlg.message(), defaultValue: dlg.defaultValue() || "" });
    } catch {}
  });
  upd();
  return page;
}

function broadcastTabs() {
  broadcastToStream({ type: "tabs", ...browserTabs() });
}

export function browserTabs() {
  const active = _resolveActive();
  const tabs = [..._pagesById.entries()]
    .filter(([, p]) => !p.isClosed())
    .map(([id, p]) => ({ id, url: p.url(), title: _titlesById.get(id) || "" }));
  return { tabs, activeId: active ? active.__paawId : null };
}

export async function browserNewTab(DATA_HOME, url) {
  const ctx = await getBrowserContext(DATA_HOME);
  const page = _wirePage(await ctx.newPage());
  _activePageRef = page;
  if (url) {
    assertSafeUrl(url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  }
  await ensureScreencast().then(() => kickScreencast()).catch(() => {});
  broadcastTabs();
  return { id: page.__paawId, url: page.url() };
}

export async function browserSwitchTab(id) {
  const page = _pagesById.get(String(id));
  if (!page || page.isClosed()) throw new Error(`tab not found: ${id}`);
  _activePageRef = page;
  _state.url = page.url();
  await ensureScreencast().then(() => kickScreencast()).catch(() => {});
  broadcastTabs();
  return browserTabs();
}

export async function browserCloseTab(DATA_HOME, id) {
  const page = _pagesById.get(String(id));
  if (!page || page.isClosed()) throw new Error(`tab not found: ${id}`);
  const wasActive = _resolveActive() === page;
  if (_pagesById.size <= 1) throw new Error("不能關最後一個分頁（瀏覽器至少保留一頁）");
  await page.close();
  if (wasActive) {
    _activePageRef = null;
    await getBrowserPage(DATA_HOME); // 解出下一個 active 並確保 screencast 重綁
    await ensureScreencast().then(() => kickScreencast()).catch(() => {});
  }
  broadcastTabs();
  return browserTabs();
}

/** 導航控制：back / forward / reload */
export async function browserNavAction(action) {
  const page = await getBrowserPage(DATA_HOME);
  const opts = { waitUntil: "domcontentloaded", timeout: 20000 };
  if (action === "back") await page.goBack(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else if (action === "forward") await page.goForward(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else if (action === "reload") await page.reload(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else throw new Error(`Unknown nav action: ${action}`);
  await takeScreenshot(DATA_HOME, page).catch(() => {});
  await kickScreencast().catch(() => {});
  return { url: page.url() };
}

export function browserDownloads() { return _downloads.map(d => ({ ...d })); }

export async function browserHandleDialog(id, action, text) {
  const dlg = _dialogs.get(String(id));
  if (!dlg) throw new Error(`dialog not found: ${id}`);
  _dialogs.delete(String(id));
  if (action === "accept") await dlg.accept(text || undefined).catch(() => {});
  else await dlg.dismiss().catch(() => {});
  broadcastToStream({ type: "dialog", id: String(id), closed: true });
  return { ok: true };
}

const _stream = {
  clients: new Set(),      // SSE res 物件
  cdp: null,               // CDP session（綁定 _castPage）
  castPage: null,          // 目前串流的 page
  starting: null,          // 防併發啟動 promise
  watchdog: null,          // setInterval handle
  lastFrameAt: 0,          // 廣播節流（≥50ms 一張，≈20fps 上限）
};

export function streamClientCount() { return _stream.clients.size; }

/** SSE client 上線 — 有 viewer 才開串流；馬上 kick 一張畫面給新 viewer */
export function attachStreamClient(res) {
  _stream.clients.add(res);
  _ensureWatchdog();
  ensureScreencast().then(() => kickScreencast()).catch(() => {});
  broadcastTabs(); // 新 viewer 馬上拿到分頁快照
}

/** SSE client 離線 — 最後一個斷線就停串流 */
export function detachStreamClient(res) {
  _stream.clients.delete(res);
  if (_stream.clients.size === 0) stopScreencast();
}

/** 廣播 payload 給所有 SSE client（斷線的自動剔除）*/
export function broadcastToStream(payload) {
  for (const res of _stream.clients) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch {
      _stream.clients.delete(res);
    }
  }
}

/** 確保 screencast 綁在「目前」page 上（page 換了/關了就重綁）*/
export async function ensureScreencast() {
  const page = await getBrowserPage(DATA_HOME);
  trackPage(page);
  if (_stream.cdp && _stream.castPage === page && !page.isClosed()) return; // 已綁定
  if (_stream.starting) return _stream.starting;
  _stream.starting = (async () => {
    if (_stream.cdp) { try { await _stream.cdp.detach(); } catch {} _stream.cdp = null; }
    const cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", async (ev) => {
      const { data, metadata = {}, sessionId } = ev;
      const now = Date.now();
      if (now - _stream.lastFrameAt >= 50) { // 廣播節流；ack 永遠送（flow control）
        _stream.lastFrameAt = now;
        // 附上 document 層 scroll 狀態（headless Chrome overlay scrollbar 在 screencast 圖裡看不見 → UI 畫自訂 scrollbar）
        // 2026-09-04：加 hScroll 水平捲動狀態 — UI 畫水平捲軸
        let scroll = { top: 0, max: 0, h: 0, left: 0, maxX: 0, w: 0 };
        try {
          scroll = await page.evaluate(() => {
            const p = window.scrollY;
            const sh = document.documentElement.scrollHeight;
            const ch = document.documentElement.clientHeight;
            const lp = window.scrollX;
            const sw = document.documentElement.scrollWidth;
            const cw = document.documentElement.clientWidth;
            return { top: p, max: Math.max(0, sh - ch), h: ch, left: lp, maxX: Math.max(0, sw - cw), w: cw };
          }).catch(() => scroll);
        } catch {}
        broadcastToStream({
          type: "frame",
          jpeg: data,
          w: metadata.deviceWidth || 1280,
          h: metadata.deviceHeight || 800,
          url: page.url(),
          scroll,
        });
      }
      try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
    _stream.cdp = cdp;
    _stream.castPage = page;
  })().catch(err => {
    _stream.starting = null;
    throw err;
  });
  return _stream.starting;
}

/** 強制重發一張畫面（新 viewer 連上 / 導航後用；CDP 重發 start 會立即產生一張 frame）*/
export async function kickScreencast() {
  if (!_stream.cdp) return;
  try {
    await _stream.cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1,
    });
  } catch {}
}

function _ensureWatchdog() {
  if (_stream.watchdog) return;
  _stream.watchdog = setInterval(() => {
    if (_stream.clients.size === 0) return; // stopScreencast 會清
    ensureScreencast().catch(() => {}); // page 換了自動重綁
  }, 2000);
}

function stopScreencast() {
  if (_stream.watchdog) { clearInterval(_stream.watchdog); _stream.watchdog = null; }
  const cdp = _stream.cdp;
  _stream.cdp = null;
  _stream.castPage = null;
  _stream.starting = null;
  if (cdp) {
    cdp.send("Page.stopScreencast", {}).catch(() => {});
    cdp.detach().catch(() => {});
  }
}

// ── 輸入回注（人的滑鼠/鍵盤 → agent 的 browser）──
const _BUTTON_MAP = { 0: "left", 1: "middle", 2: "right" };

export async function applyBrowserInput(evt) {
  if (!evt || typeof evt.type !== "string") throw new Error("input event requires `type`");
  const page = await getBrowserPage(DATA_HOME);
  trackPage(page);
  const mods = [];
  if (evt.modifiers?.alt) mods.push("Alt");
  if (evt.modifiers?.ctrl) mods.push("Control");
  if (evt.modifiers?.shift) mods.push("Shift");
  if (evt.modifiers?.meta) mods.push("Meta");
  const modOpt = mods.length ? mods : undefined;
  const button = _BUTTON_MAP[evt.button] || "left";
  switch (evt.type) {
    case "mousedown":
      if (!Number.isFinite(evt.x) || !Number.isFinite(evt.y)) throw new Error("mousedown requires x,y");
      await page.mouse.move(evt.x, evt.y, { steps: 1 });
      await page.mouse.down({ button, modifiers: modOpt });
      break;
    case "mouseup":
      await page.mouse.up({ button, modifiers: modOpt });
      break;
    case "mousemove":
      if (!Number.isFinite(evt.x) || !Number.isFinite(evt.y)) break;
      await page.mouse.move(evt.x, evt.y, { steps: 1 });
      break;
    case "contextmenu":
      // 右鍵回注：mouse.click(right) — Playwright 會產生 mousedown/mouseup + 觸發網頁 contextmenu listener
      // （Fleming：很多網頁自訂右鍵功能，必須真測得到）
      if (!Number.isFinite(evt.x) || !Number.isFinite(evt.y)) throw new Error("contextmenu requires x,y");
      await page.mouse.move(evt.x, evt.y, { steps: 1 });
      await page.mouse.click(evt.x, evt.y, { button: "right", modifiers: modOpt });
      break;
    case "wheel": {
      // CDP mouseWheel 有 latching 問題：第一發有效，之後連續發會被 Chromium 丢掉（遠控場景常見坑）
      // 改走 scrollBy + 「滑鼠位置下最近可捲祖先」— noVNC 系遠控標準解法，確定性 100%
      const dx = evt.deltaX || 0, dy = evt.deltaY || 0;
      await page.evaluate(([x, y, ddx, ddy]) => {
        const doc = document.scrollingElement || document.documentElement;
        let t = null;
        try {
          let n = document.elementFromPoint(x, y);
          while (n && n !== doc) {
            if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) { t = n; break; }
            n = n.parentElement;
          }
        } catch {}
        (t || doc).scrollBy({ top: ddy, left: ddx });
      }, [Number.isFinite(evt.x) ? evt.x : 640, Number.isFinite(evt.y) ? evt.y : 400, dx, dy]);
      break;
    }
    case "key": // 特殊鍵/組合鍵 — Playwright key name（"Enter" / "Control+a"）
      if (!evt.key) throw new Error("key event requires `key`");
      await page.keyboard.press(evt.key);
      break;
    case "text": // 純文字插入（含 IME 中文 — insertText 不經鍵盤佈局）
      if (!evt.text) break;
      await page.keyboard.insertText(String(evt.text).slice(0, 2000));
      break;
    default:
      throw new Error(`Unknown input type: ${evt.type}`);
  }
  _state.lastActionAt = Date.now();
}

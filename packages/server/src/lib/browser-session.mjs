// ── Browser Session（agent 用的內建瀏覽器）──
// 架構對標 Claude Cowork 內建瀏覽器（2026-08-26 發布）：
//   - Chromium（Playwright），不是使用者的瀏覽器，獨立 profile
//   - persistent userDataDir → 登入狀態跨重啟保留（cookie 持久化）
//   - headless、每個 instance 一個 context
//   - Cowork 級共用體驗：CDP Page.startScreencast 下行串流 + 輸入回注（人與 agent 操作同一個 browser）
//
// 2026-09-12 多實體（Fleming：兩個 Chrome 視窗各開一個 coding app tab，
// 分別開發不同 release unit，browser 不能共用實體互相打架）：
//   - browser instance 以「release unit 路徑」為 key（resolveBrowserKey(ru) → slug）
//   - 不同 RU → 不同 Chromium instance（獨立 profile/login/分頁/串流）
//   - 同 RU 的 UI 視窗 + agent tool 操作同一個 instance（人看 agent 操作的閉環不變）
//   - 沒帶 ru 的呼叫 → "default" instance（沿用舊 browser-profile，登入狀態無縫保留）
//   - 閒置自動回收：無 viewer 且 30 分鐘無動作 → 關 instance（profile 落盤，重開便宜）
//
// 安全邊界：
//   - 只允許 http/https（block file: / javascript: / data:）
//   - 截圖存 LOG_HOME/browser/（default）或 LOG_HOME/browser/<key>/，最新一張固定檔名 latest.png
//
// 2026-09-12 native <select> 下拉（Fleming：下拉式選單不能用）：
//   - headless screencast 看不到 OS 級 select popup → 注入自訂 in-page dropdown
//   - 點 <select> 開客製面板（DOM 渲染 → screencast 看得到、點得到、截圖吃得到）
//   - agent 端另配 browser_select tool（selectOption）
//
// 跨平台：Playwright 支援 Windows / macOS / Linux — 統一 channel:"chrome" 操控系統已安裝的 Google Chrome
//（不再下載自帶 chromium）。找不到系統 Chrome 時工具回覆清楚指引，不炸 server。
import { mkdirSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";

import { DATA_HOME, LOG_HOME } from "../data-home.mjs";
import { resolveBrowserChannel } from "./browser-setup.mjs";

// ── Instance key：release unit 路徑 → 安全 slug ──
export function resolveBrowserKey(ru) {
  if (!ru || typeof ru !== "string") return "default";
  const slug = ru.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return slug || "default";
}

const IDLE_CLOSE_MS = 30 * 60 * 1000; // 30 分鐘無 viewer + 無動作 → 回收 instance

// ══════════════════════════════════════════════════════════════
// 多實體狀態管理
// ══════════════════════════════════════════════════════════════
const _instances = new Map(); // key → instance state bundle

function _newInstance(key) {
  return {
    key,
    ctx: null,          // Playwright BrowserContext
    launching: null,    // 進行中的 launch promise（防併發雙開）
    state: {
      ready: false,
      available: null,  // null=未檢查, true/false
      error: null,
      url: null,
      title: null,
      lastActionAt: null,
      lastScreenshot: null, // { path, ts }
    },
    // 多分頁狀態
    pageSeq: 0,
    pagesById: new Map(),   // pageId → Page
    titlesById: new Map(),  // pageId → title（同步快取）
    activePageRef: null,    // 目前的 active tab
    dialogs: new Map(),     // dialogId → Dialog（等 UI 回應）
    dialogSeq: 0,
    downloads: [],          // 最近 30 筆下載
    dlSeq: 0,
    // 2026-09-12 操作錄影（Fleming：agent 操作 browser 我看不到 — 分頁 refresh 後什麼都不剩）
    // 每一步（agent tool / 人的回注）自動記錄 + 截圖，UI 可回放
    actionLog: [],          // [{seq, ts, actor: "agent"|"human", kind, summary, url, shot}]
    actionSeq: 0,
    // 串流（per instance — 兩個 Chrome 視窗看不同的 browser）
    stream: {
      clients: new Set(),   // SSE res 物件
      cdp: null,            // CDP session（綁定 castPage）
      castPage: null,       // 目前串流的 page
      starting: null,       // 防併發啟動 promise
      watchdog: null,       // setInterval handle
      lastFrameAt: 0,       // 廣播節流（≥50ms 一張，≈20fps 上限）
    },
    idleTimer: null,
  };
}

export function _getInst(key = "default") {
  let inst = _instances.get(key);
  if (!inst) { inst = _newInstance(key); _instances.set(key, inst); _loadActionLog(inst); }
  return inst;
}

// ── 操作錄影：紀錄每一步（agent tool / 人的操作）+ 步驟截圖，UI 可回放 ──
const ACTION_LOG_MAX = 200;   // 記憶體/檔案保留上限（筆）
const ACT_SHOT_MAX = 120;     // act-*.png 保留上限（shot-*.png 是即時截圖輪替，另計）

function _actionFile(key) { return join(browserShotDir(key), "actions.jsonl"); }

function _loadActionLog(inst) {
  try {
    const raw = readFileSync(_actionFile(inst.key), "utf-8");
    const lines = raw.split("\n").filter(l => l.trim());
    const start = Math.max(0, lines.length - ACTION_LOG_MAX);
    for (const line of lines.slice(start)) {
      try {
        const e = JSON.parse(line);
        inst.actionLog.push(e);
        if (e.seq > inst.actionSeq) inst.actionSeq = e.seq;
      } catch {}
    }
  } catch { /* 無檔案 = 首次 */ }
}

/** 記錄一步操作（actor: "agent" | "human"）。shot = 檔名（act-*.png，跟 actions.jsonl 同目錄） */
export function recordBrowserAction(key = "default", { actor, kind, summary, url, shot }) {
  const inst = _getInst(key);
  const entry = {
    seq: ++inst.actionSeq,
    ts: Date.now(),
    actor: actor === "human" ? "human" : "agent",
    kind: String(kind || "action").slice(0, 24),
    summary: String(summary || "").slice(0, 200),
    url: url ? String(url).slice(0, 300) : null,
    shot: shot ? String(shot).slice(0, 120) : null,
  };
  inst.actionLog.push(entry);
  if (inst.actionLog.length > ACTION_LOG_MAX) inst.actionLog.shift();
  // 持久化：JSONL append；超過 2x 上限就重寫裁切（小檔同步寫可接受）
  try {
    mkdirSync(browserShotDir(key), { recursive: true });
    const f = _actionFile(key);
    appendFileSync(f, JSON.stringify(entry) + "\n");
    if (inst.actionLog.length >= ACTION_LOG_MAX && (inst.actionSeq % 20) === 0) {
      writeFileSync(f, inst.actionLog.map(e => JSON.stringify(e)).join("\n") + "\n");
    }
  } catch { /* 紀錄失敗不影響操作 */ }
  if (shot) { try { _pruneActShots(browserShotDir(key)); } catch {} }
  return entry;
}

/** 回放用：最後 limit 筆（時間序，舊→新） */
export function browserActions(key = "default", limit = 100) {
  const inst = _instances.get(key);
  if (!inst) return [];
  return inst.actionLog.slice(-Math.min(limit, ACTION_LOG_MAX)).map(e => ({ ...e }));
}

function _pruneActShots(dir) {
  let files;
  try { files = readdirSync(dir); } catch { return; }
  const acts = files
    .filter(f => /^act-/.test(f) && /\.png$/i.test(f))
    .map(f => { let m = 0; try { m = statSync(join(dir, f)).mtimeMs; } catch {} return { f, m }; })
    .sort((a, b) => b.m - a.m);
  for (const { f } of acts.slice(ACT_SHOT_MAX)) {
    try { rmSync(join(dir, f), { force: true }); } catch {}
  }
}

/** agent 步驟截圖：存 act-<seq>.png（不進入 shot-* 輪替，回放專用，獨立保留上限） */
export async function takeActionShot(key = "default", page) {
  const inst = _getInst(key);
  const dir = browserShotDir(key);
  mkdirSync(dir, { recursive: true });
  const name = `act-${String(inst.actionSeq + 1).padStart(4, "0")}.png`;
  try {
    await page.screenshot({ path: join(dir, name) });
    return name;
  } catch { return null; }
}

/** 目錄配置：default 沿用舊路徑（登入狀態/截圖輪詢無縫）；per-RU 用子目錄 */
function _profileDir(key) {
  return key === "default" ? join(DATA_HOME, "browser-profile") : join(DATA_HOME, "browser-profile", key);
}
export function browserShotDir(key = "default") {
  return key === "default" ? join(LOG_HOME, "browser") : join(LOG_HOME, "browser", key);
}

export function browserState(key = "default") {
  const inst = _instances.get(key);
  return inst ? { ...inst.state, lastActionAt: inst.state.lastActionAt, key } : { ready: false, available: null, error: null, url: null, title: null, lastActionAt: null, lastScreenshot: null, key };
}

/** 全部 instance 狀態（管理/debug 用） */
export function allBrowserStates() {
  return [..._instances.keys()].map(k => browserState(k));
}

/** URL 安全檢查：只放行 http/https */
export function assertSafeUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked protocol ${u.protocol} — only http/https allowed`);
  }
  return u.href;
}

// ── native <select> 客製下拉（init script — 每個 page 每次導航注入）──
// headless 的 OS 級 select popup 不會出現在 screencast/截圖 → 換成 in-page DOM 面板。
// 只攔 single-select（multiple/size>1 的清單本來就內嵌在頁面裡，正常點擊可操作）。
const SELECT_DROPDOWN_INIT = `(() => {
  if (window.__paawSelectDD) return; window.__paawSelectDD = 1;
  let panel = null;
  const closePanel = () => { if (panel) { panel.remove(); panel = null; } };
  const openPanel = (sel) => {
    closePanel();
    const rect = sel.getBoundingClientRect();
    panel = document.createElement("div");
    panel.setAttribute("data-paaw-select-dd", "1");
    panel.style.cssText = "position:fixed;z-index:2147483647;background:#fff;border:1px solid #c8c8ce;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);min-width:" + Math.max(120, rect.width) + "px;max-height:240px;overflow-y:auto;overscroll-behavior:contain;font:13px/1.4 system-ui,sans-serif;color:#202124;";
    const below = rect.bottom + 240 <= window.innerHeight;
    panel.style.top = (below ? rect.bottom + 4 : Math.max(8, rect.top - 244)) + "px";
    panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(120, rect.width) - 8)) + "px";
    for (const opt of sel.options) {
      const row = document.createElement("div");
      row.textContent = opt.textContent || opt.value;
      row.style.cssText = "padding:7px 14px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" + (opt.disabled ? "color:#9aa0a6;cursor:default;" : "");
      if (opt.selected) row.style.background = "#e8f0fe";
      row.onmouseenter = () => { if (!opt.disabled) row.style.background = "#f1f3f4"; };
      row.onmouseleave = () => { row.style.background = opt.selected ? "#e8f0fe" : ""; };
      row.onmousedown = (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (opt.disabled) return;
        sel.value = opt.value;
        opt.selected = true;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        closePanel();
      };
      panel.appendChild(row);
    }
    document.documentElement.appendChild(panel);
  };
  document.addEventListener("mousedown", (ev) => {
    const t = ev.target;
    if (panel && !panel.contains(t) && t !== panel) closePanel();
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.multiple || t.size > 1) return; // 清單式 multi-select：正常操作即可
    ev.preventDefault(); ev.stopPropagation(); // 不讓 Chromium 開 OS popup（screencast 看不到）
    openPanel(t);
  }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePanel(); }, true);
  window.addEventListener("scroll", closePanel, true);
  window.addEventListener("resize", closePanel, true);
})();`;

/** 惰性啟動 persistent browser context（per instance）*/
export async function getBrowserContext(key = "default", DATA_HOME_ARG) {
  const inst = _getInst(key);
  if (inst.ctx) return inst.ctx;
  if (inst.launching) return inst.launching;
  inst.launching = (async () => {
    const { chromium } = await import("playwright");
    const profileDir = _profileDir(key);
    const shotDir = browserShotDir(key);
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
    // 2026-09-12：native select 客製下拉（screencast 看得到、點得到）
    await ctx.addInitScript(SELECT_DROPDOWN_INIT).catch(() => {});
    ctx.on("close", () => {
      inst.ctx = null; inst.state.ready = false;
      inst.pagesById.clear(); inst.titlesById.clear(); inst.activePageRef = null;
    });
    ctx.setDefaultTimeout(15_000);
    ctx.setDefaultNavigationTimeout(25_000);
    // 下載：自動存 DATA_HOME/downloads + SSE 廣播（Cowork 級下載管理）
    mkdirSync(join(DATA_HOME, "downloads"), { recursive: true });
    ctx.on("download", async (dl) => {
      const entry = { id: String(++inst.dlSeq), filename: dl.suggestedFilename() || `download-${Date.now()}`, state: "saving", path: null, ts: Date.now() };
      inst.downloads.unshift(entry);
      if (inst.downloads.length > 30) inst.downloads.pop();
      broadcastToStream(inst, { type: "download", ...entry });
      try {
        const safe = entry.filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
        const path = join(DATA_HOME, "downloads", `${Date.now()}-${safe}`);
        await dl.saveAs(path);
        entry.state = "done";
        entry.path = path.split(/[\\/]/).join("/");
      } catch (e) {
        entry.state = "failed";
      }
      broadcastToStream(inst, { type: "download", ...entry });
    });
    // popup（target=_blank、window.open）→ 自動 wire + 切成 active（Chrome 行為：新分頁自動跳過去）
    ctx.on("page", (p) => {
      _wirePage(inst, p);
      inst.activePageRef = p;
      broadcastTabs(inst);
      ensureScreencast(inst).then(() => kickScreencast(inst)).catch(() => {});
    });
    // 既有分頁（persistent profile 回復）全部 wire
    for (const p of ctx.pages()) _wirePage(inst, p);
    inst.ctx = ctx;
    inst.state.ready = true;
    inst.state.available = true;
    inst.state.error = null;
    _armIdleClose(inst);
    return ctx;
  })().catch(err => {
    inst.state.available = false;
    inst.state.error = err?.message || String(err);
    inst.launching = null;
    throw err;
  });
  return inst.launching;
}

// ── 閒置回收：無 viewer + 30 分鐘無動作 → 關 context（profile 落盤保留）──
function _armIdleClose(inst) {
  if (inst.idleTimer) clearInterval(inst.idleTimer);
  inst.idleTimer = setInterval(() => {
    if (inst.stream.clients.size > 0) return; // 有人看就留著
    const last = Math.max(inst.state.lastActionAt || 0, ...[...inst.downloads.map(d => d.ts || 0), 0]);
    if (Date.now() - last < IDLE_CLOSE_MS) return;
    clearInterval(inst.idleTimer); inst.idleTimer = null;
    try { inst.ctx?.close(); } catch {}
    _instances.delete(inst.key);
  }, 60_000).unref?.();
}

/** 取得目前 active page（沒有就開新分頁）— 所有 tool/route/input 都操作 active tab */
export async function getBrowserPage(key = "default", DATA_HOME_ARG) {
  const inst = _getInst(key);
  const ctx = await getBrowserContext(key);
  let page = _resolveActive(inst);
  if (!page) page = await ctx.newPage();
  return _wirePage(inst, page);
}

/** 截圖：存時間戳檔 + 覆蓋 latest.png（IDE 輪詢用；per-instance 目錄）*/
export async function takeScreenshot(key = "default", page) {
  const shotDir = browserShotDir(key);
  mkdirSync(shotDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const inst = _getInst(key);
  const path = join(shotDir, `shot-${ts}.png`);
  await page.screenshot({ path, fullPage: false });
  const { copyFileSync } = await import("fs");
  try { copyFileSync(path, join(shotDir, "latest.png")); } catch { /* best effort */ }
  inst.state.lastScreenshot = { path: path.split(/[\\/]/).join("/"), ts: Date.now() };
  try { pruneBrowserShots(shotDir, 40); } catch { /* 清理失敗不影響截圖 */ }
  return inst.state.lastScreenshot.path;
}

/**
 * 磁碟清理（Vision Phase 4，2026-08-30）：只留最新 keep 張
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
export function trackPage(key = "default", page) {
  const inst = _getInst(key);
  const upd = () => {
    inst.state.url = page.url();
    inst.state.title = null;
    page.title().then(t => { inst.state.title = t; }).catch(() => {});
    inst.state.lastActionAt = Date.now();
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
export function resetBrowserAvailability(key = "default") {
  const inst = _instances.get(key);
  if (!inst) return;
  if (!inst.ctx && inst.state.available === false) {
    inst.state.available = null;
    inst.state.error = null;
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
// Cowork 級共用串流 — CDP screencast 下行 + 輸入回注上行（per instance）
//
// 下行：Page.startScreencast → Page.screencastFrame 事件（base64 JPEG + viewport metadata）
//       → SSE 廣播給該 instance 的所有 viewer。ack 是 CDP 原生 flow control。
// 上行：POST /api/browser/input → page.mouse / page.keyboard 回注（點擊/滾輪/按鍵/IME 文字）
// 生命週期：第一個 SSE client 連上才開串流；全部斷線就停（headless 無人看不必耗資源）。
//          watchdog 每 2s 確認 page 身分 — agent 換頁/關頁自動重綁 CDP。
// ══════════════════════════════════════════════════════════════

function _resolveActive(inst) {
  if (inst.activePageRef && !inst.activePageRef.isClosed()) return inst.activePageRef;
  const open = [...inst.pagesById.values()].filter(p => !p.isClosed());
  inst.activePageRef = open[0] || null;
  return inst.activePageRef;
}

/** wire 一個 page：id、tab 狀態廣播、dialog、關閉清理。全部 page 都要過這個 */
function _wirePage(inst, page) {
  if (!page || page.isClosed() || page.__paawWired) return page;
  page.__paawWired = true;
  page.__paawId = String(++inst.pageSeq);
  inst.pagesById.set(page.__paawId, page);
  const upd = () => {
    if (_resolveActive(inst) === page) { inst.state.url = page.url(); inst.state.lastActionAt = Date.now(); }
    page.title().then(t => { inst.titlesById.set(page.__paawId, t || ""); broadcastTabs(inst); }).catch(() => {});
    broadcastTabs(inst);
  };
  page.on("framenavigated", upd);
  page.on("close", () => {
    inst.pagesById.delete(page.__paawId);
    inst.titlesById.delete(page.__paawId);
    broadcastTabs(inst);
  });
  page.on("dialog", (dlg) => {
    const id = String(++inst.dialogSeq);
    inst.dialogs.set(id, dlg);
    try {
      broadcastToStream(inst, { type: "dialog", id, kind: dlg.type(), message: dlg.message(), defaultValue: dlg.defaultValue() || "" });
    } catch {}
  });
  upd();
  return page;
}

function broadcastTabs(inst) {
  broadcastToStream(inst, { type: "tabs", ...browserTabs(inst.key) });
}

export function browserTabs(key = "default") {
  const inst = _instances.get(key);
  if (!inst) return { tabs: [], activeId: null };
  const active = _resolveActive(inst);
  const tabs = [...inst.pagesById.entries()]
    .filter(([, p]) => !p.isClosed())
    .map(([id, p]) => ({ id, url: p.url(), title: inst.titlesById.get(id) || "" }));
  return { tabs, activeId: active ? active.__paawId : null };
}

export async function browserNewTab(key = "default", url) {
  const inst = _getInst(key);
  const ctx = await getBrowserContext(key);
  const page = _wirePage(inst, await ctx.newPage());
  inst.activePageRef = page;
  if (url) {
    assertSafeUrl(url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  }
  await ensureScreencast(inst).then(() => kickScreencast(inst)).catch(() => {});
  broadcastTabs(inst);
  return { id: page.__paawId, url: page.url() };
}

export async function browserSwitchTab(key = "default", id) {
  const inst = _instances.get(key) || _getInst(key);
  const page = inst.pagesById.get(String(id));
  if (!page || page.isClosed()) throw new Error(`tab not found: ${id}`);
  inst.activePageRef = page;
  inst.state.url = page.url();
  await ensureScreencast(inst).then(() => kickScreencast(inst)).catch(() => {});
  broadcastTabs(inst);
  return browserTabs(key);
}

export async function browserCloseTab(key = "default", id) {
  const inst = _instances.get(key) || _getInst(key);
  const page = inst.pagesById.get(String(id));
  if (!page || page.isClosed()) throw new Error(`tab not found: ${id}`);
  const wasActive = _resolveActive(inst) === page;
  if (inst.pagesById.size <= 1) throw new Error("不能關最後一個分頁（瀏覽器至少保留一頁）");
  await page.close();
  if (wasActive) {
    inst.activePageRef = null;
    await getBrowserPage(key); // 解出下一個 active 並確保 screencast 重綁
    const cur = _resolveActive(inst);
    if (cur) await ensureScreencast(inst).then(() => kickScreencast(inst)).catch(() => {});
  }
  broadcastTabs(inst);
  return browserTabs(key);
}

/** 導航控制：back / forward / reload */
export async function browserNavAction(key = "default", action) {
  const page = await getBrowserPage(key);
  const opts = { waitUntil: "domcontentloaded", timeout: 20000 };
  if (action === "back") await page.goBack(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else if (action === "forward") await page.goForward(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else if (action === "reload") await page.reload(opts).catch(e => { if (!/timed out/i.test(String(e))) throw e; });
  else throw new Error(`Unknown nav action: ${action}`);
  await takeScreenshot(key, page).catch(() => {});
  const inst = _instances.get(key);
  if (inst) await kickScreencast(inst).catch(() => {});
  return { url: page.url() };
}

export function browserDownloads(key = "default") {
  const inst = _instances.get(key);
  return inst ? inst.downloads.map(d => ({ ...d })) : [];
}

export async function browserHandleDialog(key = "default", id, action, text) {
  const inst = _instances.get(key) || _getInst(key);
  const dlg = inst.dialogs.get(String(id));
  if (!dlg) throw new Error(`dialog not found: ${id}`);
  inst.dialogs.delete(String(id));
  if (action === "accept") await dlg.accept(text || undefined).catch(() => {});
  else await dlg.dismiss().catch(() => {});
  broadcastToStream(inst, { type: "dialog", id: String(id), closed: true });
  return { ok: true };
}

export function streamClientCount() {
  let n = 0;
  for (const inst of _instances.values()) n += inst.stream.clients.size;
  return n;
}

/** SSE client 上線 — 有 viewer 才開串流；馬上 kick 一張畫面給新 viewer */
export function attachStreamClient(key = "default", res) {
  const inst = _getInst(key);
  inst.stream.clients.add(res);
  _ensureWatchdog(inst);
  ensureScreencast(inst).then(() => kickScreencast(inst)).catch(() => {});
  broadcastTabs(inst); // 新 viewer 馬上拿到分頁快照
}

/** SSE client 離線 — 最後一個斷線就停串流 */
export function detachStreamClient(key = "default", res) {
  const inst = _instances.get(key);
  if (!inst) return;
  inst.stream.clients.delete(res);
  if (inst.stream.clients.size === 0) stopScreencast(inst);
}

/** 廣播 payload 給該 instance 的所有 SSE client（斷線的自動剔除）*/
export function broadcastToStream(instOrKey, payload) {
  const inst = typeof instOrKey === "string" ? _instances.get(instOrKey) : instOrKey;
  if (!inst) return;
  for (const res of inst.stream.clients) {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (typeof res.flush === "function") res.flush();
    } catch {
      inst.stream.clients.delete(res);
    }
  }
}

/** 確保 screencast 綁在「目前」page 上（page 換了/關了就重綁）*/
export async function ensureScreencast(inst) {
  const page = await getBrowserPage(inst.key);
  trackPage(inst.key, page);
  if (inst.stream.cdp && inst.stream.castPage === page && !page.isClosed()) return; // 已綁定
  if (inst.stream.starting) return inst.stream.starting;
  inst.stream.starting = (async () => {
    if (inst.stream.cdp) { try { await inst.stream.cdp.detach(); } catch {} inst.stream.cdp = null; }
    const cdp = await page.context().newCDPSession(page);
    cdp.on("Page.screencastFrame", async (ev) => {
      const { data, metadata = {}, sessionId } = ev;
      const now = Date.now();
      if (now - inst.stream.lastFrameAt >= 50) { // 廣播節流；ack 永遠送（flow control）
        inst.stream.lastFrameAt = now;
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
        broadcastToStream(inst, {
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
    inst.stream.cdp = cdp;
    inst.stream.castPage = page;
  })().catch(err => {
    inst.stream.starting = null;
    throw err;
  });
  return inst.stream.starting;
}

/** 強制重發一張畫面（新 viewer 連上 / 導航後用；CDP 重發 start 會立即產生一張 frame）*/
export async function kickScreencast(instOrKey) {
  const inst = typeof instOrKey === "string" ? _instances.get(instOrKey) : instOrKey;
  if (!inst || !inst.stream.cdp) return;
  try {
    await inst.stream.cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1,
    });
  } catch {}
}

function _ensureWatchdog(inst) {
  if (inst.stream.watchdog) return;
  inst.stream.watchdog = setInterval(() => {
    if (inst.stream.clients.size === 0) return; // stopScreencast 會清
    ensureScreencast(inst).catch(() => {}); // page 換了自動重綁
  }, 2000);
}

function stopScreencast(inst) {
  if (inst.stream.watchdog) { clearInterval(inst.stream.watchdog); inst.stream.watchdog = null; }
  const cdp = inst.stream.cdp;
  inst.stream.cdp = null;
  inst.stream.castPage = null;
  inst.stream.starting = null;
  if (cdp) {
    cdp.send("Page.stopScreencast", {}).catch(() => {});
    cdp.detach().catch(() => {});
  }
}

// ── 輸入回注（人的滑鼠/鍵盤 → agent 的 browser；per instance）──
const _BUTTON_MAP = { 0: "left", 1: "middle", 2: "right" };

export async function applyBrowserInput(key = "default", evt) {
  if (!evt || typeof evt.type !== "string") throw new Error("input event requires `type`");
  const page = await getBrowserPage(key);
  trackPage(key, page);
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
  const inst = _instances.get(key);
  if (inst) inst.state.lastActionAt = Date.now();
  // 操作錄影：人的操作也記錄（只記有意義的動作；mousemove/mouseup/wheel 太頻繁不記）
  if (evt.type === "mousedown") recordBrowserAction(key, { actor: "human", kind: "click", summary: `點擊 (${Math.round(evt.x)},${Math.round(evt.y)})`, url: page.url() });
  else if (evt.type === "contextmenu") recordBrowserAction(key, { actor: "human", kind: "contextmenu", summary: `右鍵 (${Math.round(evt.x)},${Math.round(evt.y)})`, url: page.url() });
  else if (evt.type === "key") recordBrowserAction(key, { actor: "human", kind: "key", summary: `按鍵 ${evt.key}`, url: page.url() });
  else if (evt.type === "text") recordBrowserAction(key, { actor: "human", kind: "type", summary: `輸入 "${String(evt.text).slice(0, 60)}"`, url: page.url() });
}

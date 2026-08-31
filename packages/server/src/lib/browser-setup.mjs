/**
 * Browser Setup — chromium 可選元件：偵測 + 一鍵安裝（Gateway 前置工程）
 *
 * 設計（2026-08-30 Fleming 定調）：
 * - chromium 是 optional component — 沒裝不影響 PAAW 啟動，只影響 browser 功能
 * - UI「安裝瀏覽器元件」按鈕 → POST /api/browser/setup/install → 背景 `npx playwright install chromium`
 * - 冪等：chromium revision 沒變秒過；playwright 套件版本 bump 過才會重新下載（~170MB）
 * - 進度：ring buffer 存最後 60 行輸出，前端 polling GET /api/browser/setup（進度條行用 \r，已拆行）
 * - 安裝成功 → 重置 browser-session 的 available 狀態 + lazy 重啟（不需重啟 server）
 *
 * 不處理的事（維持 optional 定位，主流程永不因此失敗）：
 * - playwright 套件本身沒裝（需要 npm install，交給 UI 顯示手動指引）
 * - Docker system deps（libnss3 等，裝 image 時處理）
 * - 公司 proxy 擋 cdn.playwright.dev（失敗訊息會帶 exit code，UI 顯示手動方案）
 */
import { existsSync } from "fs";
import { spawn } from "child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_HOME } from "../data-home.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../.."); // packages/server/src/lib → repo root（playwright 套件在 root node_modules）

// ── 偵測 ──
// executablePath() 只計算路徑不驗證存在，要用 existsSync 自己查（跨平台路徑已由 playwright 正規化）
export async function getBrowserSetupStatus() {
  let pw = null;
  try { pw = await import("playwright"); }
  catch { return { playwright: false, chromium: false, executablePath: null }; }
  let executablePath = null;
  try { executablePath = pw.chromium.executablePath(); } catch {}
  const chromium = Boolean(executablePath && existsSync(executablePath));
  return { playwright: true, chromium, executablePath };
}

// ── 安裝（單例：同時只跑一個）──
const MAX_LINES = 60;
const _install = {
  state: "idle",        // idle | running | done | failed
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  lines: [],
};

export function browserInstallState() {
  return { ..._install, lines: _install.lines.slice() };
}

export function startBrowserInstall() {
  if (_install.state === "running") {
    const err = new Error("Browser component install already running");
    err.statusCode = 409;
    throw err;
  }
  _install.state = "running";
  _install.startedAt = Date.now();
  _install.finishedAt = null;
  _install.exitCode = null;
  _install.lines = [];
  pushLine(`$ npx playwright install chromium   (cwd: ${REPO_ROOT})`);

  // Windows 的 npx 是 npx.cmd 且需要 shell；其他平台直接 spawn（args 是固定 token 無注入風險）
  const isWin = process.platform === "win32";
  const child = spawn(isWin ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], {
    cwd: REPO_ROOT,
    shell: isWin,
    env: process.env,
  });

  const onChunk = (buf) => {
    // playwright 下載進度用 \r 覆蓋同一行 — 拆開當獨立行收，UI 才看得到進度推進
    String(buf).split(/\r\n|\r|\n/).forEach(l => { if (l.trim()) pushLine(l); });
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  child.on("error", (e) => { pushLine(`spawn error: ${e?.message || e}`); finish(1); });
  child.on("close", (code) => {
    if (code === 0 && process.platform === "linux") {
      // Linux 還需要系統依賴（libnss3 等）— 自動追加 install-deps
      pushLine("Linux 偵測到，自動安裝系統依賴…");
      const depChild = spawn("npx", ["playwright", "install-deps", "chromium"], {
        cwd: REPO_ROOT, shell: false, env: process.env,
      });
      depChild.stdout?.on("data", onChunk);
      depChild.stderr?.on("data", onChunk);
      depChild.on("error", (e) => { pushLine(`install-deps error: ${e?.message || e}`); finish(1); });
      depChild.on("close", (depCode) => {
        if (depCode !== 0) pushLine(`⚠️ install-deps exited ${depCode} — 可能需要 sudo 手動跑：sudo npx playwright install-deps chromium`);
        finish(depCode);
      });
    } else {
      finish(code);
    }
  });

  return browserInstallState();
}

function pushLine(l) {
  _install.lines.push(String(l).slice(0, 500));
  if (_install.lines.length > MAX_LINES) _install.lines.shift();
}

function finish(code) {
  _install.state = code === 0 ? "done" : "failed";
  _install.finishedAt = Date.now();
  _install.exitCode = code;
  if (code === 0) {
    // 成功：清掉「未安裝」狀態 + lazy 重啟 browser（server 不用重啟）
    import("./browser-session.mjs")
      .then(m => { m.resetBrowserAvailability(); m.getBrowserPage(DATA_HOME).catch(() => {}); })
      .catch(() => {});
  }
}

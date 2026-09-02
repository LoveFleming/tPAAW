/**
 * Browser Setup — 偵測「系統已安裝的 Google Chrome / Chromium」（channel: "chrome"）
 *
 * 設計（2026-09-02 Fleming 定調 — 選項 A）：
 * - PAAW 不再下載自帶 chromium — browser-session 改用 `channel: "chrome"`，
 *   Playwright 直接操控系統已安裝的 Chrome / Chromium。
 * - 這裡只負責「偵測系統 Chrome 是否可用」，讓 UI 顯示就緒/缺失狀態。
 * - 不再有一鍵安裝（~170MB）按鈕 — 缺瀏覽器時 UI 顯示「安裝 Google Chrome」指引。
 *
 * 偵測策略（跨平台，找常見安裝路徑 / PATH）：
 *   - macOS： /Applications/Google Chrome.app/.../Google Chrome（也認 Chromium.app）
 *   - Windows： ProgramFiles / ProgramFiles(x86) / LOCALAPPDATA 下的 chrome.exe / msedge.exe
 *   - Linux： which google-chrome / google-chrome-stable / chromium / chromium-browser / microsoft-edge
 */
import { existsSync } from "fs";
import { execFileSync } from "child_process";

const _CANDIDATES = _buildCandidates();

function _buildCandidates() {
  const list = [];
  const pf = process.env.PROGRAMFILES;
  const pfx = process.env["PROGRAMFILES(X86)"];
  const la = process.env.LOCALAPPDATA;
  // Windows — 常見 Chrome 路徑
  for (const base of [pf, pfx, la]) {
    if (!base) continue;
    list.push(`${base}\\Google\\Chrome\\Application\\chrome.exe`);
    list.push(`${base}\\Microsoft\\Edge\\Application\\msedge.exe`);
    if (pf && base !== pf) list.push(`${base}\\Microsoft\\Edge\\Application\\msedge.exe`);
  }
  // macOS — Chrome / Chromium
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  list.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  // Linux — PATH 二進位
  list.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge");
  return list;
}

/** 找系統 Chrome 家族 binary：回傳絕對路徑，找不到回 null */
export function detectSystemChrome() {
  for (const p of _CANDIDATES) {
    // Linux 走 PATH（which）
    if (!p.includes("/") && !p.includes("\\")) {
      try {
        const out = execFileSync("which", [p], { stdio: "pipe" }).toString().trim();
        if (out) return out;
      } catch {}
      continue;
    }
    // 絕對/相對路徑 — 直接 existsSync
    if (existsSync(p)) return p;
  }
  return null;
}

/** 偵測 playwright 套件 + 系統 Chrome，供 UI 顯示 */
export async function getBrowserSetupStatus() {
  let pw = null;
  try { pw = await import("playwright"); }
  catch { return { playwright: false, chrome: false, executablePath: null }; }
  const executablePath = detectSystemChrome();
  return { playwright: true, chrome: Boolean(executablePath), executablePath };
}
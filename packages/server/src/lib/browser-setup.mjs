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
  // Windows — 常見 Chrome / Edge 路徑（用 Set 去重）
  const win = new Set();
  for (const base of [pf, pfx, la]) {
    if (!base) continue;
    win.add(`${base}\\Google\\Chrome\\Application\\chrome.exe`);
    win.add(`${base}\\Microsoft\\Edge\\Application\\msedge.exe`);
  }
  list.push(...win);
  // macOS — Chrome / Chromium / Edge
  list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  list.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  list.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  // Linux — PATH 二進位（含 Edge）
  list.push("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable");
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

/**
 * 解析 Playwright launch channel — 依系統實際安裝的瀏覽器選
 *
 * 目的（跨平台，2026-09-02 Fleming）：
 *   公司 Windows 可能只裝 Microsoft Edge（很多企業預設），Linux 可能是 chromium-browser。
 *   `channel:"chrome"` 在 Playwright 只認 Google Chrome — 只有 Edge/Chromium 的機器會 launch 失敗。
 *   因此依偵測結果選：有 Google Chrome→channel:"chrome"；只有 Edge→channel:"msedge"；
 *   只有 Linux Chromium(channel 不吃)→給 executablePath。
 *
 * @returns {{ channel?: string, executablePath?: string }} — 傳給 chromium.launchPersistentContext 的選項
 */
export function resolveBrowserChannel(expectVisible = false) {
  const exe = detectSystemChrome();
  if (!exe) return {}; // 找不到 → 不注 options，讓 Playwright 報缺瀏覽器（UI 顯示安裝指引）
  const lower = exe.toLowerCase();
  if (/chrome\.exe|google chrome|chromium\.app/.test(lower)) {
    // 找到 Google Chrome / Chromium → 用 chrome channel（各平台可靠）
    return { channel: "chrome" };
  }
  if (/edge(\\.exe)?/.test(lower) || /microsoft edge/.test(lower)) {
    // 只有 Microsoft Edge → msedge channel（Windows/macOS 支援）
    return { channel: "msedge" };
  }
  // Linux 的 chromium-browser / 其他 → 直接用偵測到的 executablePath（channel 不支援的非 Chrome 家族）
  return { executablePath: exe };
}

/** 偵測 playwright 套件 + 系統 Chrome，供 UI 顯示 */
export async function getBrowserSetupStatus() {
  let pw = null;
  try { pw = await import("playwright"); }
  catch { return { playwright: false, chrome: false, executablePath: null }; }
  const executablePath = detectSystemChrome();
  return { playwright: true, chrome: Boolean(executablePath), executablePath };
}
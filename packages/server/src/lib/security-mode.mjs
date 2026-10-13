// 🛠 開發模式總開關（2026-10-13 Fleming）
// 「趕碼時不要被沙箱/審批卡住；有空再開回來測」→ 一個開關，關掉：
//   1) MXC 沙箱（AI 的 bash 不再被包 → 效能好、零沙箱摩擦）
//   2) script-guard 安全審批（危險 pattern 不再跳審批卡）
// 不關（永遠有效）：
//   - shell-guard：AI 動不了本 RU 以外的 process（尤其 PAAW 自己）— 這是防自殺，不是防犯錯
//   - git push 紀律以外的檔案寫入攔截（git hooks / shell rc）仍保留 —— 正常 coding 不會踩到
// 事實來源：data/config/security.json { "devMode": true|false }（每台機器各自設定）
// 環境變數覆寫：PAAW_DEV_MODE=on/off（debug 用，優先於檔案）

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { DATA_HOME } from "../data-home.mjs";

const FILE = join(DATA_HOME, "config", "security.json");

let _cache = null;
let _mtime = 0;

/** 讀設定（有 mtime 快取；檔案不存在 → 預設全開 = 安全） */
export function loadSecurityMode() {
  try {
    const st = statSync(FILE);
    if (_cache && st.mtimeMs === _mtime) return _cache;
    _mtime = st.mtimeMs;
    const raw = JSON.parse(readFileSync(FILE, "utf-8"));
    _cache = { devMode: raw.devMode === true, updatedAt: raw.updatedAt || null };
  } catch {
    _cache = { devMode: false, updatedAt: null };
  }
  return _cache;
}

/** 開發模式是否開啟（= 關沙箱 + 關安全審批） */
export function devModeOn() {
  const env = (process.env.PAAW_DEV_MODE || "").toLowerCase();
  if (env === "off" || env === "false" || env === "0") return false;
  if (env === "on" || env === "true" || env === "1") return true;
  return loadSecurityMode().devMode === true;
}

/** 寫設定（回傳寫入後的狀態）。快取立即失效，無需重啟。 */
export function setDevMode(on) {
  const next = { devMode: on === true, updatedAt: new Date().toISOString() };
  try { mkdirSync(dirname(FILE), { recursive: true }); } catch {}
  writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
  _cache = next;
  try { _mtime = statSync(FILE).mtimeMs; } catch { _mtime = 0; }
  return next;
}

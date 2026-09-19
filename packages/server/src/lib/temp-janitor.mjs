/**
 * Temp Janitor — 暫存檔集中清理（2026-09-19，解「agent 開發暫存程式忘記清」）
 *
 * 三個破口：
 *   1. bash 創檔（heredoc/cat/echo）不經 write_file → createdFiles 追蹤不到
 *   2. cleanup pattern 漏常見命名（test-xxx.mjs 只認 test-_tmp*）
 *   3. provider temp/（payload-*.json + stream-*.log）每次 API 呼叫都寫、從不清理
 *
 * 方案（deterministic，無 LLM）：
 *   - pruneProviderTemp()：temp/ 只留最新 N 個 payload/stream 檔
 *   - cleanupProjectTempFiles()：session 結束掃專案 — git untracked + 暫存 pattern
 *     + mtime 在 session 時間窗內 + 非保護目錄 → 刪。堵 bash 創檔 + pattern 洞。
 */

import { readdirSync, statSync, unlinkSync, existsSync, rmSync } from "fs";
import { join, resolve, basename, extname } from "path";
import { execFileSync } from "child_process";

// ── 暫存檔 pattern（base name 層級；保護目錄另檢）──
export const TEMP_FILE_PATTERNS = [
  /^test-_tmp/,                                   // test-_tmp-xxx.mjs（舊 pattern 保留）
  /^test-[a-z0-9_.-]+\.(mjs|js|cjs|ts|tsx|py|sh|json)$/i, // test-verify.mjs（最常見 agent scratch）
  /^_tmp/, /^tmp[._-]/, /^_temp[._-]/, /^temp[._-]/,
  /^scratch[._-]/, /\.tmp$/, /\.scratch$/,
  /^verify[._-]/, /^debug[._-]/, /^check[._-]/, /^quick[._-]/,
  /^probe[._-]/, /^explore[._-]/, /^inspect[._-]/, /^snippet[._-]/,
];

// 這些目錄裡的 同名檔是正規源碼/測試，永不清
const PROTECTED_DIRS = new Set([
  "src", "lib", "packages", "components", "pages", "app", "routes", "docs",
  "__tests__", "test", "tests", "scripts", "data",
]);

function matchesTempPattern(name) {
  return TEMP_FILE_PATTERNS.some(p => p.test(name));
}

function listGitUntracked(cwd) {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd, encoding: "utf-8", timeout: 8000,
    });
    const set = new Set();
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      const st = line.slice(0, 2);
      const p = line.slice(3).trim();
      if (p.startsWith('"') && p.endsWith('"')) {
        try { set.add(JSON.parse(p)); continue; } catch {}
      }
      if (st.includes("?")) set.add(p); // untracked
      else if (st.includes("A")) set.add(p); // staged new file（還沒 commit 的新檔）
    }
    return set;
  } catch {
    return null; // 非 git repo 或 git 掛了 → 呼叫端 fallback mtime-only
  }
}

/**
 * 掃專案內的暫存檔（候選刪除名單）。
 * 條件（全部成立才刪）：pattern 符合 + 非保護目錄 + mtime 在時間窗內 + git untracked（或非 git repo）
 * @param {string} cwd 專案根
 * @param {number} sinceMs session 起始時間（只動這之後碰過的檔）
 */
export function scanProjectTempFiles(cwd, sinceMs) {
  const hits = [];
  const untracked = listGitUntracked(cwd);

  const walk = (dir, depth) => {
    if (depth > 2) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules" || e.name.startsWith(".paaw")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth === 0 && PROTECTED_DIRS.has(e.name)) continue; // 保護目錄整個跳過（僅 root 層）
        walk(full, depth + 1);
      } else {
        if (!matchesTempPattern(e.name)) continue;
        const dirName = basename(dir);
        if (PROTECTED_DIRS.has(dirName)) continue;
        try {
          const st = statSync(full);
          if (sinceMs && st.mtimeMs < sinceMs) continue;   // 不是這個 session 產生的
          if (untracked && !untracked.has(relative(cwd, full))) continue; // git 有追蹤的正規檔不動
          hits.push({ path: full, rel: relative(cwd, full), mtime: st.mtimeMs });
        } catch {}
      }
    }
  };

  walk(resolve(cwd), 0);
  return hits;
}

function relative(cwd, full) {
  const r = resolve(full).slice(resolve(cwd).length);
  return r.replace(/^[\\/]/, "");
}

/**
 * 清專案暫存檔（回傳清除報告）
 */
export function cleanupProjectTempFiles(cwd, sinceMs, logFn = () => {}) {
  const hits = scanProjectTempFiles(cwd, sinceMs);
  const removed = [];
  for (const h of hits) {
    try {
      rmSync(h.path, { force: true });
      removed.push(h.rel);
      logFn(`[temp-janitor] removed ${h.rel}`);
    } catch (e) {
      logFn(`[temp-janitor] failed ${h.rel}: ${e.message}`);
    }
  }
  return { removed, scanned: hits.length };
}

/**
 * provider temp/ 修剪：payload-*.json / stream-*.log 各留最新 keep 個
 */
export function pruneProviderTemp(tempDir, keep = 60) {
  if (!existsSync(tempDir)) return { payload: 0, stream: 0 };
  const groups = { payload: [], stream: [] };
  try {
    for (const f of readdirSync(tempDir)) {
      const full = join(tempDir, f);
      try {
        const st = statSync(full);
        if (f.startsWith("payload-")) groups.payload.push({ full, mtime: st.mtimeMs });
        else if (f.startsWith("stream-")) groups.stream.push({ full, mtime: st.mtimeMs });
      } catch {}
    }
  } catch { return { payload: 0, stream: 0 }; }

  let removed = { payload: 0, stream: 0 };
  for (const kind of ["payload", "stream"]) {
    const list = groups[kind].sort((a, b) => b.mtime - a.mtime); // 新→舊
    for (const item of list.slice(keep)) {
      try { unlinkSync(item.full); removed[kind]++; } catch {}
    }
  }
  return removed;
}

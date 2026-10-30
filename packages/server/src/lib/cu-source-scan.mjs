/**
 * CU source scan — 輕量掃專案 source 檔（純 node fs、跨平台、不碰 node_modules）
 *
 * 單一事實來源：CU_SOURCE_EXTS / CU_SKIP_DIRS / parseGitignore / walkSourceFiles / countSourceFiles
 * 使用者：routes/coding.mjs（scan step + staleness 基準）、routes/coding-features.mjs（feature-map）、
 *        paaw-project.mjs（CU watermark）
 *
 * 2026-09-06 Fleming：支援 .gitignore — 被 git ignore 的目錄/檔案不掃（省 token、
 * 避免 build 產物污染 feature map / 誤觸 staleness）。硬編碼 SKIP_DIRS 保留為保底。
 *
 * ⚠️ 改這裡的規則 = 改 staleness 的定義 — 兩邊自動同步，不要再各自複製一份
 */
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";

/** git 指令執行（跨平台：execFile 不經 shell、argv 注入安全）；失敗回 null（呼叫端優雅 fallback） */
function git(root, args) {
  return new Promise((resolvePromise) => {
    try {
      execFile("git", ["-C", root, ...args], { timeout: 15000, windowsHide: true }, (err, stdout) => {
        resolvePromise(err || stdout == null ? null : stdout);
      });
    } catch {
      resolvePromise(null);
    }
  });
}

/** 當下 HEAD commit sha（非 git repo / git 不可用回 null） */
export function getHeadCommit(root) {
  return git(root, ["rev-parse", "HEAD"]).then(out => (out && /^[0-9a-f]{7,40}\n?$/.test(out.trim()) ? out.trim() : null));
}

/** 檔案是否屬 CU source（walker 同一套規則：副檔名 + SKIP_DIRS + .gitignore）— git diff 過濾用 */
export function isSourceFilePath(root, relPath) {
  const p = relPath.replace(/\\/g, "/");
  if (p.startsWith(".")) return false;
  const segs = p.split("/");
  if (segs.slice(0, -1).some(s => CU_SKIP_DIRS.has(s) || s.startsWith("."))) return false;
  const dot = p.lastIndexOf("/");
  const name = dot >= 0 ? p.slice(dot + 1) : p;
  const ext = name.lastIndexOf(".");
  if (ext <= 0 || !CU_SOURCE_EXTS.has(name.slice(ext).toLowerCase())) return false;
  try { return !loadProjectIgnore(root).shouldIgnore(p, false); } catch { return true; }
}

/**
 * watermark commit..HEAD（含 working tree 未提交變更）之間實際變更的 source 檔清單
 * 純 doc/圖/locale 變更會被過濾掉 → 不觸發 stale
 * 非 git repo / git 指令失敗 / commit 不存在（rebase 改寫歷史）→ 回 null（呼叫端 fallback mtime）
 */
export async function changedSourceFilesSince(root, fromCommit) {
  if (!fromCommit) return null;
  const diffOut = await git(root, ["diff", "--name-only", `${fromCommit}..HEAD`]);
  if (diffOut === null) return null;
  const statusOut = await git(root, ["status", "--porcelain"]);
  if (statusOut === null) return null;
  const paths = new Set(diffOut.split("\n").map(s => s.trim()).filter(Boolean));
  for (const line of statusOut.split("\n")) {
    if (!line || line.length < 4) continue;
    // porcelain v1：「XY path」（Y=X=空白之外不 trim 前缀，rename 为「XY old -> new」取新路径）
    let p = line.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    p = p.trim().replace(/^"(.*)"$/, "$1");
    if (p) paths.add(p);
  }
  const changed = [...paths].filter(p => isSourceFilePath(root, p));
  // ⚠️ 無法比對的巨量輸出保險：上限 5000 條（防異常 git 輸出炸記憶體）
  return changed.slice(0, 5000);
}

export const CU_SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".java", ".rs", ".vue", ".svelte"]);
export const CU_SKIP_DIRS = new Set(["node_modules", ".git", ".paaw", "dist", "build", "coverage", ".next", "vendor", "target", "out", ".cache", "semgrep-rules"]); // semgrep-rules：規則範例碼不是專案 source（舊 find 的 -not-path 搬過來）

const MAX_VISIT = 8000; // 2026-09-06 review：2000→8000 — 大型 monorepo 目錄數餘裕；純 fs walk 幾百 ms 可接受

// ── .gitignore parsing（簡化版：涵蓋 dir/、*.ext、path/to/x、!negate、#註解）──

/** glob pattern → RegExp（* 單層、** 跨層、? 單字） */
function globToRegExp(pat) {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") { re += ".*"; i++; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return re;
}

/** 解析 .gitignore 文字 → [{ re, negated, dirOnly }] */
export function parseGitignore(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let pat = line;
    const negated = pat.startsWith("!");
    if (negated) pat = pat.slice(1);
    const dirOnly = pat.endsWith("/");
    if (dirOnly) pat = pat.slice(0, -1);
    if (!pat) continue;
    const anchored = pat.includes("/") && !pat.startsWith("/"); // 含 / = 相對 root
    const body = globToRegExp(pat.startsWith("/") ? pat.slice(1) : pat);
    out.push({
      re: new RegExp(anchored ? `^${body}(/.*)?$` : `(^|/)${body}(/.*)?$`),  // nosemgrep: detect-non-literal-regexp
      negated,
      dirOnly,
    });
  }
  return out;
}

/** 載入專案 ignore 規則（.gitignore；無檔案回空 matcher）。快取 per root。 */
const _ignoreCache = new Map();
export function loadProjectIgnore(root) {
  if (_ignoreCache.has(root)) return _ignoreCache.get(root);
  let patterns = [];
  const gi = join(root, ".gitignore");
  try {
    if (existsSync(gi)) patterns = parseGitignore(readFileSync(gi, "utf-8"));
  } catch {}
  const shouldIgnore = (relPath, isDir) => {
    let ignored = false;
    for (const p of patterns) {
      if (p.dirOnly && !isDir) {
        // dir-only pattern 適用於其下檔案：parent 目錄段 match 即算
        const parent = relPath.split("/").slice(0, -1).join("/");
        if (parent && p.re.test(parent)) ignored = !p.negated;
        continue;
      }
      if (p.re.test(relPath)) ignored = !p.negated;
    }
    return ignored;
  };
  const cached = { patterns, shouldIgnore };
  _ignoreCache.set(root, cached);
  return cached;
}

/** 清 ignore 快取（.gitignore 變更後） */
export function clearIgnoreCache(root) {
  if (root) _ignoreCache.delete(root);
  else _ignoreCache.clear();
}

/**
 * 共用 walker — 列 source 檔（相對路徑、`/` 分隔）
 * 排除：隱藏檔/目錄、CU_SKIP_DIRS、.gitignore 規則
 * @param {string} root 專案根
 * @param {{exts?: Set<string>, maxFiles?: number, withStats?: boolean}} opts
 */
export function walkSourceFiles(root, opts = {}) {
  const exts = opts.exts || CU_SOURCE_EXTS;
  const maxFiles = opts.maxFiles || 0;
  const ignore = loadProjectIgnore(root);
  const files = [];
  let lastModifiedMs = 0;
  let visited = 0;
  const stack = [root];
  while (stack.length > 0 && visited < MAX_VISIT) {
    const dir = stack.pop();
    visited++;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue; // 隱藏目錄（.git/.paaw/.next…）全部跳過
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (CU_SKIP_DIRS.has(e.name)) continue;
        const rel = full.slice(root.length + 1).replace(/\\/g, "/");
        if (ignore.shouldIgnore(rel, true)) continue; // gitignore 剪枝
        stack.push(full);
      } else {
        const dot = e.name.lastIndexOf(".");
        if (dot > 0 && exts.has(e.name.slice(dot).toLowerCase())) {
          const rel = full.slice(root.length + 1).replace(/\\/g, "/");
          if (ignore.shouldIgnore(rel, false)) continue;
          try { const st = statSync(full); if (st.mtimeMs > lastModifiedMs) lastModifiedMs = st.mtimeMs; } catch {}
          files.push(rel);
          if (maxFiles > 0 && files.length >= maxFiles) return { files, lastModifiedMs, visited };
        }
      }
    }
  }
  if (visited >= MAX_VISIT) console.warn(`[cu-source-scan] MAX_VISIT ${MAX_VISIT} 截斷（${root}）— 檔案清單可能不完整`);
  return { files, lastModifiedMs, visited };
}

/** 掃 source 檔數 + 最新 mtime（staleness 基準）。無 source 回 { count: 0, lastModifiedMs: 0 } */
export function countSourceFiles(root) {
  try {
    const { files, lastModifiedMs } = walkSourceFiles(root);
    return { count: files.length, lastModifiedMs };
  } catch {
    return { count: 0, lastModifiedMs: 0 };
  }
}

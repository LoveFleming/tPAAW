/**
 * CU source scan — 輕量掃專案 source 檔（純 node fs、跨平台、不碰 node_modules）
 *
 * 單一事實來源：CU_SOURCE_EXTS / CU_SKIP_DIRS / countSourceFiles
 * 使用者：routes/coding.mjs（staleness 基準 + no-code 判斷）、paaw-project.mjs（CU watermark）
 *
 * ⚠️ 改這裡的規則 = 改 staleness 的定義 — 兩邊自動同步，不要再各自複製一份
 */
import { readdirSync, statSync } from "fs";
import { join } from "path";

export const CU_SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".java", ".rs", ".vue", ".svelte"]);
export const CU_SKIP_DIRS = new Set(["node_modules", ".git", ".paaw", "dist", "build", "coverage", ".next", "vendor", "target", "out", ".cache"]);

const MAX_VISIT = 2000;

/** 掃 source 檔數 + 最新 mtime（staleness 基準）。無 source 回 { count: 0, lastModifiedMs: 0 } */
export function countSourceFiles(root) {
  let count = 0;
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
        stack.push(full);
      } else {
        const dot = e.name.lastIndexOf(".");
        if (dot > 0 && CU_SOURCE_EXTS.has(e.name.slice(dot).toLowerCase())) {
          count++;
          try { const st = statSync(full); if (st.mtimeMs > lastModifiedMs) lastModifiedMs = st.mtimeMs; } catch {}
        }
      }
    }
  }
  return { count, lastModifiedMs };
}

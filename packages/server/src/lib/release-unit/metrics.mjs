/**
 * release-unit/metrics.mjs — 代碼指標（Tier 2 觀測力）
 *
 * LOC / 複雜度（分支密度估算）/ 巨型檔 / 測試檔比例 / 重名檔（重複線索）。
 * 純靜態掃描，零 LLM 成本。快取 .paaw/metrics-cache.json（同 deps signature）。
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { detectAdapter } from "./adapters.mjs";
import { walkSources } from "./dependencies.mjs";

const CACHE_VERSION = 1;

// 複雜度訊號：分支 + 短路 + 三元（語言通用集，非 JS 檔只會少算不會誤算）
const COMPLEXITY_RE = /\b(if|for|while|case|catch|elseif|elif)\b|\&\&|\|\||\?[^.?]/g;

/** 測試檔判定 */
export function isTestFile(rel) {
  return /\.(test|spec)\.[tj]sx?$/.test(rel)
    || /\.(py|go)$/.test(rel) && /(^|\/)(test_|_test\.|.*_test\.go$)/.test(rel)
    || /(^|\/)(tests?|__tests__)\//.test(rel);
}

/**
 * 掃描並計算指標
 * @returns { totalFiles, totalLoc, avgComplexity, testFiles, testRatio,
 *            largest: [{file, loc}], complex: [{file, loc, complexity, perLoc}],
 *            longFiles: n(>500 LOC), duplicatedNames: [{name, count, files}] }
 */
export async function computeMetrics(root, opts = {}) {
  const adapter = await detectAdapter(root);
  const files = await walkSources(root, adapter.sourceExts, opts.maxFiles);
  const signature = `v${CACHE_VERSION}:${adapter.id}:${files.length}:${Math.max(0, ...files.map(f => Math.floor(f.mtimeMs / 1000)))}`;

// nosemgrep: path-join-resolve-traversal
  const cacheFile = join(root, ".paaw", "metrics-cache.json");
  if (!opts.refresh && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf-8"));
      if (cached.signature === signature) return { ...cached, fromCache: true };
    } catch { /* 重算 */ }
  }

  const perFile = [];
  const nameMap = {}; // basename → [files]
  let totalLoc = 0;
  let totalComplexity = 0;
  let testFiles = 0;

  for (const f of files) {
    let content = "";
    try { content = await readFile(f.abs, "utf-8"); } catch { continue; }
    const lines = content.split("\n");
    const loc = lines.filter(l => l.trim() && !/^\s*(\/\/|#|\*|\/\*)/.test(l)).length;
    const matches = content.match(COMPLEXITY_RE);
    const complexity = matches ? matches.length : 0;
    totalLoc += loc;
    totalComplexity += complexity;
    if (isTestFile(f.rel)) testFiles += 1;
    perFile.push({ file: f.rel, loc, complexity });
    const base = f.rel.split("/").pop();
    if (base !== "index.ts" && base !== "index.js") { // index 到處都是，不算重複
      (nameMap[base] ||= []).push(f.rel);
    }
  }

  perFile.sort((a, b) => b.loc - a.loc);
  const largest = perFile.slice(0, 10).map(f => ({ file: f.file, loc: f.loc }));
  const complex = perFile
    .filter(f => f.loc >= 50)
    .map(f => ({ ...f, perLoc: +(f.complexity / f.loc).toFixed(2) }))
    .sort((a, b) => b.complexity - a.complexity)
    .slice(0, 10);
  const longFiles = perFile.filter(f => f.loc > 500).length;
  const duplicatedNames = Object.entries(nameMap)
    .filter(([, fl]) => fl.length > 1)
    .map(([name, fl]) => ({ name, count: fl.length, files: fl.slice(0, 5) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const result = {
    root: String(root),
    adapter: adapter.id,
    generatedAt: new Date().toISOString(),
    signature,
    totalFiles: files.length,
    totalLoc,
    avgComplexity: files.length ? +(totalComplexity / files.length).toFixed(1) : 0,
    testFiles,
    testRatio: files.length ? +(testFiles / files.length).toFixed(3) : 0,
    largest,
    complex,
    longFiles,
    duplicatedNames,
  };

  try {  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
    const paawDir = join(root, ".paaw");
    if (!existsSync(paawDir)) await (await import("fs/promises")).mkdir(paawDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(result), "utf-8");
  } catch { /* 快取失敗不影響 */ }

  return result;
}

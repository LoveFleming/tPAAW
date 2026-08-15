/**
 * release-unit/dependencies.mjs — Import 依賴圖掃描
 *
 * 走訪專案原始碼（純 Node fs 遞迴，Windows 相容，不用 find），
 * 用 adapter 的 importRegexes 抓 import specifier，
 * 解析相對路徑 / tsconfig alias / node_modules 套件，
 * 建構 forward（我依賴誰）+ reverse（誰依賴我）雙向圖。
 *
 * 快取：.paaw/deps-cache.json（signature = fileCount + maxMtime，
 * 檔案沒動就直接用快取，掃描成本只在第一次）。
 *
 * 所有對外路徑一律 POSIX 相對路徑（normalizePath 紀律）。
 */

import { readFile, writeFile, mkdir, stat, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, relative, dirname, extname } from "path";
import { detectAdapter, parsePathAliases } from "./adapters.mjs";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".gitignore", "dist", "build", "out", "coverage",
  ".paaw", ".next", ".nuxt", ".cache", ".turbo", ".output",
  "vendor", "__pycache__", ".venv", "venv", "env", "target",
]);

const CACHE_VERSION = 2;

/** posix 化相對路徑（回傳前端/圖節點用的 key） */
function toRel(root, abs) {
  return relative(root, abs).split(/[\\/]/).join("/");
}

/** 遞迴走訪原始碼檔（純 Node fs，跨平台） */
async function walkSources(root, exts, maxFiles = 8000) {
  const out = []; // { rel, abs, mtimeMs }
  const extSet = new Set(exts);
  async function walk(dir, depth) {
    if (out.length >= maxFiles || depth > 12) return;
    let entries;
    try { entries = await readdir(dir); } catch { return; }
    for (const name of entries) {
      if (out.length >= maxFiles) return;
      const abs = join(dir, name);
      let st;
      try { st = await stat(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (IGNORE_DIRS.has(name) || name.startsWith(".git")) continue;
        await walk(abs, depth + 1);
      } else if (extSet.has(extname(name).toLowerCase())) {
        out.push({ rel: toRel(root, abs), abs, mtimeMs: st.mtimeMs });
      }
    }
  }
  await walk(root, 0);
  return out;
}

// ── Specifier 解析 ──

/** "@scope/pkg/rest" → "@scope/pkg"；"pkg/rest" → "pkg" */
export function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** alias 命中：回傳 root 底下的候選相對路徑，否則 null */
function resolveAlias(spec, aliases) {
  for (const a of aliases) {
    if (spec === a.prefix) {
      return a.isWildcard ? a.target : a.target;
    }
    if (a.isWildcard && spec.startsWith(a.prefix + "/")) {
      const rest = spec.slice(a.prefix.length + 1);
      return `${a.target}/${rest}`;
    }
  }
  return null;
}

/** 相對/alias/import-less 解析：回傳候選 rel path 陣列（副檔名補全 + index + TS 對映） */
function candidateRels(spec, fromRel, aliases) {
  const cands = [];
  const addRel = (r) => { if (r && !cands.includes(r)) cands.push(r); };

  if (spec.startsWith("./") || spec.startsWith("../")) {
    const base = toRelFromSpec(dirname(fromRel), spec);
    addWithExts(addRel, base);
  } else {
    const aliased = resolveAlias(spec, aliases);
    if (aliased) addWithExts(addRel, aliased);
  }
  return cands;
}

function addWithExts(addRel, base) {
  // TS 慣例：import "./x.js" 實際是 x.ts
  const bases = [base];
  if (/\.js$/.test(base)) bases.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  if (/\.mjs$/.test(base)) bases.push(base.replace(/\.mjs$/, ".mts"), base.replace(/\.mjs$/, ".ts"));
  for (const b of bases) {
    addRel(b); // 精確（含副檔名 import）
    for (const ext of [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go"]) {
      addRel(b + ext);
    }
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      addRel(`${b}/index${ext}`);
    }
  }
}

/** dirname("a/b/c.ts") + "../d" → "a/d"（純字串，不碰 fs） */
function toRelFromSpec(fromDir, spec) {
  const segs = fromDir ? fromDir.split("/") : [];
  for (const s of spec.split("/")) {
    if (s === "." || s === "") continue;
    if (s === "..") segs.pop();
    else segs.push(s);
  }
  return segs.join("/");
}

// ── 圖建構 ──

/**
 * 掃描並建構依賴圖（含快取）。
 * 回傳 {
 *   root, adapter, generatedAt, fileCount, signature,
 *   deps:    { file: [file...] }   — forward：內部依賴（我 import 誰）
 *   rdeps:   { file: [file...] }   — reverse：誰 import 我
 *   externals: { file: [pkg...] }  — 外部套件依賴
 *   pkgCount: { pkg: n }           — 每個套件被幾個檔案 import
 *   fromCache: bool
 * }
 */
export async function buildDependencyGraph(root, opts = {}) {
  const adapter = await detectAdapter(root);
  const { aliases } = parsePathAliases(root);
  const files = await walkSources(root, adapter.sourceExts, opts.maxFiles);
  const fileSet = new Set(files.map(f => f.rel));

  const signature = `${CACHE_VERSION}:${adapter.id}:${files.length}:${Math.max(0, ...files.map(f => Math.floor(f.mtimeMs / 1000)))}`;

  // 快取有效 → 直接回
  const cacheFile = join(root, ".paaw", "deps-cache.json");
  if (!opts.refresh && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf-8"));
      if (cached.signature === signature) return { ...cached, fromCache: true };
    } catch { /* 快取壞了重掃 */ }
  }

  const deps = {};
  const externals = {};
  const pkgCount = {};

  for (const f of files) {
    deps[f.rel] = [];
    externals[f.rel] = [];
    let content;
    try { content = await readFile(f.abs, "utf-8"); } catch { continue; }
    const stripped = adapter.stripComments(content);
    const specs = new Set();
    for (const re of adapter.importRegexes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(stripped)) !== null) {
        // 每個 regex 的 specifier 可能在 group 1 或 2（CJS 兩種寫法）
        const spec = m[1] || m[2];
        if (spec) specs.add(spec);
      }
    }
    for (const spec of specs) {
      if (spec.startsWith("node:")) continue;
      const cands = candidateRels(spec, f.rel, aliases);
      let resolved = null;
      for (const c of cands) {
        if (fileSet.has(c)) { resolved = c; break; }
      }
      if (resolved) {
        if (resolved !== f.rel && !deps[f.rel].includes(resolved)) deps[f.rel].push(resolved);
      } else if (!cands.length) {
        // 外部套件（bare specifier，非 alias）
        const pkg = packageNameOf(spec);
        if (pkg && !externals[f.rel].includes(pkg)) {
          externals[f.rel].push(pkg);
          pkgCount[pkg] = (pkgCount[pkg] || 0) + 1;
        }
      }
      // cands 有值但沒解析到 → 檔案不存在（dynamic/條件 import），忽略
    }
  }

  // reverse 圖
  const rdeps = {};
  for (const f of Object.keys(deps)) rdeps[f] = [];
  for (const [f, list] of Object.entries(deps)) {
    for (const target of list) {
      if (rdeps[target]) rdeps[target].push(f);
    }
  }

  const graph = {
    root: String(root),
    adapter: adapter.id,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    signature,
    deps,
    rdeps,
    externals,
    pkgCount,
  };

  // 寫快取（.paaw 不存在自動建 — 舊專案友善）
  try {
    const paawDir = join(root, ".paaw");
    if (!existsSync(paawDir)) await mkdir(paawDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(graph), "utf-8");
  } catch { /* 快取失敗不影響結果 */ }

  return { ...graph, fromCache: false };
}

/** 查單一檔案的依賴（forward / reverse / both） */
export function queryGraph(graph, file, direction = "both") {
  const norm = normalizeFileKey(graph, file);
  if (!norm) return { file, found: false };
  const out = { file: norm, found: true };
  if (direction === "forward" || direction === "both") out.forward = (graph.deps[norm] || []).slice().sort();
  if (direction === "reverse" || direction === "both") out.reverse = (graph.rdeps[norm] || []).slice().sort();
  if (direction === "both") out.externals = (graph.externals[norm] || []).slice().sort();
  return out;
}

/** 使用者輸入的檔名（可能帶絕對路徑/反斜線/無副檔名）→ 圖 key */
export function normalizeFileKey(graph, file) {
  const f = String(file).trim().replace(/\\/g, "/");
  if (graph.deps[f]) return f;
  // 絕對路徑 → 相對
  if (f.startsWith("/")) {
    const rel = relative(graph.root, f).split(/[\\/]/).join("/");
    if (graph.deps[rel]) return rel;
  }
  // 去掉開頭 ./ 
  const f2 = f.replace(/^\.\//, "");
  if (graph.deps[f2]) return f2;
  // 無副檔名 → 補常見副檔名
  for (const ext of [".ts", ".tsx", ".mjs", ".js", ".jsx", ".py", ".go", ".cjs"]) {
    if (graph.deps[f2 + ext]) return f2 + ext;
  }
  // 檔名唯一吻合（basename）
  const base = f2.split("/").pop();
  const hits = Object.keys(graph.deps).filter(k => k.split("/").pop() === base);
  if (hits.length === 1) return hits[0];
  return null;
}

/**
 * code-graph.mjs — Deterministic Code Map（feature-map v2 數學骨架）2026-09-05
 *
 * Fleming 定調：
 *   - feature map 是骨架 → 數學說了算（deterministic、可重現）
 *   - 長內容（命名/描述/biz logic）→ LLM
 *   - 程式歸不了類 → LLM 分但標 grade:"utility"（人知道不是決定性的）
 *   - 一條 route = 一或多個 feature 是最難處 → 用「route 間 call-graph 重疊率」解
 *
 * Pipeline（零 token、零隨機、排序固定 → 同 repo 必同輸出）：
 *   parseProject(tree-sitter) → resolve imports → file graph
 *   → entry points（routes/ui/api）→ per-entry reach closure（BFS）
 *   → pairwise Jaccard → deterministic average-linkage 聚類
 *   → 檔案歸屬（argmax + margin，否則 shared）
 *   → orphans（程式歸不了 → 交 LLM 標 utility）
 */

import { join, dirname, resolve as resolvePath } from "path";

// ─────────────────────────────────────────────
// 0. 測試檔判定（2026-09-06 Fleming：測試不是 feature — 分流給 Test Intelligence）
// 對齊 test-intelligence.mjs 的判定：basename 慣例 + tests/__tests__ 目錄
// ─────────────────────────────────────────────
const TEST_DIR_RE = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_BASE_RE = /\.(test|spec|e2e|integration)\.(js|mjs|cjs|jsx|ts|tsx|py|rb|go|java|rs)$|(^|_|-)test[_-][^.]+\.(js|mjs|cjs|jsx|ts|tsx|py|go|java|rs)$|(^|_)[^\/]+_test\.(go|py|rs)$/i;

/** 測試檔不是 feature 錨點、不做 feature 歸屬 — 決定論映射到它測的 feature */
export function isTestFile(p) {
  const path = String(p || "").replace(/\\/g, "/");
  if (TEST_DIR_RE.test(path + "/") || TEST_DIR_RE.test(path)) return true;
  return TEST_BASE_RE.test(path.split("/").pop() || "");
}

/** foo.test.mjs / test_foo.py / foo_test.go → foo（basename 慣例 fallback 用） */
function _testStem(p) {
  const base = String(p).replace(/\\/g, "/").split("/").pop() || "";
  return base
    .replace(/\.(test|spec|e2e|integration)\./i, ".")
    .replace(/^test[_-]/i, "")
    .replace(/[_-]test(\.[^.]+)?$/i, "$1")
    .replace(/\.[^.]+$/, "");
}

// ─────────────────────────────────────────────
// 1. Import 解析：source 字串 → repo 內檔案路徑
// ─────────────────────────────────────────────
const TS_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function _resolveRelative(fromFile, source, fileSet) {
  // repo-relative 字串運算（不用 path.resolve — 那會對 cwd，跟 repo-relative fileSet 對不上）
  const stack = fromFile.split("/").slice(0, -1);
  // Python 相對 import：".x" = 同包、"..x" = 上一層（前綴點數 - 1 次上跳）
  const pyDots = source.match(/^(\.+)/);
  if (pyDots && !source.startsWith("./") && !source.startsWith("../")) {
    const up = pyDots[1].length - 1;
    for (let i = 0; i < up; i++) stack.pop();
    source = source.slice(pyDots[1].length);
  }
  for (const seg of source.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  const base = stack.join("/");
  for (const ext of TS_EXTS) {
    if (fileSet.has(base + ext)) return base + ext;
    for (const idx of ["index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"]) {
      const cand = `${base}${ext}/${idx}`;
      if (fileSet.has(cand)) return cand;
    }
  }
  // Python 相對："." / ".." 套件
  for (const ext of [".py", ""]) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  if (fileSet.has(base + "/__init__.py")) return base + "/__init__.py";
  return null;
}

// ─────────────────────────────────────────────
// 1b. Rust module path 解析（2026-10-23：Rust feature map 全空根因④ — use crate::… 邊全懸空）
// crate::/self::/super:: 依 Rust 模組慣例（src/ 根、mod.rs、2018 檔案模組）；
// 其他（workspace crate 名 / 外部套件）→ 正規化（_↔-、::→/）尾碼比對。
// 嘗試順序固定（長→短）= 決定論。
// ─────────────────────────────────────────────
/** 檔案 → 所屬 crate 的 src 根目錄（repo-relative；無 /src/ 用檔案所在目錄） */
function _rustCrateSrcRoot(filePath) {
  const segs = filePath.replace(/\\/g, "/").split("/");
  segs.pop(); // 檔名
  // 由深到淺找最後一個 "src" 段 — src/lib.rs、src/main.rs 是 crate 根
  for (let i = segs.length - 1; i >= 1; i--) {
    if (segs[i] === "src") return segs.slice(0, i + 1);
  }
  return segs;
}

/** 檔案 → 自身 module 目錄（src/a/b.rs → src/a；src/a/mod.rs → src/a；src/a/b/mod.rs → src/a/b） */
function _rustModuleDir(filePath) {
  const segs = filePath.replace(/\\/g, "/").split("/");
  const base = segs.pop() || "";
  if (base === "mod.rs" || base === "lib.rs" || base === "main.rs") return segs;
  segs.push(base.replace(/\.rs$/, ""));
  return segs;
}

/** 候選模組路徑（長→短）逐一試 .rs / mod.rs；回 repo-relative 檔案或 null */
function _rustTryModule(dirSegs, modSegs, fileSet) {
  for (let take = modSegs.length; take >= 1; take--) {
    const path1 = [...dirSegs, ...modSegs.slice(0, take)].join("/") + ".rs";
    const path2 = [...dirSegs, ...modSegs.slice(0, take), "mod.rs"].join("/");
    if (fileSet.has(path1)) return path1;
    if (fileSet.has(path2)) return path2;
  }
  return null;
}

/** 正規化 module path 尾碼比對（ai_gateway::app ↔ ai-gateway/src/app.rs；_↔- 相容） */
function _resolveRustBySuffix(segs, fileSet) {
  if (!fileSet._rustModIndex) {
    const idx = new Map(); // 正規化 module path key → file（歧義 key 直接丟 — 寧可 miss 不猜錯）
    const put = (key, file) => {
      if (!key) return;
      if (idx.has(key) && idx.get(key) !== file) { idx.set(key, null); return; } // 撞號 → null = 歧義
      idx.set(key, file);
    };
    for (const p of [...fileSet].sort()) {
      if (!p.endsWith(".rs")) continue;
      const parts = p.replace(/\\/g, "/").split("/");
      const base = parts.pop();
      const isRoot = base === "mod.rs" || base === "lib.rs" || base === "main.rs";
      if (parts[parts.length - 1] === "src") parts.pop(); // src/ 不是 module path 的一部分
      if (isRoot) {
        // crate 根（ai-gateway/src/lib.rs → ai_gateway）+ 各長度尾碼鍵
        const normParts = parts.map(x => x.replace(/-/g, "_"));
        for (let i = 0; i < normParts.length; i++) put(normParts.slice(i).join("::"), p);
        continue;
      }
      const normParts = [...parts, base.replace(/\.rs$/, "")].map(x => x.replace(/-/g, "_"));
      // 全長 + 尾碼（crates/mock-server/src/routes/openai.rs → mock_server::routes::openai 等）
      for (let i = 0; i < normParts.length; i++) put(normParts.slice(i).join("::"), p);
    }
    fileSet._rustModIndex = idx; // Set 上掛 cache（同一 buildCodeGraph 生命週期）
  }
  const idx = fileSet._rustModIndex;
  for (let take = segs.length; take >= 1; take--) {
    const key = segs.slice(0, take).join("::");
    if (idx.has(key)) return idx.get(key);
  }
  return null;
}

function _resolveRustPath(fromFile, source, fileSet) {
  const segs = String(source || "").split("::").filter(Boolean);
  if (!segs.length) return null;
  const first = segs[0];
  if (first === "crate") {
    return _rustTryModule(_rustCrateSrcRoot(fromFile), segs.slice(1), fileSet);
  }
  if (first === "self") {
    return _rustTryModule(_rustModuleDir(fromFile), segs.slice(1), fileSet);
  }
  if (first === "super") {
    const modDir = _rustModuleDir(fromFile);
    modDir.pop(); // 上一層 module
    return _rustTryModule(modDir, segs.slice(1), fileSet);
  }
  // std / serde 等外部套件 → 尾碼比對自然 miss（repo 內無此 module path）→ null
  return _resolveRustBySuffix(segs, fileSet);
}

function _resolveBySuffix(source, fileSet, suffixDirs) {
  // Go module path / Java FQCN / TS alias（@/lib/x）→ 尾碼比對
  const parts = source.replace(/\\/g, "/").split("/").filter(Boolean);
  // 由長尾碼往短試：lib/internal/db → internal/db → db
  for (let take = parts.length; take >= 1; take--) {
    const tail = parts.slice(-take).join("/");
    for (const d of suffixDirs.get(tail) || []) return d;
  }
  return null;
}

/**
 * 建 file graph。回傳：
 * { files: string[](sorted), edges: Map<path, Set<path>>, byPath: Map<path, fileInfo> }
 */
export function buildCodeGraph(parsed) {
  const byPath = new Map();
  for (const f of parsed.files) if (f?.file) byPath.set(f.file, f);  // tree-sitter 欄位名 = file
  const fileSet = new Set(byPath.keys());

  // 尾碼索引（dir-tail → files）。只索引目錄尾，效能可控。
  const suffixDirs = new Map();
  for (const p of fileSet) {
    const segs = p.split("/");
    segs.pop(); // 檔名
    for (let take = Math.min(segs.length, 6); take >= 1; take--) {
      const tail = segs.slice(-take).join("/");
      if (!suffixDirs.has(tail)) suffixDirs.set(tail, []);
      suffixDirs.get(tail).push(p);
    }
  }
  for (const arr of suffixDirs.values()) arr.sort();

  // Java: package+class → 檔名索引
  const javaByClass = new Map(); // ClassName → [paths]
  for (const [p, f] of byPath) {
    if (f.language === "java") {
      const cls = p.split("/").pop().replace(/\.java$/, "");
      if (!javaByClass.has(cls)) javaByClass.set(cls, []);
      javaByClass.get(cls).push(p);
    }
  }

  const edges = new Map(); // importer → Set(imported)
  for (const [p, f] of byPath) edges.set(p, new Set());

  for (const [p, f] of byPath) {
    for (const imp of f.imports || []) {
      const src = String(imp.source || "");
      if (!src) continue;
      let target = null;
      if (src.startsWith(".") || src.startsWith("/")) {
        target = _resolveRelative(p, src, fileSet);
      }
      if (!target && f.language === "rust") {
        // Rust：use crate::… / self:: / super:: / workspace crate 名（:: 不是 /，須專屬解析）
        target = _resolveRustPath(p, src, fileSet);
      }
      if (!target && !src.startsWith(".") && (f.language === "go" || f.language === "java")) {
        // Go: github.com/x/repo/internal/db；Java: com.x.y.Z
        if (f.language === "java") {
          const cls = src.split(".").pop();
          const cands = (javaByClass.get(cls) || []).filter(x => x !== p);
          if (cands.length === 1) target = cands[0];
        }
        if (!target) target = _resolveBySuffix(src, fileSet, suffixDirs);
      }
      if (!target && !src.startsWith(".")) {
        // TS alias（@/x、~/x、#x）與 Python 絕對套件名 → 尾碼比對
        const bare = src.replace(/^[@~#]\//, "");
        if (/^[a-z@][\w@/.~-]*\//i.test(bare) || /^[a-z_][\w.]*$/i.test(bare)) {
          target = _resolveBySuffix(bare, fileSet, suffixDirs);
        }
      }
      if (target && target !== p) edges.get(p).add(target);
    }
  }
  const files = [...fileSet].sort();

  // Barrel 邊不再刪除（2026-10-23 全新骨架）：舊版「刪指向 barrel 的邊」導致「只透過 barrel 可達」的
  // 整層變孤兒（portkey providers/ 205 檔全消失）。新骨架改用 barrel 塌縮（_contractBarrels）恢復可達性。
  // （graph.edges 保留完整 import 圖；塌縮後的圖由 _contractBarrels 另建。）

  // Java 同 package 隱式依賴：Spring 分層同 package 不寫 import（controller/repo/model 同包互調）
  // → 同 package 檔案全連（clique，排序固定 = 決定論）
  const javaPkgs = new Map();
  for (const p of files) {
    const f = byPath.get(p);
    if (f.language !== "java") continue;
    const segs = p.split("/");
    const javaAt = segs.lastIndexOf("java");
    const pkg = javaAt >= 0 ? segs.slice(javaAt + 1, -1).join("/") : segs.slice(0, -1).join("/");
    if (!pkg) continue;
    if (!javaPkgs.has(pkg)) javaPkgs.set(pkg, []);
    javaPkgs.get(pkg).push(p);
  }
  for (const [, list] of [...javaPkgs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      if (i !== j) edges.get(list[i]).add(list[j]);
    }
  }

  return { files, edges, byPath };
}

// ─────────────────────────────────────────────
// 2. 進入點抽取（機器可枚舉的硬事實）
// ─────────────────────────────────────────────
const ENTRY_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options", "all"]);

export function extractEntryPoints(graph) {
  const entries = [];
  const NOISE_RE = /(^|\/)(test_|.+_test|.+\.test|.+\.spec)\.(ts|tsx|js|mjs|py|go)$|(^|\/)(tests?|docs|examples?|benchmarks?)\//;
  for (const [p, f] of graph.byPath) {
    if (NOISE_RE.test(p + "/")) continue; // 測試/文件/範例檔不是 feature 錨點
    // HTTP routes（tree-sitter 已解 TS/Python/Java/Go）
    for (const r of f.routes || []) {
      const method = String(r.method || "").toLowerCase();
      if (method && !ENTRY_METHODS.has(method)) continue;
      entries.push({ kind: "http", file: p, method: method || "get", path: String(r.path || ""), handler: r.handler || null });
    }
    // React/UI 元件頁
    for (const c of f.components || []) {
      if (c?.name) entries.push({ kind: "ui", file: p, name: String(c.name) });
    }
    // Go exported functions（大寫起頭 = 公開 API）
    if (f.language === "go") {
      for (const fn of f.functions || []) {
        if (/^[A-Z]/.test(String(fn?.name || ""))) entries.push({ kind: "api", file: p, name: String(fn.name) });
      }
    }
    // 函式庫 fallback：barrel 檔（index/mod/__init__）逐 export；Python 一般模組一檔一進入點
    // （同檔 reach set 相同必然同 cluster — 逐 def 只浪費；排除 test 檔）
    const base = p.split("/").pop();
    const isTest = /(^|\/)(test_|.+_test|.+\.test|.+\.spec)\./.test(base) || /(^|\/)tests?\//.test(p + "/");
    if (/^(index|mod|__init__)\.(ts|tsx|js|mjs|py)$/.test(base)) {
      for (const e of f.exports || []) {
        if (e?.name && e.kind !== "value") entries.push({ kind: "api", file: p, name: String(e.name) });
      }
    } else if ((f.language === "python" || f.language === "rust") && !base.startsWith("_") && !isTest && (f.exports || []).length > 0) {
      entries.push({ kind: "api", file: p, name: base.replace(/\.(py|rs)$/, "") });
    }
  }
  // 排序固定（決定論）：kind → file → method/path/name
  entries.sort((a, b) => (a.kind + "|" + a.file + "|" + (a.method || "") + (a.path || "") + (a.name || ""))
    .localeCompare(b.kind + "|" + b.file + "|" + (b.method || "") + (b.path || "") + (b.name || "")));
  // Barrel 過濾：有真進入點（http/ui）的群組，api-kind 進入點丟掉
  // （index.ts re-export、Python 公開 def、Go 大寫函式 — 在 web 服務裡都是內部實作不是 feature 錨點；
  //   gateway 實測 9 個 index.ts 假 cluster；純函式庫（requests）才留 api 當進入點）
  // 2026-10-23：改 per-crate — Rust workspace 裡某 crate 有 axum route 不該連坐丟掉
  // 其他 crate（binary gateway）的 pub API 進入點（ai-gateway 實測：全域過濾讓 165 檔全孤兒）。
  // 非 Rust 檔一律同一群（""）→ 行為與舊版全域過濾完全相同（tPAAW baseline 不變）。
  const BARREL_API_RE = /^(|.*\/)(index|mod|__init__)\.(ts|tsx|js|mjs|py)$|^(|.*\/)(lib|main|mod)\.rs$/;
  const crateGroupOf = (file) => {
    if (!file.endsWith(".rs")) return "";
    const segs = file.split("/");
    const i = segs.lastIndexOf("src");
    return i > 0 ? segs.slice(0, i).join("/") : "";
  };
  const byGroup = new Map();
  for (const e of entries) {
    const g = crateGroupOf(e.file);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(e);
  }
  const out = [];
  for (const [, list] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hasReal = list.some(e => e.kind === "http" || e.kind === "ui");
    if (hasReal) { out.push(...list.filter(e => e.kind !== "api")); continue; }
    // 純 library 群組：有非 barrel 的 api 進入點時，barrel（index/__init__/lib.rs）re-export 出口丟
    // （否則 barrel reachable-everything 把全 library 黏成一群 — requests 實測）
    const hasModuleApi = list.some(e => e.kind === "api" && !BARREL_API_RE.test(e.file));
    if (hasModuleApi) out.push(...list.filter(e => !(e.kind === "api" && BARREL_API_RE.test(e.file))));
    else out.push(...list);
  }
  return out;
}

// ─────────────────────────────────────────────
// 3. Reach closure（每個進入點沿 import 邊 BFS）
// ─────────────────────────────────────────────
export function computeReachSets(graph, entries) {
  return entries.map(e => {
    const seen = new Set([e.file]);
    const queue = [e.file];
    while (queue.length) {
      const cur = queue.shift();
      for (const nxt of graph.edges.get(cur) || []) {
        if (!seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
      }
    }
    return seen;
  });
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 4. Tier 分類（2026-10-23 全新骨架）
//    feature map 只認 source；example 目錄 roll-up 成單一 feature（不喧賓奪主）；
//    tooling/docs/test 不進主 map（meta 報告）。
// ─────────────────────────────────────────────
const TIER_EXAMPLE_RE = /^(examples?|cookbook|demos?|samples?|playground|sandbox)$/i;
const TIER_TOOLING_RE = /^(scripts?|tools?|bin|hack)$/i;
const TIER_DOCS_RE = /^(docs?|documentation|website|site)$/i;

/** 只認「前 2 層目錄」的 tier 目錄名 — 避免誤判深層套件名（Java org.springframework.samples.petclinic 的 samples） */
const _hasTopDir = (path, re) => {
  const segs = path.split("/");
  for (let i = 0; i < Math.min(2, segs.length - 1); i++) if (re.test(segs[i])) return true;
  return false;
};

export function classifyTier(p) {
  const path = String(p).replace(/\\/g, "/");
  if (isTestFile(path)) return "test";
  if (_hasTopDir(path, TIER_DOCS_RE)) return "docs";
  if (_hasTopDir(path, TIER_EXAMPLE_RE)) return "example";
  if (_hasTopDir(path, TIER_TOOLING_RE)) return "tooling";
  return "source";
}

// ─────────────────────────────────────────────
// 5. Barrel 塌縮（不是刪邊）：A→barrel→X ⇒ A→X
//    解「只透過 barrel 可達的整層變孤兒」，又不讓 barrel 當 hub 把所有群黏成一團。
// ─────────────────────────────────────────────
const BARREL_RE = /(^|\/)(index|mod|__init__)\.(ts|tsx|js|mjs|cjs|py)$|(^|\/)(lib|main|mod)\.rs$/;
export const isBarrel = (p) => BARREL_RE.test(String(p).replace(/\\/g, "/"));

function _contractBarrels(edges) {
  const out = new Map();
  for (const [p, s] of edges) out.set(p, new Set(s));
  // barrel 的有效目標（遞迴展開 barrel→barrel，cycle 安全）
  const effTargets = (start, seen) => {
    const res = new Set();
    const stack = [...(edges.get(start) || [])];
    while (stack.length) {
      const t = stack.pop();
      if (seen.has(t)) continue; seen.add(t);
      if (BARREL_RE.test(t)) { for (const x of edges.get(t) || []) stack.push(x); }
      else res.add(t);
    }
    return res;
  };
  for (const [p, outs] of edges) {
    if (BARREL_RE.test(p)) continue; // barrel 自己保持原出邊
    const seen = new Set([p]);
    for (const t of outs) {
      if (!BARREL_RE.test(t)) continue;
      for (const x of effTargets(t, seen)) if (x !== p) out.get(p).add(x);
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// 6. 全新骨架：Label Propagation 社群（100% 覆蓋、無 shared 黑洞）
//    + 目錄切分（拆大雜燴）+ 小群併回（解碎片）+ 入口標註
// ─────────────────────────────────────────────
const _dirOf = (p) => { const s = p.split("/"); s.pop(); return s.join("/"); };
const _minOf = (set) => [...set].sort()[0] || "";
const _lcpDir = (files) => {
  if (!files.length) return "";
  const dirs = files.map(f => _dirOf(f).split("/"));
  let n = dirs[0].length;
  for (const d of dirs) { let i = 0; while (i < n && i < d.length && d[i] === dirs[0][i]) i++; n = i; }
  return dirs[0].slice(0, n).join("/");
};
const _childUnder = (file, dir) => {
  const rel = dir ? file.slice(dir.length + 1) : file;
  const segs = rel.split("/");
  return segs.length > 1 ? segs[0] : "";
};
const _commonPrefixLen = (a, b) => {
  const x = a.split("/"), y = b.split("/");
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** 決定論 Label Propagation（固定遍歷序、async 更新、平手取字典序最小標籤；同目錄邊加權 2） */
function _labelPropagate(files, adj, { maxIter = 40 } = {}) {
  const label = new Map();
  for (const f of files) label.set(f, f);
  const dOf = new Map();
  const dir = (f) => { if (!dOf.has(f)) dOf.set(f, _dirOf(f)); return dOf.get(f); };
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (const f of files) { // files 已排序 → 決定論
      const nb = adj.get(f);
      if (!nb || nb.size === 0) continue;
      const w = new Map();
      const df = dir(f);
      for (const n of nb) {
        const l = label.get(n);
        if (l === undefined) continue;
        w.set(l, (w.get(l) || 0) + (dir(n) === df ? 2 : 1));
      }
      let best = null, bestW = -1;
      for (const [l, wt] of [...w.entries()].sort((a, b) => a[0].localeCompare(b[0]))) if (wt > bestW) { bestW = wt; best = l; }
      if (best && best !== label.get(f)) { label.set(f, best); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map();
  for (const f of files) { const l = label.get(f); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(f); }
  return [...groups.values()].map(g => g.sort());
}

/** 目錄切分：群 > maxFiles 且 LCP 目錄下有 ≥2 個強子目錄 → 拆（遞迴）。同質大目錄（如 plugins/*）自然不拆。 */
function _splitGroup(group, { minChild, maxFiles }) {
  if (group.length <= maxFiles) return [group];
  const dir = _lcpDir(group);
  const kids = new Map();
  for (const f of group) { const k = _childUnder(f, dir); if (!kids.has(k)) kids.set(k, []); kids.get(k).push(f); }
  const strong = [...kids.entries()].filter(([, fs]) => fs.length >= minChild);
  if (strong.length < 2) return [group];
  const strongKeys = new Set(strong.map(([k]) => k));
  const rest = [];
  for (const [k, fs] of kids) if (!strongKeys.has(k)) rest.push(...fs);
  const out = [];
  for (const [, fs] of strong) out.push(..._splitGroup(fs, { minChild, maxFiles }));
  if (rest.length) out.push(..._splitGroup(rest, { minChild, maxFiles }));
  return out;
}

/** 小群併回：< minFiles 的群併入「跨群邊數最多」的鄰群（平手取群內最小檔名）；無鄰群則自成小 feature。 */
function _mergeSmall(groups, adj, minFiles) {
  const gs = groups.map(g => new Set(g));
  for (let pass = 0; pass < 60; pass++) {
    let merged = false;
    const order = gs.map((_, i) => i).sort((a, b) => gs[a].size - gs[b].size || _minOf(gs[a]).localeCompare(_minOf(gs[b])));
    for (const i of order) {
      if (gs[i].size === 0 || gs[i].size >= minFiles) continue;
      const cnt = new Map();
      for (const f of gs[i]) for (const n of adj.get(f) || []) {
        for (let j = 0; j < gs.length; j++) if (j !== i && gs[j].size > 0 && gs[j].has(n)) cnt.set(j, (cnt.get(j) || 0) + 1);
      }
      if (!cnt.size) {
        // 無 import 鄰群 → 依「最近目錄」併入（例：plugins/build.ts → plugins/*）
        const myDir = _lcpDir([...gs[i]]);
        let bestJ = -1, bestLen = 0;
        for (let j = 0; j < gs.length; j++) {
          if (j === i || gs[j].size === 0) continue;
          const l = _commonPrefixLen(myDir, _lcpDir([...gs[j]]));
          if (l > bestLen || (l === bestLen && bestJ >= 0 && _minOf(gs[j]).localeCompare(_minOf(gs[bestJ])) < 0)) { bestLen = l; bestJ = j; }
        }
        if (bestJ < 0 || bestLen < 1) continue;
        for (const f of gs[i]) gs[bestJ].add(f);
        gs[i] = new Set();
        merged = true;
        continue;
      }
      const bestJ = [...cnt.entries()].sort((a, b) => (b[1] - a[1]) || _minOf(gs[a[0]]).localeCompare(_minOf(gs[b[0]])))[0][0];
      for (const f of gs[i]) gs[bestJ].add(f);
      gs[i] = new Set();
      merged = true;
    }
    if (!merged) break;
  }
  return gs.filter(g => g.size > 0).map(g => [...g].sort());
}

/** 寬目錄 roll-up：某目錄直屬子目錄 ≥ wide（集合型模組，如 providers/、plugins/）→ 其下所有群併成單一 feature。
 *  與目錄切分互補：切分拆「大雜燴」，roll-up 合「同質集合」。src/ 這類「模組容器」（子目錄少）不觸發。 */
function _rollupWideDirs(groups, srcFiles, { wide = 15 } = {}) {
  // 只數「子目錄」（檔案不算）— 否則每目錄都會被算成寬目錄
  const dirs = new Set();
  for (const f of srcFiles) {
    const segs = f.split("/");
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join("/"));
  }
  const dirChildren = new Map();
  for (const d of dirs) {
    const parent = d.split("/").slice(0, -1).join("/");
    if (!dirChildren.has(parent)) dirChildren.set(parent, new Set());
    dirChildren.get(parent).add(d);
  }
  const wideDirs = [...dirChildren.entries()].filter(([, ch]) => ch.size >= wide).map(([d]) => d).sort((a, b) => b.length - a.length || a.localeCompare(b));
  let gs = groups;
  for (let pass = 0; pass < 10; pass++) {
    const bucket = new Map(); // wideDir → [groupIdx]
    for (let i = 0; i < gs.length; i++) {
      const d = _lcpDir(gs[i]);
      const hit = wideDirs.find(w => d === w || d.startsWith(w + "/"));
      if (!hit) continue;
      if (!bucket.has(hit)) bucket.set(hit, []);
      bucket.get(hit).push(i);
    }
    let merged = false;
    const dead = new Set();
    const out = [];
    for (const [d, idxs] of [...bucket.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (idxs.length < 2) continue;
      const all = [];
      for (const i of idxs) { all.push(...gs[i]); dead.add(i); }
      out.push(all.sort());
      merged = true;
    }
    if (!merged) return gs;
    for (let i = 0; i < gs.length; i++) if (!dead.has(i)) out.push(gs[i]);
    gs = out;
  }
  return gs;
}

/** CLI/main 進入點：語言無關（go func main / rust fn main / ts main / java main / py __main__） */
function _mainEntry(f) {
  for (const fn of f.functions || []) {
    const n = String(fn?.name || "");
    if (n === "main" || n === "Main") return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// 7. 總裝：決定論 feature map（全新骨架，LLM 之前的全部）
//    不變式：source tier 每個檔案恰好落在一條 feature（coverage = 100%）。
// ─────────────────────────────────────────────
export function buildDeterministicFeatureMap(parsed, { maxFiles = 60, minChild = 8, minFiles = 4 } = {}) {
  const graph = buildCodeGraph(parsed);
  const entries = extractEntryPoints(graph);
  // CLI/main 進入點（語言無關）
  for (const [p, f] of graph.byPath) {
    if (classifyTier(p) !== "source") continue;
    if (_mainEntry(f) && !entries.some(e => e.file === p && e.kind === "cli")) {
      entries.push({ kind: "cli", file: p, name: p.split("/").pop() });
    }
  }
  entries.sort((a, b) => (a.kind + "|" + a.file + "|" + (a.name || "")).localeCompare(b.kind + "|" + b.file + "|" + (b.name || "")));

  const cedges = _contractBarrels(graph.edges);
  const reachSets = computeReachSets({ edges: cedges }, entries);

  // tier 分流（root 層非入口檔視為 tooling — 例：eslint.config.js / rollup.config.js / initializeSettings.ts）
  const allFiles = graph.files;
  const entryFiles = new Set(entries.map(e => e.file));
  const tierOf = (f) => {
    const t = classifyTier(f);
    if (t === "source" && !f.includes("/") && !entryFiles.has(f)) return "tooling";
    return t;
  };
  const testFiles = allFiles.filter(isTestFile);
  const srcFiles = allFiles.filter(f => tierOf(f) === "source");
  const exampleFiles = allFiles.filter(f => tierOf(f) === "example");
  const toolingFiles = allFiles.filter(f => tierOf(f) === "tooling");
  const docsFiles = allFiles.filter(f => tierOf(f) === "docs");

  // 無向鄰接（LPA 用）
  const adj = new Map();
  for (const f of srcFiles) adj.set(f, new Set());
  for (const f of srcFiles) for (const t of cedges.get(f) || []) if (adj.has(t)) adj.get(f).add(t);
  // 反向邊（import 是單向，社群偵測要雙向）
  for (const [a, set] of [...adj]) for (const b of set) adj.get(b)?.add(a);

  let groups = _labelPropagate(srcFiles, adj);
  groups = groups.flatMap(g => _splitGroup(g, { minChild, maxFiles }));
  groups = _mergeSmall(groups, adj, minFiles);
  groups = _rollupWideDirs(groups, srcFiles);

  const entryByFile = new Map();
  for (const e of entries) { if (!entryByFile.has(e.file)) entryByFile.set(e.file, []); entryByFile.get(e.file).push(e); }

  const mkFeature = (files, grade, extra = {}) => {
    const es = files.flatMap(f => entryByFile.get(f) || []);
    const apis = [...new Map(es.filter(e => e.kind === "http").map(e => [`${e.method} ${e.path}`, e])).values()]
      .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))
      .map(e => ({ method: e.method.toUpperCase(), path: e.path, file: e.file }));
    const kinds = {};
    for (const e of es) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    const rf = new Set();
    for (const f of files) for (const x of reachSets.find(rs => rs.has(f)) || []) rf.add(x);
    return {
      key: files.slice().sort().join("|").slice(0, 200),
      grade,
      kinds,
      entryCount: es.length,
      apis,
      codeFiles: files.slice().sort(),
      reachFiles: [...rf].sort(),
      ...extra,
    };
  };

  const features = groups.map(g => mkFeature(g, "deterministic"));
  // example tier → 每個頂層 example 目錄 roll-up 成單一 feature（grade=example，不喧賓奪主）
  const exByTop = new Map();
  for (const f of exampleFiles) {
    const segs = f.split("/");
    const key = segs.slice(0, segs.findIndex(s => TIER_EXAMPLE_RE.test(s)) + 1).join("/") || segs[0];
    if (!exByTop.has(key)) exByTop.set(key, []);
    exByTop.get(key).push(f);
  }
  for (const [, fs] of [...exByTop.entries()].sort((a, b) => a[0].localeCompare(b[0]))) features.push(mkFeature(fs, "example"));

  // 決定論排序：有 HTTP 入口的在前，其餘依檔名
  features.sort((a, b) => (b.apis.length - a.apis.length) || (_minOf(new Set(a.codeFiles)).localeCompare(_minOf(new Set(b.codeFiles)))));
  features.forEach((f, i) => { f.idx = i; });

  const tests = mapTestsToFeatures(testFiles, features, graph);
  const coveredAll = new Set(features.flatMap(f => f.codeFiles));
  const covered = new Set(srcFiles.filter(f => coveredAll.has(f)));
  const orphans = srcFiles.filter(f => !covered.has(f)); // 不變式下應為 0

  const prodCount = allFiles.length - testFiles.length;
  const stats = {
    files: allFiles.length,
    edges: [...graph.edges.values()].reduce((s, x) => s + x.size, 0),
    entries: entries.length,
    clusters: features.length,
    shared: 0, // 全新骨架：無 shared 黑洞（橫切碼由 LPA 群吸收）
    orphans: orphans.length,
    tiers: { source: srcFiles.length, example: exampleFiles.length, tooling: toolingFiles.length, docs: docsFiles.length, test: testFiles.length },
    tests: { total: testFiles.length, mapped: tests.featureTests.reduce((s, x) => s + x.length, 0), unmapped: tests.unmappedTests.length },
    coverage: srcFiles.length ? Math.round(covered.size / srcFiles.length * 100) : 100,
    edgeCoverage: prodCount > 0 ? Math.round((prodCount - orphans.length) / prodCount * 100) : 0,
  };
  return { features, shared: [], orphans, tests, stats, graph, examples: exampleFiles, tooling: toolingFiles };
}

/**
 * 測試檔 → feature（決定論）：
 *   1) test import 的 production 檔的 owner cluster 投票（e2e 實測：gateway-backup-auth.test.mjs → src/server.mjs）
 *   2) 無票 → basename 慣例（foo.test.mjs ↔ foo.*）
 *   3) 再無 → unmappedTests（ honest：dynamic import / 跨 feature 測試歸不了就明說，Test Intelligence 頁自己看）
 * 平手用最小 feature index 打破（features 已字典序排序 → 決定論）。
 */
function mapTestsToFeatures(testFiles, features, graph) {
  const featureTests = features.map(() => []);
  const unmappedTests = [];
  const ownerOf = new Map(); // production file → feature idx（shared 檔不投票 — 多 feature 共用歸屬不明）
  features.forEach((f, fi) => { for (const cf of f.codeFiles) { if (!ownerOf.has(cf)) ownerOf.set(cf, []); ownerOf.get(cf).push(fi); } });
  for (const tf of testFiles) {
    const votes = new Map();
    const vote = (fi) => votes.set(fi, (votes.get(fi) || 0) + 1);
    for (const target of graph.edges.get(tf) || []) for (const fi of ownerOf.get(target) || []) vote(fi);
    if (votes.size === 0) {
      const stem = _testStem(tf);
      if (stem) for (const [f, fis] of ownerOf) {
        if ((f.split("/").pop() || "").replace(/\.[^.]+$/, "") === stem) for (const fi of fis) vote(fi);
      }
    }
    if (votes.size > 0) {
      let bestFi = -1, bestV = -1;
      for (const [fi, v] of [...votes].sort((a, b) => a[0] - b[0])) if (v > bestV) { bestFi = fi; bestV = v; }
      featureTests[bestFi].push(tf);
    } else unmappedTests.push(tf);
  }
  return { featureTests, unmappedTests };
}

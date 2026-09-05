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

  // Barrel 透通規則（2026-09-05 requests 實測）：index.ts/__init__.py 是 re-export 表面不是依賴
  // — 指向 barrel 的邊刪除（否則 module → __init__ → everything 把所有 reach 撐成全包、Jaccard=1 全黏一群）；
  //   barrel 自己的出邊保留（barrel 當進入點時仍 reach 整包）
  const BARREL_RE = /(^|\/)(index|mod|__init__)\.(ts|tsx|js|mjs|py)$/;
  for (const [p, outs] of edges) {
    if (BARREL_RE.test(p)) continue;
    for (const t of [...outs]) if (BARREL_RE.test(t)) outs.delete(t);
  }

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
    } else if (f.language === "python" && !base.startsWith("_") && !isTest && (f.exports || []).length > 0) {
      entries.push({ kind: "api", file: p, name: base.replace(/\.py$/, "") });
    }
  }
  // 排序固定（決定論）：kind → file → method/path/name
  entries.sort((a, b) => (a.kind + "|" + a.file + "|" + (a.method || "") + (a.path || "") + (a.name || ""))
    .localeCompare(b.kind + "|" + b.file + "|" + (b.method || "") + (b.path || "") + (b.name || "")));
  // Barrel 過濾：專案有真進入點（http/ui）時，api-kind 進入點全丟
  // （index.ts re-export、Python 公開 def、Go 大寫函式 — 在 web 服務裡都是內部實作不是 feature 錨點；
  //   gateway 實測 9 個 index.ts 假 cluster；純函式庫（requests）才留 api 當進入點）
  const hasRealEntries = entries.some(e => e.kind === "http" || e.kind === "ui");
  if (hasRealEntries) return entries.filter(e => e.kind !== "api");
  // 純函式庫：有非 barrel 的 api 進入點時，__init__/index 的 re-export 出口也丟
  // （否則 barrel reachable-everything 把全 library 黏成一群 — requests 實測）
  const hasModuleApi = entries.some(e => e.kind === "api" && !/^(|.*\/)(index|mod|__init__)\.(ts|tsx|js|mjs|py)$/.test(e.file));
  if (hasModuleApi) return entries.filter(e => !(e.kind === "api" && /^(|.*\/)(index|mod|__init__)\.(ts|tsx|js|mjs|py)$/.test(e.file)));
  return entries;
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
// 4. Jaccard + 決定論 average-linkage 聚類
// ─────────────────────────────────────────────
function _jaccard(a, b) {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of s) if (l.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 平均連結凝聚分群：同 cluster 內所有 entry pair 的 Jaccard 平均 ≥ threshold 才可併。
 * 平手用字典序最小 cluster key 打破 → 完全決定論。
 */
export function clusterEntries(entries, reachSets, { threshold = 0.5 } = {}) {
  const n = entries.length;
  const pairJ = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = _jaccard(reachSets[i], reachSets[j]);
    pairJ[i * n + j] = v; pairJ[j * n + i] = v;
  }

  let clusters = entries.map((_, i) => [i]);
  const clusterKey = (c) => c.map(i => entries[i].file + "|" + (entries[i].path || entries[i].name || "")).sort().join(";");
  const avgJ = (a, b) => {
    let s = 0;
    for (const i of a) for (const j of b) s += pairJ[i * n + j];
    return s / (a.length * b.length);
  };

  while (true) {
    let best = null, bestJ = threshold;
    for (let x = 0; x < clusters.length; x++) for (let y = x + 1; y < clusters.length; y++) {
      const j = avgJ(clusters[x], clusters[y]);
      if (j >= bestJ) {
        const better = !best
          || j > bestJ + 1e-9
          || (Math.abs(j - bestJ) <= 1e-9 && clusterKey(clusters[x]).concat(";").concat(clusterKey(clusters[y])) < clusterKey(best[0]).concat(";").concat(clusterKey(best[1])));
        if (better) { best = [clusters[x], clusters[y]]; bestJ = j; }
      }
    }
    if (!best) break;
    clusters = clusters.filter(c => c !== best[0] && c !== best[1]);
    clusters.push([...best[0], ...best[1]].sort((a, b) => a - b));
  }

  clusters.sort((a, b) => clusterKey(a).localeCompare(clusterKey(b)));
  return clusters.map(idx => ({
    entryIdx: idx,
    key: clusterKey(idx),
    cohesion: idx.length > 1 ? avgJ(idx, idx) / 2 * idx.length * (idx.length - 1) / (idx.length * (idx.length - 1) / 2 || 1) : 1,
  }));
}

// ─────────────────────────────────────────────
// 5. 檔案歸屬：argmax（帶 margin）→ 否則 shared
// ─────────────────────────────────────────────
export function assignFileOwnership(clusters, reachSets, graph, { margin = 0.2 } = {}) {
  // fraction-based：file 屬於「最高比例進入點摸到它」的 cluster（正規化 cluster 大小 —
  // 13 入口大群的 2 個入口摸到 ≠ 擁有；2 入口小群 100% 摸到 = 核心檔案）
  const fileReachCount = new Map();
  for (const rs of reachSets) for (const f of rs) fileReachCount.set(f, (fileReachCount.get(f) || 0) + 1);

  const owned = clusters.map(() => new Set());
  const shared = [];
  for (const file of graph.files) {
    if (!fileReachCount.has(file)) continue; // orphan 另外算
    let bestC = -1, bestFrac = 0, secondFrac = 0;
    clusters.forEach((c, ci) => {
      let cnt = 0;
      for (const i of c.entryIdx) if (reachSets[i].has(file)) cnt++;
      const frac = c.entryIdx.length ? cnt / c.entryIdx.length : 0;
      if (frac > bestFrac + 1e-9) { secondFrac = bestFrac; bestFrac = frac; bestC = ci; }
      else if (frac > secondFrac + 1e-9) secondFrac = frac;
    });
    if (bestC >= 0 && bestFrac - secondFrac >= margin) owned[bestC].add(file);
    else if (bestC >= 0 && bestFrac > 0) shared.push(file); // 差距不足 → shared 層
  }

  const orphans = graph.files.filter(f => !fileReachCount.has(f));
  return { owned, shared: [...new Set(shared)].sort(), orphans };
}

// ─────────────────────────────────────────────
// 6. 總裝：決定論 feature map（LLM 之前的全部）
// ─────────────────────────────────────────────
export function buildDeterministicFeatureMap(parsed, { jaccardThreshold = 0.5 } = {}) {
  const graph = buildCodeGraph(parsed);
  const entries = extractEntryPoints(graph);
  const reachSets = computeReachSets(graph, entries);
  const clusters = clusterEntries(entries, reachSets, { threshold: jaccardThreshold });
  const { owned, shared, orphans } = assignFileOwnership(clusters, reachSets, graph, { margin: 0.2 });

  const features = clusters.map((c, ci) => {
    const es = c.entryIdx.map(i => entries[i]);
    const apis = [...new Map(es.filter(e => e.kind === "http").map(e => [`${e.method} ${e.path}`, e])).values()]
      .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))
      .map(e => ({ method: e.method.toUpperCase(), path: e.path, file: e.file }));
    const kinds = {};
    for (const e of es) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    return {
      key: c.key,
      grade: "deterministic",
      kinds,
      entryCount: es.length,
      apis,
      codeFiles: [...owned[ci]].sort(),
      reachFiles: reachSets[c.entryIdx[0]] ? [...new Set(c.entryIdx.flatMap(i => [...reachSets[i]]))].sort() : [],
    };
  }).filter(f => f.codeFiles.length > 0 || f.apis.length > 0);

  const stats = {
    files: graph.files.length,
    edges: [...graph.edges.values()].reduce((s, x) => s + x.size, 0),
    entries: entries.length,
    clusters: features.length,
    shared: shared.length,
    orphans: orphans.length,
    edgeCoverage: graph.files.length ? Math.round((graph.files.length - orphans.length) / graph.files.length * 100) : 0,
  };
  return { features, shared, orphans, stats, graph };
}

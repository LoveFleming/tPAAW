/**
 * feature-subfeature.mjs — L2 子群精煉（決定論，零 token）+ orphan 同型重複偵測
 * 2026-10-23 · 依 memory/feature-map-subfeature-design.md（內生判準版）實作
 *
 * Fleming 定調：「要不要拆 feature 不由檔數決定（外生門檻），由結構本身有沒有
 * 可發現、穩定、語義上分得開的子結構決定。大小從來不是輸入。」
 *
 * 三道內生閘門（Gate 1/2/3）：
 *   G1 結構穩定 — 參數自由分割（CNM modularity，ΔQ>0 → k 湧現，無 k 參數）
 *      + 擾動穩定共識（R 次固定 seed 丟邊/抖權重；同群率 ≥ CONSENSUS_MIN 的才算真子群）
 *   G2 語義分離 — 子群 identifier 詞彙（TF-IDF）within/cross 相似度對比 ≥ SEPARATION_MIN
 *   G3 表面 — 子群各自成為「可理解單位」（evidence 帶 vocabTop/terms 供命名與人審；
 *      黏合的不穩定檔歸 feature 內部 internalShared，不假裝是子 feature）
 *
 * 常數說明（都不是檔數門檻）：
 *   R_RUNS=25 / DROP_P=0.25 / JITTER — 擾動共識的標準取樣參數（cluster ensemble 慣例）
 *   CONSENSUS_MIN=0.8 — 共識門檻（consensus clustering 標準值，比率非檔數）
 *   SEPARATION_MIN=1.2 — 語義分離的「相對」門檻（比較用比率，非絕對值）
 *   STABLE_COVER_MIN=0.5 — 穩定群覆蓋率下限（分割品質的比率下限，非檔數）
 *
 * 決定論保證：固定 seed PRNG（mulberry32）、全序排序、無時間/隨機來源 —
 * 同輸入必 byte-level 同輸出。tests/unit/subfeature-refine.test.mjs 驗證。
 */
import { stableStringify } from "./stable-stringify.mjs";

// ── 常數（見上方說明；全部是比率/次數取樣參數，無任何檔數門檻）──
const SEED = 20261023;
const R_RUNS = 25;
const DROP_P = 0.25;
const JITTER_LO = 0.75, JITTER_HI = 1.25;
const CONSENSUS_MIN = 0.8;
const SEPARATION_MIN = 1.2;
const STABLE_COVER_MIN = 0.5;
const TEMPLATE_MIN_DIRS = 3; // 同型重複：≥3 個兄弟目錄同檔名模式才算 template（pattern 次數，非檔數）

/** mulberry32 — 決定論 PRNG */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═══════════════ G1：參數自由分割 + 擾動穩定共識 ═══════════════

/**
 * CNM greedy modularity（ΔQ>0 才 merge → 群數 k 湧現，無 k 參數）。
 * 稀疏圖最佳化：只掃 w>0 的候選 pair（O(E·rounds)，不是 O(n²)）。
 * weightAt: (i,j)=>w（i<j，已對稱化的無向權）
 */
export function cnmPartition(N, weightAt) {
  const comms = Array.from({ length: N }, (_, i) => [i]);
  if (N <= 1) return comms;
  const k = new Array(N).fill(0);
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const w = weightAt(i, j) || 0; k[i] += w; k[j] += w; }
  const m2 = k.reduce((s, v) => s + v, 0);
  if (m2 <= 0) return comms; // 無邊 → 全孤點（k=N 湧現，不硬合）
  // 鄰接串列（稀疏）：adj[i] = Map<j, w>
  const adj = Array.from({ length: N }, () => new Map());
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const w = weightAt(i, j) || 0;
    if (w > 0) { adj[i].set(j, w); adj[j].set(i, w); }
  }
  const commOf = Array.from({ length: N }, (_, i) => i);
  const sigma = comms.map((c) => c.reduce((s, x) => s + k[x], 0));
  while (comms.length > 1) {
    // 掃相鄰 community pair，ΔQ>0 才候選；ΔQ 最大者贏（掃描序固定 → 決定論）
    let best = null;
    for (let a = 0; a < comms.length; a++) {
      const wTo = new Map(); // b -> Σw
      for (const i of comms[a]) for (const [j, w] of adj[i]) {
        const b = commOf[j];
        if (b === a) continue;
        wTo.set(b, (wTo.get(b) || 0) + w);
      }
      for (const [b, wab] of wTo) {
        if (b <= a) continue;
        const dq = 2 * (wab / m2 - (sigma[a] / m2) * (sigma[b] / m2));
        if (dq > 1e-12 && (!best || dq > best[0])) best = [dq, a, b];
      }
    }
    if (!best) break; // ΔQ>0 不存在 → 停（k 湧現）
    const [, bestA, bestB] = best;
    const merged = [...comms[bestA], ...comms[bestB]].sort((x, y) => x - y);
    const next = comms.filter((_, x) => x !== bestA && x !== bestB);
    next.push(merged);
    comms.length = 0; comms.push(...next);
    // commOf 全量重建（filter+push 會讓其餘 community 索引位移 — 只更新 merged 會錯）
    comms.forEach((c, ci) => { for (const i of c) commOf[i] = ci; });
    // sigma 重建（同理由）
    const rebuilt = comms.map((c) => c.reduce((s, x) => s + k[x], 0));
    sigma.length = 0; sigma.push(...rebuilt);
  }
  return comms;
}

/**
 * 擾動穩定共識：R 次決定論擾動（丟邊 DROP_P + 權重抖動 JITTER_LO..HI）各跑一次 CNM，
 * 統計同群頻率矩陣，取共識 ≥ CONSENSUS_MIN 的連通分量。
 * 回傳 { stable: [[idx...]], agreement: Float64Array(N×N)/R, kMedian }
 */
export function stabilityConsensus(N, baseEdges, opts = {}) {
  const { rRuns = R_RUNS, drop = DROP_P, seed = SEED } = opts;
  // baseEdges: Map<"i,j", w>（i<j）
  const runs = [];
  for (let r = 0; r < rRuns; r++) {
    const rnd = mulberry32(seed + r * 7919);
    const wt = (i, j) => {
      const w = baseEdges.get(i < j ? i + "," + j : j + "," + i) || 0;
      if (!w) return 0;
      return rnd() < drop ? 0 : w * (JITTER_LO + (JITTER_HI - JITTER_LO) * rnd());
    };
    runs.push(cnmPartition(N, wt));
  }
  const agree = Array.from({ length: N }, () => new Float64Array(N));
  for (const comms of runs) for (const c of comms) for (const i of c) for (const j of c) if (i !== j) agree[i][j]++;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) agree[i][j] /= rRuns;
  // 共識分量（union-find at CONSENSUS_MIN；掃描序固定 → 決定論）
  const seen = new Array(N).fill(false); const stable = [];
  for (let i = 0; i < N; i++) {
    if (seen[i]) continue;
    const comp = [i]; seen[i] = true;
    for (let q = 0; q < comp.length; q++) {
      const u = comp[q];
      for (let v = 0; v < N; v++) if (!seen[v] && agree[u][v] >= CONSENSUS_MIN) { seen[v] = true; comp.push(v); }
    }
    stable.push(comp.sort((a, b) => a - b));
  }
  const ks = runs.map((c) => c.length).sort((a, b) => a - b);
  return { stable, agreement: agree, kMedian: ks[Math.floor(ks.length / 2)] };
}

// ═══════════════ G2：語義分離（identifier 詞彙 TF-IDF）═══════════════

const IDENT_SPLIT = /(?=[A-Z])|_|(?<=[a-z])(?=\d)|-|\./;
/** 檔案 → 詞彙 token 集（函數/類別/匯出/路由名切詞，小寫、去虛詞） */
export function vocabTokensOfFile(fileInfo) {
  const raw = [];
  for (const fn of fileInfo?.functions || []) if (fn?.name) raw.push(String(fn.name));
  for (const cl of fileInfo?.classes || []) raw.push(cl?.name ? String(cl.name) : "");
  for (const ex of fileInfo?.exports || []) raw.push(typeof ex === "string" ? ex : String(ex?.name || ""));
  for (const rt of fileInfo?.routes || []) raw.push(rt?.path ? String(rt.path).split("/").join(" ") : "");
  const STOP = new Set(["new", "get", "set", "the", "a", "an", "of", "to", "for", "and", "or", "init", "test", "main", "index", "mod", "lib", "utils", "types", "src"]);
  const toks = new Set();
  for (const s of raw) {
    for (const part of String(s || "").split(IDENT_SPLIT)) {
      const t = String(part || "").toLowerCase().trim();
      if (t.length >= 3 && t.length <= 24 && !STOP.has(t) && !/^\d+$/.test(t)) toks.add(t);
    }
  }
  return [...toks].sort();
}

/** 群詞彙 TF-IDF 向量（vs 全 feature 語料）；回傳 centroid + top terms + pairwise 工具 */
function vocabCentroid(membersToks, dfCounts, totalDocs) {
  const vec = new Map();
  for (const toks of membersToks) {
    const seen = new Set();
    for (const t of toks) {
      if (seen.has(t)) continue; seen.add(t);
      const df = dfCounts.get(t) || 1;
      const idf = Math.log((totalDocs + 1) / df);
      vec.set(t, (vec.get(t) || 0) + idf);
    }
  }
  const n = Math.max(1, membersToks.length);
  for (const [t, v] of vec) vec.set(t, v / n);
  return vec;
}
const _cos = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const [t, v] of a) { na += v * v; const w = b.get(t); if (w) dot += v * w; }
  for (const [, v] of b) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
const _topTerms = (vec, n = 5) => [...vec].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, n).map(([t]) => t);

/** G2：within（成員 vs 自群 centroid）與 cross（各群 centroid 兩兩）相似度對比 */
export function vocabSeparation(groupsToks) {
  const totalDocs = groupsToks.reduce((s, g) => s + g.length, 0) || 1;
  const dfCounts = new Map();
  for (const g of groupsToks) for (const toks of g) for (const t of new Set(toks)) dfCounts.set(t, (dfCounts.get(t) || 0) + 1);
  const cents = groupsToks.map((g) => vocabCentroid(g, dfCounts, totalDocs));
  let withinSum = 0, withinN = 0;
  groupsToks.forEach((g, gi) => {
    const c = cents[gi];
    for (const toks of g) { withinSum += _cos(vocabCentroid([toks], dfCounts, totalDocs), c); withinN++; }
  });
  let crossSum = 0, crossN = 0;
  for (let i = 0; i < cents.length; i++) for (let j = i + 1; j < cents.length; j++) { crossSum += _cos(cents[i], cents[j]); crossN++; }
  const within = withinN ? withinSum / withinN : 0;
  const cross = crossN ? crossSum / crossN : 0;
  const ratio = cross > 1e-9 ? within / cross : within > 1e-9 ? 99 : 1; // 完全分離 → 99（避免 JSON Infinity）
  return { within, cross, ratio, topTerms: cents.map((c) => _topTerms(c)) };
}

// ═══════════════ L2 主入口：對單一 L1 feature 做精煉 ═══════════════

/**
 * refineOneFeature — 內生判準精煉一個 feature。
 * @param files 該 feature 的 codeFiles（相對路徑，已排序）
 * @param graphEdges Map<path, Iterable<path>> direct import 邊
 * @param fileInfoOf path => parsed file info（詞彙用；可能 undefined）
 * @returns {split, subFeatures:[{key, codeFiles, consensus, vocabTop}], internalShared, evidence}
 *   split=false 時 subFeatures=[]、internalShared=[]（不拆 — 原子 feature）
 */
export function refineOneFeature(files, graphEdges, fileInfoOf) {
  const sorted = [...files].sort();
  const N = sorted.length;
  const idx = new Map(sorted.map((f, i) => [f, i]));
  // 無向 IDF 加權邊：import 稀有模組才算訊號（hub 折扣 — G1 前處理）
  const indeg = new Array(N).fill(0);
  const rawPairs = [];
  for (const f of sorted) {
    for (const t of graphEdges.get(f) || []) {
      if (t === f) continue;
      const j = idx.get(t);
      if (j === undefined) continue;
      rawPairs.push([idx.get(f), j]);
      indeg[j]++;
    }
  }
  const idf = indeg.map((d) => Math.log((N + 1) / (d + 1)));
  const baseEdges = new Map();
  for (const [i, j] of rawPairs) {
    const key = i < j ? i + "," + j : j + "," + i;
    baseEdges.set(key, (baseEdges.get(key) || 0) + idf[j]); // 被 import 者的稀有度計權
  }
  // G1：擾動穩定共識（k 湧現 + 只留穩定群）
  const { stable, kMedian, agreement } = stabilityConsensus(N, baseEdges);
  const groups = stable.filter((c) => c.length >= 2);
  const internalShared = stable.filter((c) => c.length < 2).flat().sort((a, b) => a - b);
  const covered = groups.reduce((s, c) => s + c.length, 0);
  // G1 品質：至少 2 個穩定群 且 覆蓋率過線（比率，非檔數）
  if (groups.length < 2 || covered / Math.max(1, N) < STABLE_COVER_MIN) {
    return _noSplit(sorted, { kMedian, stableGroups: groups.length, covered: +(covered / Math.max(1, N)).toFixed(3), reason: groups.length < 2 ? "no-stable-structure" : "low-stable-coverage" });
  }
  // 群排序（size desc → 首檔字典序）— 決定論
  groups.sort((a, b) => b.length - a.length || sorted[a[0]].localeCompare(sorted[b[0]]));
  // G2：語義分離
  const toks = groups.map((c) => c.map((i) => vocabTokensOfFile(fileInfoOf?.(sorted[i]))));
  const sep = vocabSeparation(toks);
  if (!(sep.ratio >= SEPARATION_MIN)) {
    return _noSplit(sorted, { kMedian, stableGroups: groups.length, covered: +(covered / N).toFixed(3), separation: +sep.ratio.toFixed(3), reason: "vocab-not-separable" });
  }
  const groupConsensus = (c) => {
    let sum = 0, n = 0;
    for (let x = 0; x < c.length; x++) for (let y = x + 1; y < c.length; y++) { sum += agreement[c[x]][c[y]]; n++; }
    return n ? +(sum / n).toFixed(3) : 1;
  };
  const subFeatures = groups.map((c, n) => ({
    key: "SF" + (n + 1),
    codeFiles: c.map((i) => sorted[i]),
    consensus: groupConsensus(c),
    vocabTop: sep.topTerms[n] || [],
  }));
  return {
    split: true,
    subFeatures,
    internalShared: internalShared.map((i) => sorted[i]),
    evidence: {
      method: "stability-consensus-v1",
      files: N, kMedian, stableGroups: groups.length,
      covered: +(covered / N).toFixed(3),
      separation: +sep.ratio.toFixed(3),
      within: +sep.within.toFixed(3), cross: +sep.cross.toFixed(3),
      shared: internalShared.length,
    },
  };
}
function _noSplit(sorted, evidence) {
  return { split: false, subFeatures: [], internalShared: [], evidence: { method: "stability-consensus-v1", files: sorted.length, ...evidence } };
}

/** 對整個 deterministic map 跑 L2（feature 順序對齊 dm.features） */
export function computeSubFeatureRefinement(dm, parsed) {
  const fileInfoOf = new Map();
  for (const f of parsed?.files || []) if (f?.file) fileInfoOf.set(String(f.file).replace(/\\/g, "/"), f);
  return dm.features.map((feat) => {
    try {
      const r = refineOneFeature(feat.codeFiles || [], dm.graph?.edges || new Map(), (p) => fileInfoOf.get(p));
      // 補真共識值（用 agreement 矩陣重算一次太貴 — evidence 裡 kMedian/覆蓋已足夠審計；consensus 留 null）
      return r;
    } catch { return { split: false, subFeatures: [], internalShared: [], evidence: { method: "stability-consensus-v1", files: (feat.codeFiles || []).length, reason: "error" } }; }
  });
}

// ═══════════════ C：orphan 同型重複偵測（template pattern，零 token）═══════════════

/**
 * detectTemplateOrphans — 兄弟目錄同檔名模式偵測。
 * 例：src/providers/{openai,anthropic,moonshot,...}/{api.ts,index.ts} ×N
 *   → 一個決定論群「<父目錄> 同型單元（N×）」，不進 LLM orphan 分組。
 * @param orphans 未映射檔案清單（相對路徑）
 * @returns { templateGroups: [{name, description, files, pattern, dirs}], remaining: [...] }
 */
export function detectTemplateOrphans(orphans) {
  const byDir = new Map();
  for (const f of orphans) {
    const p = f.replace(/\\/g, "/");
    const dir = p.slice(0, p.lastIndexOf("/")) || "(root)";
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    byDir.get(dir).set(base, p);
  }
  // 父目錄 → { patternKey → [dirs] }
  const parentPatterns = new Map();
  for (const [dir, bases] of byDir) {
    if (dir === "(root)") continue;
    const parent = dir.slice(0, dir.lastIndexOf("/")) || "(root)";
    const pattern = [...bases.keys()].sort().join("|");
    if (!parentPatterns.has(parent)) parentPatterns.set(parent, new Map());
    const pm = parentPatterns.get(parent);
    if (!pm.has(pattern)) pm.set(pattern, []);
    pm.get(pattern).push(dir);
  }
  const templateGroups = [];
  const taken = new Set();
  for (const [parent, pm] of [...parentPatterns].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const [pattern, dirs] of [...pm].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (dirs.length < TEMPLATE_MIN_DIRS) continue;
      const files = dirs.flatMap((d) => [...byDir.get(d).values()]).sort();
      if (!files.length) continue;
      const parentName = parent === "(root)" ? "(root)" : parent.slice(parent.lastIndexOf("/") + 1);
      templateGroups.push({
        name: `${parentName} 同型單元（${dirs.length}×）`,
        description: `決定論偵測：${dirs.length} 個兄弟目錄共用相同檔名模式（${pattern}）— 同型重複結構，機械歸一。`,
        files, pattern, dirs: dirs.sort(),
      });
      files.forEach((f) => taken.add(f));
    }
  }
  templateGroups.sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const remaining = orphans.filter((f) => !taken.has(f));
  return { templateGroups, remaining };
}

/** 決定論自檢：同輸入兩跑 byte-level 一致（測試用） */
export function refinementFingerprint(refinements) {
  return stableStringify(refinements.map((r) => ({ split: r.split, subs: r.subFeatures.map((s) => [s.key, s.codeFiles]), shared: r.internalShared, ev: r.evidence })));
}

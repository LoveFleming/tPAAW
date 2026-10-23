/**
 * Test Signals — 測試自足性（hermeticity）判定
 *
 * 哲學（跟 PAAW 一致）：程式給事實，AI 給判斷。
 *   - 本檔 = 確定性層（零 token）：靜態掃測試檔 + 依賴 reach → 貼標籤 + 附 evidence
 *   - 模糊案子留給 LLM 層（後續 enrich）
 *
 * 語言無關設計（重要）：加語言 = 加 data/test-signals/*.json 的 row，不改本檔邏輯。
 *   第 1 層：依賴 reach（最強）— 測試沿 local import/use 走，碰到「外部端點/HTTP client」→ 不自足
 *   第 2 層：共用符號辭典 — *_API_KEY / *_TOKEN / REDIS_URL…（跨語言同名）
 *   第 3 層：語言模式表 — 各語言的 mock / http / env / service 標記
 *
 * 標籤：hermetic | needs-key | needs-network | needs-service
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { stableStringify } from "./stable-stringify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 找 data/test-signals（開發 repo / 公司部署都能跑） */
function _locateTablesDir() {
  const cands = [
    join(__dirname, "../../../data/test-signals"), // packages/server/src/lib → repo/data
    join(__dirname, "../../../../data/test-signals"),
    join(process.cwd(), "data/test-signals"),
    join(process.env.PAAW_ROOT || "", "data/test-signals"),
  ];
  for (const c of cands) if (c && existsSync(join(c, "hermeticity.json"))) return c;
  return null;
}

let _cache = null;
export function loadTestSignalTables(force = false) {
  if (_cache && !force) return _cache;
  const dir = _locateTablesDir();
  if (!dir) {
    _cache = { conventions: { dirPatterns: [], filePatterns: { shared: [] }, extensionToLanguage: {} }, hermeticity: { sharedLexicon: {}, languages: {}, rules: {} } };
    return _cache;
  }
  const conventions = JSON.parse(readFileSync(join(dir, "conventions.json"), "utf-8"));
  const hermeticity = JSON.parse(readFileSync(join(dir, "hermeticity.json"), "utf-8"));
  _cache = { conventions, hermeticity };
  return _cache;
}

/** 資料表健檢：所有 pattern 必須是可編譯的 regex（防「加語言時寫壞 pattern 被靜默跳過」）*/
export function validateTables(tables) {
  const t = tables || loadTestSignalTables(true);
  const errors = [];
  const check = (where, pat) => {
    try { new RegExp(pat); } catch (e) { errors.push(`${where} → ${pat} ：${e.message}`); }
  };
  for (const [lang, v] of Object.entries(t.hermeticity?.languages || {})) {
    for (const [bucket, pats] of Object.entries(v || {})) for (const p of pats || []) check(`${lang}.${bucket}`, p);
  }
  for (const [bucket, pats] of Object.entries(t.hermeticity?.sharedLexicon || {})) for (const p of pats || []) check(`sharedLexicon.${bucket}`, p);
  for (const p of t.conventions?.dirPatterns || []) check("conventions.dirPatterns", p);
  for (const p of t.conventions?.filePatterns?.shared || []) check("conventions.filePatterns", p);
  return errors;
}

/** 測試檔偵測（慣例表；語言無關） */
export function isTestPath(path, conventions) {
  const c = conventions || loadTestSignalTables().conventions;
  const p = String(path).replace(/\\/g, "/");
  for (const d of c.dirPatterns || []) {
    try { if (new RegExp(d, "i").test(p + "/")) return true; } catch { /* 壞 pattern 跳過 */ }
  }
  const base = p.split("/").pop() || "";
  for (const f of c.filePatterns?.shared || []) {
    try { if (new RegExp(f, "i").test(base) || new RegExp(f, "i").test(p)) return true; } catch { /* skip */ }
  }
  return false;
}

export function languageOf(path, conventions) {
  const c = conventions || loadTestSignalTables().conventions;
  const ext = extname(String(path)).replace(".", "").toLowerCase();
  return c.extensionToLanguage?.[ext] || "unknown";
}

function _any(re, content) {
  for (const r of re || []) {
    try { if (new RegExp(r).test(content)) return r; } catch { /* skip */ }
  }
  return null;
}

/** 只取測試區塊（inline unit test：source 檔裡含 #[cfg(test)] / describe / def test_）
 * 修正：source 檔內嵌測試時，不要把整支 production code 的訊號算進測試自己的訊號 */
export function testRegion(content, language, isConventionalTestFile) {
  if (isConventionalTestFile) return content;
  const markers = {
    rust: /#\[cfg\(test\)\]/,
    ts: /\n\s*describe\s*\(|\n\s*(?:it|test)\s*\(/,
    py: /\ndef test_|\nclass Test/,
    go: /\nfunc Test/,
    java: /@Test\b/,
    ruby: /\n\s*describe\s+|\n\s*it\s+['"]/,
  };
  const re = markers[language];
  if (!re) return content;
  const m = re.exec(content);
  return m ? content.slice(m.index) : content;
}

/** 抓檔案自己的訊號（不含 reach） */
export function ownSignals(content, language, hermeticity) {
  const lang = hermeticity?.languages?.[language] || {};
  const lex = hermeticity?.sharedLexicon || {};
  const s = { mock: [], key: [], http: [], url: [], service: [] };

  const push = (bucket, hit) => { if (hit && !s[bucket].includes(hit)) s[bucket].push(hit); };

  // 語言模式表
  push("mock", _any(lang.mock, content));
  const httpHit = _any(lang.http, content);
  const svcHit = _any(lang.serviceStart, content);
  const envHit = _any(lang.envRead, content);

  // 共用辭典（跨語言）
  const keyHit = _any(lex.key, content);
  const svcLexHit = _any(lex.service, content);

  if (keyHit) push("key", `lexicon:${keyHit}`);
  if (keyHit && envHit) push("key", `env:${envHit}`);

  // 外部端點字面值（排除 localhost）— 只當 evidence。
  // 測試檔自己出現 URL 常是斷言資料（如 config 測試）→ 不能單獨當連外證據；
  // 但「依賴檔」出現硬寫外部端點 = 真外部依賴 → 在 reach 層才算。
  const ext = [...content.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]).filter((u) => !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u));
  for (const u of ext.slice(0, 3)) push("url", `url:${u}`);

  if (httpHit) push("http", httpHit);
  if (svcLexHit) push("service", `lexicon:${svcLexHit}`);
  if (svcHit) push("service", svcHit);
  return s;
}

/** 合併訊號 */
function _merge(a, b) {
  const cat = (k) => [...new Set([...(a[k] || []), ...(b[k] || [])])];
  return { mock: cat("mock"), key: cat("key"), http: cat("http"), url: cat("url"), service: cat("service") };
}

/** 依規則判標籤 */
export function labelFromSignals(s, own) {
  // 順序：服務（mock 也救不了基礎設施）> 自己有 mock（能控制依賴 → 自足）> 金鑰 > 連網 > 自足
  const o = own || s;
  if (s.service.length) return "needs-service";
  if (o.mock.length) return "hermetic";
  if (s.key.length) return "needs-key";
  if (s.http.length) return "needs-network";
  return "hermetic";
}

// ── local import 解析（TS/Py 相對路徑；Rust 模組路徑；Go/Java 略）──
const EXT_TRY = {
  ts: [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"],
  py: [".py", "/__init__.py"],
  rust: [".rs", "/mod.rs"],
  go: [".go"],
  java: [".java"],
  ruby: [".rb"],
};

/** 抽出 local（repo 內）import 目標路徑 */
export function localImports(content, curPath, language) {
  const out = new Set();
  const norm = (rel) => {
    const p = resolve(dirname(curPath), rel).replace(/\\/g, "/");
    for (const e of EXT_TRY[language] || []) if (existsSync(p + e)) return p + e;
    if (existsSync(p)) return p;
    return null;
  };
  if (language === "ts") {
    for (const m of content.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const r = norm(m[1].replace(/\.(js|mjs|cjs)$/, "")); // TS 常寫 .js 但實體 .ts
      if (r) out.add(r);
    }
  } else if (language === "py") {
    for (const m of content.matchAll(/(?:from\s+([.a-zA-Z_][\w.]*)\s+import|import\s+([.a-zA-Z_][\w.]*))/g)) {
      const mod = (m[1] || m[2] || "").trim();
      if (!mod.startsWith(".")) continue;
      const rel = mod.replace(/\./g, "/");
      const r = norm(rel);
      if (r) out.add(r);
    }
  } else if (language === "rust") {
    // crate::a::b 或 use crate::a; → 找 src/**/a/b.rs 或 src/a/b/mod.rs（粗解析）
    for (const m of content.matchAll(/use\s+([a-z_][\w:]*)::/g)) {
      const segs = m[1].split("::");
      if (segs[0] !== "crate") continue;
      const tail = segs.slice(1).join("/");
      for (const base of [`${tail}.rs`, `${tail}/mod.rs`]) {
        let d = dirname(curPath);
        for (let i = 0; i < 6; i++) {
          const cand = resolve(d, `src/${base}`).replace(/\\/g, "/");
          if (existsSync(cand)) { out.add(cand); break; }
          d = dirname(d);
        }
      }
    }
  }
  return [...out];
}

// ── Go / Java 的 reach 種子（同 package = 被測對象，不靠 import 語句）──
function _goModule(root) {
  try {
    const first = readFileSync(join(root, "go.mod"), "utf-8").split("\n").find((l) => l.startsWith("module "));
    return first ? first.replace(/^module\s+/, "").trim() : null;
  } catch { return null; }
}

function _goSeeds(abs, content, root) {
  const out = new Set();
  const addDir = (d) => {
    try { for (const f of readdirSync(d)) if (f.endsWith(".go") && !/_test\.go$/.test(f)) out.add(join(d, f)); } catch { /* skip */ }
  };
  addDir(dirname(abs)); // 同目錄 = 被測 package（Go 測試同 package 不需 import）
  // go.mod 由測試檔往上找（支援 repo 內多 module / 巢狀 workspace）
  let d = dirname(abs), mod = null, modRoot = root;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "go.mod"))) { mod = _goModule(d); modRoot = d; break; }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  if (mod) {
    for (const m of content.matchAll(/"([\w./-]+)"/g)) {
      const imp = m[1];
      if (!imp.startsWith(mod + "/")) continue;
      addDir(join(modRoot, imp.slice(mod.length + 1)));
    }
  }
  return [...out];
}

function _javaSeeds(abs, content, root) {
  const out = new Set();
  const mentions = (f) => {
    const cls = f.replace(/\.java$/, "");
    try { return new RegExp(`\\b${cls}\\b`).test(content); } catch { return false; }
  };
  const addDir = (d, filter) => {
    try {
      for (const f of readdirSync(d)) {
        if (!f.endsWith(".java")) continue;
        if (filter && !mentions(f)) continue; // 同 package 只加測試內容有提到的類（\b 邊界，ApiTest 不算提到 Api）
        out.add(join(d, f));
      }
    } catch { /* skip */ }
  };
  addDir(dirname(abs), true); // 同 package 未 import 的類（有提到才算）
  const main = abs.replace(/\/src\/test\/java\//, "/src/main/java/");
  if (main !== abs) addDir(dirname(main), true); // 鏡像：src/test/java → src/main/java（有提到才算）
  // 源樹根由測試檔往上找（專案可能不在 projectRoot 頂層）
  let base = root;
  let d = dirname(abs);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "src/main/java")) || existsSync(join(d, "src/test/java"))) { base = d; break; }
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const m of content.matchAll(/import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/g)) {
    const star = !!m[2];
    const q = m[1].split(".");
    const cls = star ? null : q.pop(); // import a.b.C → 只加 C；import a.b.* → 整個 package
    const pkgDir = q.join("/");
    for (const r of ["src/main/java", "src/test/java", "src/java", "java"]) {
      const t = join(base, r, pkgDir);
      if (existsSync(t)) {
        if (cls) { const f = join(t, cls + ".java"); if (existsSync(f)) out.add(f); }
        else addDir(t, true);
        break;
      }
    }
  }
  return [...out];
}

/**
 * 主判定：對單一測試檔算標籤（含 reach）
 * @param {string} projectRoot
 * @param {string} testPath 絕對或相對 projectRoot
 * @param {{tables?:object, maxDepth?:number}} opts
 */
export function classifyTestFile(projectRoot, testPath, opts = {}) {
  const tables = opts.tables || loadTestSignalTables();
  const { hermeticity } = tables;
  const abs = resolve(projectRoot, testPath).replace(/\\/g, "/");
  const rel = abs.startsWith(projectRoot) ? abs.slice(String(projectRoot).replace(/\\/g, "/").length + 1) : testPath;
  const language = languageOf(testPath, tables.conventions);

  let content = "";
  try { content = readFileSync(abs, "utf-8"); } catch { return { file: rel, language, hermeticity: "unknown", signals: {}, note: "讀不到檔" }; }

  const conventional = isTestPath(testPath, tables.conventions);
  const own = ownSignals(testRegion(content, language, conventional), language, hermeticity);

  // reach：BFS local import，看是否碰到「外部端點/HTTP client」
  // 只對「慣例測試檔」（獨立整合測試）做 reach；inline unit test（source 檔內 #[cfg(test)]）不 bootstrap 整個 app，只看自身訊號。
  const maxDepth = opts.maxDepth ?? 3;
  const seen = new Set([abs]);
  let reach = { mock: [], key: [], http: [], service: [] };
  let frontier = [];
  if (conventional) {
    if (language === "go") frontier = _goSeeds(abs, content, projectRoot).filter((f) => !seen.has(f));
    else if (language === "java") frontier = _javaSeeds(abs, content, projectRoot).filter((f) => !seen.has(f));
    else frontier = [abs];
  }
  const reachEvidence = [];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) {
      let c = "";
      try { c = readFileSync(f, "utf-8"); } catch { continue; }
      // frontier 檔（被測 code / 依賴）本身的訊號要掃（Go/Java 的 seed 走這裡；ts/py/rust 的 abs 跳過 —— own 已算過，避免把測試自己的 URL 字面值灌進 reach）
      if (f !== abs) {
        const ssig = ownSignals(c, languageOf(f, tables.conventions), hermeticity);
        const sdep = { mock: [], key: ssig.key.filter((x) => x.startsWith("env:")), http: [...ssig.url], url: [], service: ssig.service };
        if (sdep.key.length || sdep.http.length || sdep.service.length) {
          const rp = f.startsWith(String(projectRoot)) ? f.slice(String(projectRoot).length + 1) : f;
          reachEvidence.push({ via: rp, key: sdep.key, http: sdep.http, service: sdep.service });
        }
        reach = _merge(reach, sdep);
      }
      for (const imp of localImports(c, f, language)) {
        if (seen.has(imp)) continue;
        seen.add(imp);
        next.push(imp);
        let ic = "";
        try { ic = readFileSync(imp, "utf-8"); } catch { continue; }
        const isig = ownSignals(ic, languageOf(imp, tables.conventions), hermeticity);
        // 只採信 dependency 的「硬外部」性質：
        //   - 明確外部 URL 字面值（url:）— 不是泛用 fetch(（共用 util 含 fetch 不代表本測試連外）
        //   - 真正讀 env 的金鑰（env:）— 不是光出現 API_KEY 字樣
        //   - 服務/基礎設施（service）
        const depSig = {
          mock: [],
          key: isig.key.filter((x) => x.startsWith("env:")),
          // 依賴檔：只採信「硬寫外部端點」（url）—— 泛用 fetch(/client 太常見（共用 util 也會有）易誤判
          http: [...isig.url],
          url: [],
          service: isig.service,
        };
        if (depSig.key.length || depSig.http.length || depSig.service.length) {
          const rp = imp.startsWith(String(projectRoot)) ? imp.slice(String(projectRoot).length + 1) : imp;
          reachEvidence.push({ via: rp, key: depSig.key, http: depSig.http, service: depSig.service });
        }
        reach = _merge(reach, depSig);
      }
    }
    frontier = next;
  }

  const merged = _merge(own, reach);
  const label = labelFromSignals(merged, own);

  const evidence = [];
  for (const [k, v] of Object.entries(own)) if (k !== "url") for (const x of v) evidence.push(`self:${k}=${x}`);
  for (const r of reachEvidence.slice(0, 5)) evidence.push(`via ${r.via} → ${[...r.key, ...r.http, ...r.service].slice(0, 2).join(",")}`);

  return {
    file: rel,
    language,
    hermeticity: label,
    signals: { self: own, reach },
    evidence: evidence.slice(0, 12),
    reachFiles: reachEvidence.map((r) => r.via).slice(0, 8),
  };
}

/**
 * 對一批測試檔算標籤 + 依 feature 彙總
 * @param {string} projectRoot
 * @param {string[]} testFiles
 * @param {{featureIds?:string[], featureTests?:string[][]}} opts
 */
export function computeTestSignals(projectRoot, testFiles, opts = {}) {
  const tables = loadTestSignalTables();
  const byFile = {};
  const summary = { total: 0, hermetic: 0, "needs-key": 0, "needs-network": 0, "needs-service": 0, unknown: 0 };
  for (const tf of testFiles) {
    const r = classifyTestFile(projectRoot, tf, { tables });
    byFile[r.file] = r;
    const key = ["hermetic", "needs-key", "needs-network", "needs-service"].includes(r.hermeticity) ? r.hermeticity : "unknown";
    summary[key] += 1;
    summary.total += 1;
  }

  // 依 feature 彙總（featureTests[i] 對應 featureIds[i]）
  const byFeature = {};
  if (Array.isArray(opts.featureTests) && Array.isArray(opts.featureIds)) {
    opts.featureTests.forEach((list, i) => {
      const fid = opts.featureIds[i];
      if (!fid) return;
      const bucket = { hermetic: [], "needs-key": [], "needs-network": [], "needs-service": [], unknown: [] };
      for (const p of list || []) {
        const r = byFile[String(p)] || byFile[String(p).replace(/\\/g, "/")];
        const k = r && bucket[r.hermeticity] ? r.hermeticity : "unknown";
        bucket[k].push(String(p));
      }
      byFeature[fid] = bucket;
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    note: "測試自足性（確定性靜態判定）。hermetic=clone 即可跑；needs-key/needs-network/needs-service=需要外部條件，跑不動不代表 code 壞。",
    summary,
    byFile,
    byFeature,
  };
}

// ══ LLM 消歧層（模糊案子的最後一哩）══════════════════════════════
// 確定性層依「規則序」硬判；以下情況 = 規則衝突/證據薄弱 → 交 LLM 依證據仲裁：
//   1. unknown（讀不到/無法判定）
//   2. 自己有 mock 但被判外部（mock 可能已攔截網路）
//   3. needs-network 但 URL 疑似 fixture（example.com/dummy/placeholder）
//   4. needs-key 但金鑰僅「字樣」、沒有真的讀 env（斷言資料誤觸辭典）
// LLM 只在這些案子上 refine；hermetic/確定外部的不動。No answer without evidence。

export function ambiguousTestFiles(sig) {
  const out = [];
  for (const [f, e] of Object.entries(sig.byFile || {})) {
    const self = e.signals?.self || {};
    const why = [];
    if (e.hermeticity === "unknown") why.push("無法判定");
    if ((self.mock || []).length && e.hermeticity !== "hermetic") why.push("有 mock 但被判外部");
    if (e.hermeticity === "needs-network" && /example\.(com|org)|dummy|placeholder|testserver|jsonplaceholder|foo\.bar/i.test(JSON.stringify(e.signals || {}))) why.push("URL 疑似 fixture");
    if (e.hermeticity === "needs-key" && (self.key || []).length > 0 && (self.key || []).every((k) => k.startsWith("lexicon:"))) why.push("金鑰僅字樣未讀 env");
    if (why.length) out.push({ file: f, label: e.hermeticity, why: why.join("；") });
  }
  return out;
}

export async function enrichTestSignals(projectRoot, { callLLM, model, onProgress } = {}) {
  if (!callLLM) throw new Error("enrichTestSignals: callLLM required");
  const p = join(projectRoot, ".paaw", "features", "TEST-SIGNALS.json");
  const sig = JSON.parse(readFileSync(p, "utf-8"));
  const amb = ambiguousTestFiles(sig);
  const now = new Date().toISOString();
  if (amb.length === 0) {
    sig.ai = { enriched: true, refined: 0, at: now, note: "無模糊案件（確定性判定全數成立）" };
    writeFileSync(p, JSON.stringify(sig, null, 2));
    return sig;
  }

  const items = amb.map((a) => {
    const e = sig.byFile[a.file] || {};
    let head = "";
    try { head = readFileSync(join(projectRoot, a.file), "utf-8").split("\n").slice(0, 25).join("\n").slice(0, 800); } catch { /* skip */ }
    return { file: a.file, language: e.language, label: e.hermeticity, why_ambiguous: a.why, evidence: (e.evidence || []).slice(0, 6), head };
  });

  const prompt = `你是測試工程師。以下是「靜態掃描無法確定自足性（hermeticity）」的測試檔，每個附了模糊原因、靜態證據、檔案前 25 行。
依證據（不要發明）判 label：
- hermetic：mock 已攔截網路 / 純函式 / URL 只是 fixture 資料 → clone 下來就能跑
- needs-key：會呼叫真外部 API，需要 API key
- needs-network：需要連外網（不一定需 key）
- needs-service：需要本機 DB / Redis / 服務
仲裁規則：出現 API_KEY 字樣但沒讀 env 且無真客戶端 → hermetic；example.com 佔位 URL 無真呼叫 → hermetic；mock 有攔截 → hermetic；redis/sql 連線 → needs-service。

只回一個 \`\`\`json fence，是陣列：[{ "file": "...", "label": "hermetic|needs-key|needs-network|needs-service", "confidence": 0.0-1.0, "reason": "≤60字依據" }]

--- FILES ---
${stableStringify(items)}`;

  onProgress?.(`LLM 消歧 ${items.length} 個模糊測試檔...`);
  const r = await callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0, thinking: { type: "disabled" }, ...(model ? { model } : {}) });
  const arr = _extractJsonArray(r?.content);
  const byFile = new Map();
  for (const x of arr || []) if (x && x.file) byFile.set(String(x.file), x);

  let refined = 0;
  for (const a of amb) {
    const x = byFile.get(a.file);
    const e = sig.byFile[a.file];
    if (!e || !x) continue;
    e.aiHermeticity = ["hermetic", "needs-key", "needs-network", "needs-service"].includes(x.label) ? x.label : e.hermeticity;
    e.aiConfidence = typeof x.confidence === "number" ? x.confidence : 0.5;
    e.aiReason = typeof x.reason === "string" ? x.reason.slice(0, 120) : "";
    e.aiAt = now;
    if (effectiveHermeticity(e) !== e.hermeticity) refined += 1;
  }
  sig.ai = { enriched: true, refined, candidates: amb.length, at: now };
  writeFileSync(p, JSON.stringify(sig, null, 2));

  // meta 同步 summary（用 effective label 重算）
  try {
    const mp = join(projectRoot, ".paaw", "features", "FEATURE-MAP-META.json");
    const meta = JSON.parse(readFileSync(mp, "utf-8"));
    const s = { total: 0, hermetic: 0, "needs-key": 0, "needs-network": 0, "needs-service": 0, unknown: 0 };
    for (const e of Object.values(sig.byFile)) { const k = effectiveHermeticity(e); s[k] = (s[k] || 0) + 1; s.total += 1; }
    meta.testSignals = { summary: s, ai: sig.ai, note: sig.note };
    writeFileSync(mp, JSON.stringify(meta, null, 2));
  } catch { /* meta 可能不存在 */ }
  return sig;
}

/** 有效標籤：LLM 仲裁（confidence ≥ 0.6）優先，否則確定性判定 */
export function effectiveHermeticity(e) {
  if (!e) return "unknown";
  if (e.aiHermeticity && (e.aiConfidence ?? 1) >= 0.6) return e.aiHermeticity;
  return e.hermeticity;
}

function _extractJsonArray(text) {
  if (!text) return null;
  const s = String(text);
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const a = body.indexOf("[");
  const b = body.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

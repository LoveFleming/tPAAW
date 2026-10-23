/**
 * crosscut-concepts.mjs — 橫切關注點（Cross-cutting Concern）偵測
 *
 * 問題：L1 owning map 是「檔案歸屬的分割（partition）」——每檔恰好屬一條 feature。
 * 但 Budget/Auth/RateLimit/Logging/Caching 這類**橫切關注點不按目錄分佈**，
 * 散在很多 feature 的分支裡 → 永遠不會自己長成一條 feature（例：portkey 的
 * Budget Control 散在 rateLimiter / cache / adminAuth → 找不到獨立 feature）。
 *
 * 解方：新增一層 **overlay（非分割、可重疊）** 的 concepts[]，跟 features[] 並列。
 * 本模組純確定性、近零 token：
 *   Phase 1 跨 feature identifier fan-in（一個 identifier 被幾條不同 feature 使用）
 *   Phase 2 詞彙種子（known concern lexicon + 高特異度 identifier 群）→ 收 evidence
 *   Gap Report：橫跨 ≥minFeatures 條 feature、但沒有任何 feature 獨佔（dominantShare < 0.5）
 *               → 候選缺口（「這裡有能力但沒有家」）
 * 消歧/命名/邊界留給 LLM 長肉層（本層只給數學與 evidence）。
 *
 * 不變式與誠實性：concept 永不宣稱 100% coverage；kind 一律 "overlay"；每條留 evidence。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stableStringify } from "./stable-stringify.mjs";

const norm = (p) => String(p).replace(/\\/g, "/");

// ── known concern lexicon（確定性、可審、可擴；label 為 LLM 未介入前的預設名）──
const CONCERN_LEXICON = [
  { key: "rate-limit", label: "Rate Limiting / 速率限制", pats: [/rate.?limit/i, /rateLimiter/i, /throttl/i, /max.?requests/i, /requests?per/i, /token.?bucket/i] },
  { key: "quota-budget", label: "Budget / Quota 額度控制", pats: [/\bquota\b/i, /\bspend(ing)?\b/i, /\bcredits?\b/i, /billing/i, /budget.?limit/i, /cost.?limit/i, /usage.?limit/i, /virtual.?key/i] },
  { key: "auth", label: "AuthN/Z 認證授權", pats: [/\bauth(enticat|oriz|nz)/i, /\bjwt\b/i, /token.?verif/i, /permission/i, /\brbac\b/i, /\bacl\b/i, /api.?key/i, /admin.?auth/i] },
  { key: "observability", label: "Observability / Logging / Tracing", pats: [/\btelemetry\b/i, /trac(e|ing)/i, /\bmetrics?\b/i, /\bspans?\b/i, /\baudit\b/i, /logger?\.(info|warn|error|debug)/i] },
  { key: "caching", label: "Caching", pats: [/\bcache/i, /\bredis\b/i, /memoiz/i, /\bkv\b/i] },
  { key: "resilience", label: "Resilience / Retry / Timeout", pats: [/\bretr(y|ies)\b/i, /\bbackoff\b/i, /circuit.?break/i, /\btimeout\b/i, /\bfallback\b/i] },
  { key: "tenancy", label: "Multi-tenancy / Isolation", pats: [/\btenant\b/i, /\bworkspace\b/i, /\bnamespace\b/i] },
  { key: "guardrails", label: "Security / Guardrails / PII", pats: [/guardrail/i, /\bpii\b/i, /sanitiz/i, /\bredact/i, /moderation/i, /jailbreak/i] },
  { key: "memory-context", label: "Memory / Context 管理", pats: [/\bcontext.?window\b/i, /\bmemory\b/i, /summari[sz]/i, /compress.?context/i] },
];

// 泛用 identifier（不構成 concern）；只擋真正沒語意的，保留 auth/cache/rate/budget 等
const GENERIC_TOKENS = new Set([
  "index", "default", "utils", "util", "types", "type", "helper", "helpers", "const", "get", "set",
  "use", "new", "data", "value", "values", "config", "options", "opts", "props", "state", "error",
  "errorhandler", "request", "response", "handler", "handlers", "service", "client", "server", "app",
  "main", "test", "spec", "string", "number", "object", "array", "function", "class", "json", "http",
  "https", "url", "id", "key", "keys", "name", "names", "list", "item", "items", "result", "results",
  "input", "output", "event", "node", "file", "path", "env", "ctx", "context", "params", "query",
  "body", "headers", "status", "code", "message", "content", "model", "models", "provider", "providers",
  "baseurl", "fetch", "parse", "format", "validate", "validator", "create", "update", "delete", "remove",
  "build", "make", "init", "run", "start", "stop", "close", "open", "send", "call", "load", "save",
  "read", "write", "log", "console", "promise", "async", "await", "return", "export", "import",
]);

const _subTokens = (name) =>
  String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./]+/g, " ")
    .split(/\s+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);

function _extractSymbol(line, pats) {
  const ids = line.match(/[A-Za-z_$][\w$]*/g) || [];
  for (const p of pats) for (const id of ids) if (p.test(id)) return id;
  return ids[0] || "";
}

/**
 * @param {string} projectRoot
 * @param {{files:Array}} parsed   tree-sitter parsed（files[].file / .imports）
 * @param {{features:Array}} dm    buildDeterministicFeatureMap 結果
 * @param {object} opts
 * @returns {{concepts:Array, stats:object, gapReport:Array}}
 */
export function computeCrosscutConcepts(projectRoot, parsed, dm, opts = {}) {
  const minFeatures = opts.minFeatures ?? 3;
  const maxHitsPerFile = opts.maxHitsPerFile ?? 3;
  const maxEvidence = opts.maxEvidence ?? 80;

  // 只認產品 feature（跳過 retired / example / tooling / docs），且需有 id（merge 後才有）
  const prodFeatures = (dm.features || []).filter(
    (f, i) =>
      f.status !== "retired" &&
      (!f.grade || f.grade === "deterministic" || f.grade === "deterministic-sub")
  );
  const ownerOf = new Map(); // file → {id,name}
  prodFeatures.forEach((f, i) => {
    const fid = f.id || `F-pending-${String(i).padStart(3, "0")}`;
    for (const cf of f.codeFiles || []) {
      const p = norm(cf);
      if (!ownerOf.has(p)) ownerOf.set(p, { id: fid, name: f.name || "(未命名)" });
    }
  });

  // file 內容快取（掃描只讀已歸屬產品檔）
  const textOf = (p) => {
    try { return readFileSync(join(projectRoot, p), "utf-8"); } catch { return ""; }
  };

  // ── Phase 1：跨 feature identifier fan-in ──（一個 identifier 出現在幾條不同 feature）
  const idFeatures = new Map(); // identifier → Set(fid)
  const idFiles = new Map();    // identifier → Set(file)
  for (const f of parsed.files || []) {
    const p = norm(f.file);
    const own = ownerOf.get(p);
    if (!own) continue;
    const text = textOf(p);
    if (!text) continue;
    const seen = new Set();
    for (const m of text.matchAll(/[A-Za-z_$][\w$]{3,}/g)) {
      const id = m[0];
      if (seen.has(id)) continue;
      seen.add(id);
      if (!idFeatures.has(id)) { idFeatures.set(id, new Set()); idFiles.set(id, new Set()); }
      idFeatures.get(id).add(own.id);
      idFiles.get(id).add(p);
    }
  }

  // ── Phase 2：lexicon 掃描收 evidence ──
  const concepts = [];
  for (const c of CONCERN_LEXICON) {
    const evidence = [];
    const featCount = new Map(); // fid → hits
    const fileHit = new Map();   // file → count

    for (const f of parsed.files || []) {
      const p = norm(f.file);
      const own = ownerOf.get(p);
      if (!own) continue;
      const text = textOf(p);
      if (!text) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln || ln.length > 400) continue;
        if (!c.pats.some((re) => re.test(ln))) continue;
        const n = fileHit.get(p) || 0;
        if (n >= maxHitsPerFile) break;
        fileHit.set(p, n + 1);
        featCount.set(own.id, (featCount.get(own.id) || 0) + 1);
        if (evidence.length < maxEvidence) {
          evidence.push({ file: p, line: i + 1, symbol: _extractSymbol(ln, c.pats), feature: own.id, featureName: own.name });
        }
      }
    }

    const crossFeatureCount = featCount.size;
    if (crossFeatureCount === 0) continue;
    const totalHits = [...featCount.values()].reduce((s, x) => s + x, 0);
    const dominant = [...featCount.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const dominantShare = totalHits ? dominant[1] / totalHits : 0;

    concepts.push({
      key: c.key,
      name: c.label,
      kind: "overlay", // 明確非分割、可重疊
      discovered: false,
      crossFeatureCount,
      features: [...featCount.keys()].sort(),
      dominantFeature: dominant[0],
      dominantShare: Math.round(dominantShare * 100) / 100,
      hits: totalHits,
      evidence,
    });
  }

  // ── Phase 2b：discovery — 高特異度「複合 identifier」群（lexicon 沒抓到的橫切概念）──
  // 加嚴：只收複合名（≥2 子詞，殺 this/date/session/before… 這類單字誤報）、子詞 ≥4、非泛用。
  const coveredIds = new Set(concepts.flatMap((c) => c.evidence.map((e) => e.symbol)));
  const bySub = new Map();
  for (const [id, feats] of idFeatures) {
    if (feats.size < minFeatures) continue;
    const low = id.toLowerCase();
    if (GENERIC_TOKENS.has(low)) continue;
    if (coveredIds.has(id)) continue;
    const subs = _subTokens(id).filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
    if (subs.length < 2) continue; // 必須是複合名 → 排除單字泛詞（this/date/session/before…）
    // 用最長 subtoken 當群 signature
    const sig = [...subs].sort((a, b) => b.length - a.length)[0];
    if (!bySub.has(sig)) bySub.set(sig, { ids: new Set(), feats: new Set(), files: new Set() });
    const g = bySub.get(sig);
    g.ids.add(id);
    for (const x of feats) g.feats.add(x);
    for (const x of idFiles.get(id) || []) g.files.add(x);
  }
  const discoveredSorted = [...bySub.entries()]
    .filter(([, g]) => g.feats.size >= minFeatures && g.ids.size >= 3)
    .sort((a, b) => b[1].feats.size - a[1].feats.size || a[0].localeCompare(b[0]))
    .slice(0, 8);
  for (const [sig, g] of discoveredSorted) {
    concepts.push({
      key: `discovered:${sig}`,
      name: `（待命名）${sig}`,
      kind: "overlay",
      discovered: true,
      crossFeatureCount: g.feats.size,
      features: [...g.feats].sort(),
      dominantFeature: null,
      dominantShare: null,
      hits: g.ids.size,
      evidence: [...g.ids].sort().slice(0, 20).map((id) => ({ file: [...(idFiles.get(id) || [])][0] || "", symbol: id, feature: null })),
    });
  }

  concepts.sort(
    (a, b) => b.crossFeatureCount - a.crossFeatureCount || a.name.localeCompare(b.name)
  );
  concepts.forEach((c, i) => { c.id = `CC-${String(i + 1).padStart(3, "0")}`; });

  // ── Gap Report：橫跨多 feature、但沒有單一 feature 獨佔 → 「有能力但沒有家」──
  const gapReport = concepts
    .filter(
      (c) =>
        c.crossFeatureCount >= minFeatures &&
        (c.dominantShare === null || c.dominantShare < 0.5) &&
        // discovered（推測性）門檻更高，避免 after/azure 這類噪音進 gap report
        (!c.discovered || c.crossFeatureCount >= minFeatures + 2)
    )
    .map((c) => ({
      conceptId: c.id,
      name: c.name,
      crossFeatureCount: c.crossFeatureCount,
      features: c.features,
      dominantShare: c.dominantShare,
      reason: c.dominantShare === null
        ? `散在 ${c.crossFeatureCount} 條 feature，無獨佔者（discovered）`
        : `散在 ${c.crossFeatureCount} 條 feature，最高佔比僅 ${Math.round(c.dominantShare * 100)}%`,
    }));

  const stats = {
    concepts: concepts.length,
    lexiconConcepts: concepts.length - discoveredSorted.length,
    discoveredConcepts: discoveredSorted.length,
    gaps: gapReport.length,
    minFeatures,
    method: "crosscut-concepts-v1（identifier fan-in + concern lexicon，確定性、零 token）",
  };

  return { concepts, stats, gapReport };
}

/**
 * ② LLM 長肉：消歧 + 命名 + 判假陽性。
 * 確定性層只給數學與 evidence；此層讓 LLM 依 evidence 判「這是不是真的橫切能力」並命名。
 * 寫回 CROSSCUT-CONCEPTS.json（aiName/aiDescription/aiClipped/aiAt）+ 重算 gapReport（排除 clipped）。
 */
export async function enrichCrosscutConcepts(projectRoot, { callLLM, model, onProgress } = {}) {
  if (!callLLM) throw new Error("enrichCrosscutConcepts: callLLM required");
  const p = join(projectRoot, ".paaw", "features", "CROSSCUT-CONCEPTS.json");
  const cur = JSON.parse(readFileSync(p, "utf-8"));
  const concepts = cur.concepts || [];
  if (concepts.length === 0) return cur;

  const featName = new Map();
  try {
    const fj = JSON.parse(readFileSync(join(projectRoot, ".paaw", "features", "FEATURES.json"), "utf-8"));
    for (const f of fj.features || []) featName.set(f.id, f.name || "");
  } catch { /* 沒 FEATURES 也能跑 */ }

  const items = concepts.map((c) => {
    const syms = [...new Set((c.evidence || []).map((e) => e.symbol).filter(Boolean))].slice(0, 12);
    const files = [...new Set((c.evidence || []).map((e) => e.file).filter(Boolean))].slice(0, 6);
    return {
      id: c.id,
      seed: c.name,
      key: c.key,
      discovered: !!c.discovered,
      crossFeatureCount: c.crossFeatureCount,
      features: (c.features || []).map((fid) => `${fid} ${featName.get(fid) || ""}`.trim()),
      symbols: syms,
      files,
    };
  });

  const prompt = `你是程式碼架構師。以下是從一個 repo 用**確定性方法**抽出的「橫切關注點（cross-cutting concern）」候選。\n每個候選有：橫跨幾條 feature、參與的 feature、命中符號、命中檔。\n\n你的任務（依 evidence，不要發明）：\n1. 消歧：同一個字可能有不同意思（例：budget_tokens 是 LLM 的 thinking 預算，不是計費額度）。命中點語意不一致、或只是巧合共用的工具名（如 endpoint / after / azure）→ real=false。\n2. 命名：real=true 的給**繁中功能名**（名詞短語，如「預算與額度控制」）+ 一句邊界描述。\n\n只回一個 json fence，是陣列，每個元素：{ "id": "CC-00X", "real": true/false, "name": "繁中名", "description": "一句邊界（real=false 則說明為何不是真概念）" }\n\n--- CONCEPTS ---\n${stableStringify(items)}`;

  onProgress?.(`LLM 消歧 ${concepts.length} 條橫切概念...`);
  const r = await callLLM({
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    thinking: { type: "disabled" },
    ...(model ? { model } : {}),
  });
  const arr = _extractJsonArray(r?.content);
  const byId = new Map();
  for (const x of arr || []) if (x && x.id) byId.set(String(x.id), x);

  const now = new Date().toISOString();
  for (const c of concepts) {
    const x = byId.get(c.id);
    if (!x) continue;
    c.aiClipped = x.real === false;
    c.aiName = typeof x.name === "string" ? x.name.slice(0, 80) : undefined;
    c.aiDescription = typeof x.description === "string" ? x.description.slice(0, 400) : undefined;
    c.aiAt = now;
  }

  const minFeatures = cur.stats?.minFeatures ?? 3;
  const gapReport = concepts
    .filter(
      (c) =>
        !c.aiClipped &&
        c.crossFeatureCount >= minFeatures &&
        (c.dominantShare === null || c.dominantShare < 0.5) &&
        (!c.discovered || c.crossFeatureCount >= minFeatures + 2)
    )
    .map((c) => ({
      conceptId: c.id,
      name: c.aiName || c.name,
      crossFeatureCount: c.crossFeatureCount,
      features: c.features,
      dominantShare: c.dominantShare,
      reason:
        c.dominantShare === null
          ? `散在 ${c.crossFeatureCount} 條 feature，無獨佔者`
          : `散在 ${c.crossFeatureCount} 條 feature，最高佔比僅 ${Math.round(c.dominantShare * 100)}%`,
    }));

  const out = { ...cur, concepts, gapReport, enrichedAt: now, stats: { ...(cur.stats || {}), aiEnriched: true, aiClipped: concepts.filter((c) => c.aiClipped).length, gaps: gapReport.length } };
  writeFileSync(p, JSON.stringify(out, null, 2));

  try {
    const mp = join(projectRoot, ".paaw", "features", "FEATURE-MAP-META.json");
    const meta = JSON.parse(readFileSync(mp, "utf-8"));
    meta.crosscutConcepts = concepts;
    meta.crosscutStats = out.stats;
    meta.gapReport = gapReport;
    writeFileSync(mp, JSON.stringify(meta, null, 2));
  } catch { /* meta 可能不存在 */ }

  return out;
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

/**
 * feature-map-v2.mjs — Deterministic Feature Map（2026-09-05 Fleming 定調）
 *
 * 「feature map 是骨架 → 數學說了算；長內容 → LLM；程式歸不了 → LLM 分但標 utility」
 * v2.1（同日 21:10 Fleming）：長肉 = **每個 feature 一個獨立 agent loop**（多輪 + tool call）
 * — 不是一次送全部 features 給 LLM。每個 loop 的 context 只有該 feature 的檔案，
 *   features 再多也不會爆 context，可以長時間逐個做完。
 *
 * Pipeline：
 *   1. parseProject（tree-sitter，無上限）
 *   2. buildDeterministicFeatureMap（code-graph.mjs — 進入點/reach/Jaccard 聚類，零 token、決定論）
 *   3. orphan 分組（單次小 call — 檔名清單而已，context 極小）
 *   4. 長肉：work item（cluster 或 orphan group）逐一跑 agent loop
 *      - agentId "cu-feature"（core-read 工具組：read_file/glob/grep/diff — 只讀不寫）
 *      - system prompt = feature-map-v2.md agent 段（per-RU 可覆寫）
 *      - user prompt = 該 feature 的骨架素材（檔案/API/進入點）
 *      - agent 自己 read_file 讀 code（多輪），最後一輪輸出 JSON
 *      - parts/ 斷點續跑：每個 item 完成立即落檔，重跑只補缺的
 *      - agent 失敗 → 重試一次 → 再失敗走決定論降級命名（標 degraded，整步不失敗）
 *   5. 合併寫 .paaw/features/（FEATURES.json schema 相容 v1 + FILE-FEATURES.json + FEATURE-MAP-META.json）
 *
 * 決定論保證：2 是純數學；LLM 只長肉。骨架同 repo 重跑必相同。
 */
import { join, resolve as resolvePath } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { parseProject } from "./tree-sitter-parser.mjs";
import { buildDeterministicFeatureMap } from "./code-graph.mjs";
import { nextFeatureIds } from "./feature-registry.mjs";
import { DATA_HOME } from "../data-home.mjs";

const _str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const _arr = (v, max = 40) => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, max).map(x => x.slice(0, 160)) : []);

function _loadTemplate(projectRoot) {
  const override = join(projectRoot, ".paaw", "prompts", "code-understanding", "feature-map-v2.md");
  if (existsSync(override)) { try { return readFileSync(override, "utf-8"); } catch {} }
  try { return readFileSync(join(DATA_HOME, "prompts", "code-understanding", "feature-map-v2.md"), "utf-8"); } catch { return ""; }
}

/** 從 agent 最終回覆抽 JSON（取最後一個 fence；沒 fence 就整段試 parse） */
function _extractJson(txt) {
  let t = String(txt || "").trim();
  if (!t) return null;
  const fences = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.length ? fences.map(m => m[1].trim()).reverse() : [t];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
  }
  return null;
}

/** 預設 agent loop runner — 真的跑 paaw-agent-loop（core-read 工具組） */
async function _runFeatureAgent({ systemPrompt, prompt, cwd, rootDir, model }) {
  const { runAgentLoop } = await import("./paaw-agent-loop.mjs");
  const r = await runAgentLoop({
    prompt,
    cwd,
    systemPrompt,
    model,
    rootDir,
    agentId: "cu-feature",
    maxTurns: 8,
    timeout: 300,
  });
  return { content: r.content, turns: r.turns, usage: r.usage, durationMs: r.durationMs, success: r.success };
}

/** 決定論降級命名（agent 兩次都失敗時 — 整步不因此失敗） */
function _fallbackFlesh(item) {
  const slug = (item.apis?.[0]?.path || item.files?.[0] || "feature")
    .replace(/^\/+/, "").split(/[\\/]/).pop() || "feature";
  const base = slug.replace(/\.[a-z]+$/i, "").replace(/[-_.]/g, " ").trim() || "feature";
  return {
    name: `${base}（自動命名）`,
    description: `（agent 長肉失敗，自動降級）此 feature 含 ${item.files.length} 個檔案。`,
    bizLogic: "",
    tags: [],
    degraded: true,
  };
}

/**
 * @param root RU 絕對路徑
 * @param callLLM async ({messages}) => {content} — 只用於 orphan 分組小 call
 * @param onProgress (msg) => void
 * @param paawRoot PAAW root（tree-sitter grammar + agent loop provider 設定用）
 * @param model CU model override（傳給 agent loop）
 * @param runFeatureAgent 可注入的 agent runner（測試用）；預設走 paaw-agent-loop
 */
export async function organizeFeatureMapV2(root, { callLLM, onProgress, paawRoot, model, runFeatureAgent = _runFeatureAgent }) {
  const projectRoot = resolvePath(root);
  const agentRunner = runFeatureAgent;

  onProgress?.("Tree-sitter parsing（無上限）...");
  const parsed = await parseProject(projectRoot, paawRoot, { maxFiles: 0, maxBytes: 500_000 });
  onProgress?.(`parsed ${parsed.stats.parsedFiles} files`);

  onProgress?.("Building deterministic code map（進入點 → reach → Jaccard 聚類）...");
  const dm = buildDeterministicFeatureMap(parsed);
  onProgress?.(`骨架完成：${dm.stats.clusters} clusters / ${dm.stats.shared} shared / ${dm.stats.orphans} orphans（零 token）`);

  if (dm.features.length === 0) {
    const meta = { method: "deterministic-v2", scannedAt: new Date().toISOString(), stats: dm.stats, shared: dm.shared, orphans: dm.orphans, note: "No entry points found (no routes/ui/public api) — 無法決定論抽取，請人工或 LLM utility 模式" };
    const featuresDir = join(projectRoot, ".paaw", "features");
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(join(featuresDir, "FEATURE-MAP-META.json"), JSON.stringify(meta, null, 2));
    return { features: [], meta };
  }

  // ── prompt 模板：agent 段 + orphan 段（同檔案，ORPHAN-SPLIT 分隔）──
  const template = _loadTemplate(projectRoot);
  if (!template) throw new Error("prompt template feature-map-v2.md not found");
  const [agentTpl, orphanTpl = ""] = template.split("<!-- ORPHAN-SPLIT").map(s => s.replace(/^.*?-->\s*/, "").trim());

  // ── 3. orphan 分組（單次小 call — 只有檔名，context 極小）──
  let orphanGroups = [];
  if (dm.orphans.length > 0 && orphanTpl) {
    onProgress?.(`Orphan 分組（${dm.orphans.length} 檔，單次小 call）...`);
    try {
      const res = await callLLM({
        messages: [{ role: "user", content: orphanTpl + "\n\n--- ORPHAN FILES ---\n" + JSON.stringify(dm.orphans.slice(0, 120)) }],
        temperature: 0,
        thinking: { type: "disabled" },
        timeoutMs: 300_000,
      });
      const j = _extractJson(res?.content);
      if (Array.isArray(j?.orphanGroups)) {
        const assigned = new Set();
        for (const g of j.orphanGroups) {
          const files = _arr(g.files, 60).filter(f => dm.orphans.includes(f) && !assigned.has(f));
          if (!files.length) continue;
          files.forEach(f => assigned.add(f));
          orphanGroups.push({ name: _str(g.name, 80) || `Utility ${orphanGroups.length + 1}`, description: _str(g.description), files });
        }
      }
    } catch (e) { onProgress?.(`Orphan 分組失敗（略過，孤兒留在 meta）: ${e.message}`); }
  }

  // ── 4. work items：每個 feature 一個獨立 agent loop ──
  const workItems = [
    ...dm.features.map(f => ({
      kind: "deterministic", grade: "deterministic",
      files: f.codeFiles, apis: f.apis, kinds: f.kinds, entryCount: f.entryCount, reachFiles: f.reachFiles.length,
    })),
    ...orphanGroups.map(g => ({
      kind: "utility", grade: "utility",
      files: g.files, apis: [], kinds: { orphan: g.files.length }, entryCount: 0, reachFiles: 0,
      groupName: g.name, groupDesc: g.description,
    })),
  ];

  // 斷點續跑：先載已完成 parts
  const partsDir = join(projectRoot, ".paaw", "features", "parts");
  mkdirSync(partsDir, { recursive: true });
  const partPath = i => join(partsDir, `part-${String(i).padStart(3, "0")}.json`);
  const parts = new Map();
  for (let i = 0; i < workItems.length; i++) {
    try {
      const p = JSON.parse(readFileSync(partPath(i), "utf-8"));
      if (p && p.flesh) parts.set(i, p);
    } catch {}
  }
  if (parts.size > 0) onProgress?.(`續跑：${parts.size}/${workItems.length} 已完成，補缺的`);

  const sharedBrief = dm.shared.slice(0, 30);
  const enrichment = { loops: 0, ok: 0, degraded: 0, resumed: parts.size, totalTurns: 0, totalMs: 0, usage: null };
  const _nDet = workItems.filter(w => w.kind === "deterministic").length;
  console.log(`[FM-v2] 🗺️ 長肉開始：${workItems.length} items（${_nDet} deterministic + ${workItems.length - _nDet} utility），逐個 agent loop${parts.size ? `（續跑 ${parts.size} 已完成）` : ""}`);
  const _enrichT0 = Date.now();

  for (let i = 0; i < workItems.length; i++) {
    const item = workItems[i];
    let part = parts.get(i);
    if (!part) {
      const _itemT0 = Date.now();
      console.log(`[FM-v2] ▶️ feature ${i + 1}/${workItems.length} agent loop 開始（${item.kind}）：${item.apis?.[0]?.path || item.files?.[0] || ""}`);
      const material = {
        kind: item.kind,
        apis: item.apis.slice(0, 20).map(a => `${a.method} ${a.path}`),
        entryCount: item.entryCount,
        fileCount: item.files.length,
        FILE_LIST: item.files.slice(0, 40),
        ...(item.files.length > 40 ? { note: `FILE LIST 只列前 40 檔（共 ${item.files.length}），其餘可用 glob 確認` } : {}),
        SHARED_LAYER: sharedBrief,
      };
      const userPrompt = (item.kind === "utility"
        ? `這是一個孤兒分組（utility 級）— 系統建議的暫定組名「${item.groupName}」。請讀檔後給正式命名與描述。\n\n--- GROUP SKELETON (machine) ---\n`
        : `請長肉這一個 feature（檔案歸屬數學已定，不可更改）。\n\n--- FEATURE SKELETON (machine) ---\n`)
        + JSON.stringify(material, null, 1)
        + "\n\n用 read_file 實際讀程式碼（至少進入點檔 + 1-3 個核心檔），最後一輪輸出 JSON（name/description/bizLogic/tags）。";

      let flesh = null, last = null, turns = 0, dur = 0, usage = null;
      for (let attempt = 1; attempt <= 2 && !flesh; attempt++) {
        try {
          onProgress?.(`🤖 feature ${i + 1}/${workItems.length} agent loop（${item.kind}${attempt > 1 ? ` 重試#${attempt}` : ""}）：${item.apis?.[0]?.path || item.files?.[0] || ""}`);
          const r = await agentRunner({ systemPrompt: agentTpl, prompt: userPrompt, cwd: projectRoot, rootDir: paawRoot, model });
          enrichment.loops++; turns += r.turns || 0; dur += r.durationMs || 0;
          if (r.usage) usage = r.usage;
          flesh = _extractJson(r.content);
          if (flesh && (!_str(flesh.name, 80) || typeof flesh.bizLogic === "undefined")) flesh = null;
          last = r;
        } catch (e) { last = { error: e.message }; }
      }
      if (!flesh) { flesh = _fallbackFlesh(item); enrichment.degraded++; }
      else enrichment.ok++;
      const _wallMs = Date.now() - _itemT0;
      part = { flesh, turns: turns, durationMs: dur, wallMs: _wallMs, usage, degraded: !!flesh.degraded, finishedAt: new Date().toISOString() };
      writeFileSync(partPath(i), JSON.stringify(part, null, 2)); // 立即落檔 — 斷點續跑
      parts.set(i, part);
      console.log(`[FM-v2] ${flesh.degraded ? "⚠️" : "✅"} feature ${i + 1}/${workItems.length}「${flesh.name}」agent loop 結束（${turns} turns, ${(_wallMs / 1000).toFixed(0)}s）`);
      onProgress?.(`✅ ${i + 1}/${workItems.length}「${flesh.name}」${flesh.degraded ? "（⚠️ 自動降級）" : `（${turns} turns, ${(_wallMs / 1000).toFixed(0)}s）`}`);
    }
    enrichment.totalTurns += part.turns || 0;
    enrichment.totalMs += part.durationMs || 0;
    if (part.usage && typeof part.usage === "object") {
      enrichment.usage ||= { promptTokens: 0, completionTokens: 0 };
      // provider 回 snake_case（prompt_tokens）、agent-loop 可能包 camelCase — 兩種都收
      for (const [camel, snake] of [["promptTokens", "prompt_tokens"], ["completionTokens", "completion_tokens"]]) {
        const v = part.usage[camel] ?? part.usage[snake];
        if (typeof v === "number") enrichment.usage[camel] += v;
      }
    }
  }

  // ── 5. 合併：骨架 + 肉 → FEATURES.json（schema 相容 v1 + 新欄位）──
  const ids = nextFeatureIds(projectRoot, workItems.length);
  const now = new Date().toISOString();
  const features = workItems.map((item, i) => {
    const fl = parts.get(i)?.flesh || {};
    return {
      id: ids[i],
      name: _str(fl.name, 80) || `Feature ${i + 1}`,
      description: _str(fl.description),
      bizLogic: _str(fl.bizLogic, 500),
      status: "active",
      codeFiles: item.files,
      apis: item.apis,
      tests: [],
      runbooks: [],
      tags: _arr(fl.tags, 6),
      grade: item.grade,
      evidence: {
        kinds: item.kinds,
        entryCount: item.entryCount,
        reachFiles: item.reachFiles,
        method: item.kind === "deterministic" ? "entry-reach-jaccard" : "llm-grouping",
        enrichedBy: "agent-loop",
      },
      issues: [],
      aiUnderstanding: "",
      aiUnderstandingAt: null,
      documentation: "",
      docsUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  const featuresDir = join(projectRoot, ".paaw", "features");
  mkdirSync(featuresDir, { recursive: true });
  writeFileSync(join(featuresDir, "FEATURES.json"), JSON.stringify({ features, updatedAt: now }, null, 2));

  const fileFeatureMap = {};
  for (const feat of features) {
    for (const f of [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])]) {
      const norm = f.replace(/\\/g, "/");
      (fileFeatureMap[norm] ||= []).push({ id: feat.id, name: feat.name, tags: feat.tags || [] });
    }
  }
  writeFileSync(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: now }, null, 2));

  const orphanAssigned = new Set(orphanGroups.flatMap(g => g.files));
  const meta = {
    method: "deterministic-v2",
    scannedAt: now,
    stats: dm.stats,
    shared: dm.shared,
    orphans: dm.orphans.filter(x => !orphanAssigned.has(x)),
    enrichment,
    note: "骨架 = 進入點 reach + Jaccard 聚類（數學決定論，重跑不變）；grade=deterministic。長肉 = 每 feature 一個獨立 agent loop（core-read，多輪讀 code）；orphan 分組 grade=utility（建議，人類定案）。",
  };
  writeFileSync(join(featuresDir, "FEATURE-MAP-META.json"), JSON.stringify(meta, null, 2));

  // tree-sitter 完整分析留檔（debug 用，同 v1 行為）
  try {
    const { formatForAI } = await import("./tree-sitter-parser.mjs");
    writeFileSync(join(featuresDir, "tree-sitter-analysis.txt"), formatForAI(parsed));
  } catch {}

  try { rmSync(partsDir, { recursive: true, force: true }); } catch {} // 全部完成 — parts 清場
  console.log(`[FM-v2] 🗺️ 長肉完成：${workItems.length} items（ok ${enrichment.ok} / 降級 ${enrichment.degraded} / 續跑 ${enrichment.resumed}），${enrichment.totalTurns} turns，${((Date.now() - _enrichT0) / 1000).toFixed(0)}s`);

  return { features, meta };
}

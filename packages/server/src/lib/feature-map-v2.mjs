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
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, statSync } from "fs";
import { parseProject } from "./tree-sitter-parser.mjs";
import { buildDeterministicFeatureMap } from "./code-graph.mjs";
import { computeSubFeatureRefinement, detectTemplateOrphans } from "./feature-subfeature.mjs";
import { computeCrosscutConcepts } from "./crosscut-concepts.mjs";
import { nextFeatureIds, loadFeatures, saveFeatures, mergeFeaturesWithExisting } from "./feature-registry.mjs";
import { autoScanAllFeatureSeverities } from "./feature-risk-scan.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { stableStringify } from "./stable-stringify.mjs";

const _str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const _arr = (v, max = 40) => (Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, max).map(x => x.slice(0, 160)) : []);

function _loadTemplate(projectRoot) {
  const override = join(projectRoot, ".paaw", "prompts", "code-understanding", "feature-map-v2.md");
  if (existsSync(override)) { try { return readFileSync(override, "utf-8"); } catch {} }
  try { return readFileSync(join(DATA_HOME, "prompts", "code-understanding", "feature-map-v2.md"), "utf-8"); } catch { return ""; }
}

/** 從 agent 最終回覆抽 JSON（取最後一個 fence；沒 fence 就整段試 parse）
 *  2026-10-23：加寬鬆二層 — fence 失敗時試「括號平衡切首個 {..}」；仍失敗才 null */
function _extractJson(txt) {
  let t = String(txt || "").trim();
  if (!t) return null;
  const fences = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.length ? fences.map(m => m[1].trim()).reverse() : [t];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
  }
  // 括號平衡掃首個物件（模型輸出 json 前後夾敘述時）
  for (const c of candidates) {
    const s = c.indexOf("{");
    if (s >= 0) {
      let depth = 0;
      for (let i = s; i < c.length; i++) {
        if (c[i] === "{") depth++;
        else if (c[i] === "}") { depth--; if (!depth) { try { return JSON.parse(c.slice(s, i + 1)); } catch { break; } } }
      }
    }
  }
  return null;
}

/** 命名保底第 3 層（2026-10-23 Fleming「要命名成功」）：agent loop 兩次都失敗 → 直呼 LLM。
 *  證據 = 決定論抽樣檔案內容（seed 固定排序：最小 2 檔 + 首檔，各截 4k 字元）+ 骨架詞彙。
 *  輸出誠實標 enrichedBy: direct-llm（非 agent-loop）*/
async function _directNameFallback({ callLLM, item, projectRoot, material, kindLabel }) {
  if (!callLLM) return null;
  // 決定論抽樣：按 (size, path) 排序取最小 2 檔 + 原序首檔；parent 用子群摘要不抽檔
  let samples = [];
  const list = item.kind === "parent" ? [] : item.files.slice(0, 60);
  if (list.length) {
    const statted = [];
    for (const f of list) {
      try { statted.push({ f, s: statSync(join(projectRoot, f)).size }); } catch {}
    }
    statted.sort((a, b) => a.s - b.s || a.f.localeCompare(b.f));
    const picked = new Set([list[0], ...statted.slice(0, 2).map(x => x.f)]);
    for (const f of picked) {
      try { samples.push(`### ${f}\n\`\`\`\n${readFileSync(join(projectRoot, f), "utf-8").slice(0, 4000)}\n\`\`\``); } catch {}
    }
  }
  const skeleton = {
    kind: item.kind,
    apis: material.apis, entryCount: material.entryCount, fileCount: material.fileCount,
    FILE_LIST: item.files.slice(0, 60),
    ...(item.kind === "parent" ? { SUB_FEATURES: material.SUB_FEATURES, INTERNAL_SHARED: material.INTERNAL_SHARED } : {}),
    ...(item.kind === "subfeature" ? { VOCAB_TOP: material.VOCAB_TOP } : {}),
    ...(item.groupName ? { SUGGESTED_NAME: item.groupName } : {}),
  };
  const prompt = `你是程式碼理解助手。以下是一個${kindLabel}的機器骨架（檔案歸屬數學已定）${samples.length ? "與抽樣程式碼" : ""}。請依證據（詞彙、API、目錄、${samples.length ? "抽樣程式碼" : "子群組成"}）為它命名並寫描述。禁止發明没讀過的細節；把握不足就在 description 說明是依骨架推論。
回答只有一個 \`\`\`json fence，欄位：name（繁中功能命名）、description（2-3 句邊界與組成）、bizLogic（3-6 句規則與資料流，可短不可空）、tags（english lowercase，3-6 個）。

--- SKELETON (machine) ---
${stableStringify(skeleton)}
${samples.length ? "\n--- SAMPLED CODE ---\n" + samples.join("\n\n") : ""}`;
  // 模型輪替（2026-10-23）：deepseek flash 間歇性回 0 字 content（usage 有 token 但 content 空）
  // → 同一 prompt 換模型重試。undefined = 用預設模型。
  const MODEL_LADDER = [undefined, undefined, "z-ai/glm-5.3-flash", "zai/glm-5.1"];
  for (const mdl of MODEL_LADDER) {
    try {
      const r = await callLLM({
        messages: [{ role: "user", content: prompt }],
        temperature: 0, thinking: { type: "disabled" }, timeoutMs: 120_000,
        ...(mdl ? { model: mdl } : {}),
      });
      const j = _extractJson(r?.content);
      if (j && _str(j.name, 80)) {
        return {
          name: _str(j.name, 80),
          description: _str(j.description),
          bizLogic: _str(j.bizLogic, 500) || "（直呼命名保底：bizLogic 從缺）",
          tags: _arr(j.tags, 6),
          enrichedBy: mdl ? `direct-llm:${mdl}` : "direct-llm",
        };
      }
    } catch { /* 換下一個模型 */ }
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
  if (item.groupName) {
    // utility/template 群：偵測器給的名字本身就是決定論的（如「providers 同型單元（45×）」）
    return {
      name: `${item.groupName}（自動命名）`,
      description: item.groupDesc || `（agent 長肉失敗，自動降級）此群含 ${item.files.length} 個檔案。`,
      bizLogic: "",
      tags: [],
      degraded: true,
    };
  }
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

  onProgress?.("Building deterministic code map（Tier → barrel 塌縮 → Label Propagation）...");
  const dm = buildDeterministicFeatureMap(parsed);
  onProgress?.(`骨架完成：${dm.stats.clusters} clusters / ${dm.stats.shared} shared / ${dm.stats.orphans} orphans（零 token）`);

  // ── L2 子群精煉（2026-10-23 Fleming「看 sub-feature 而定」：內生判準 — 擾動穩定共識 + 語義分離，零 token）──
  // 拆/不拆不由檔數決定；只留「可發現、穩定、語義分得開」的子結構。穾合橋接檔歸 feature 內部 internalShared。
  const refinements = computeSubFeatureRefinement(dm, parsed);
  const _splitCount = refinements.filter(r => r.split).length;
  if (_splitCount > 0) onProgress?.(`L2 精煉：${_splitCount}/${dm.features.length} 個 feature 有穩定子結構（擾動共識+語義分離，零 token）`);

  if (dm.features.length === 0 && dm.orphans.length === 0) {
    const meta = { method: "deterministic-v2", scannedAt: new Date().toISOString(), stats: dm.stats, shared: dm.shared, orphans: dm.orphans, note: "空 repo（無 source 檔可分析）— features 為空是正確結果" };
    const featuresDir = join(projectRoot, ".paaw", "features");
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(join(featuresDir, "FEATURE-MAP-META.json"), JSON.stringify(meta, null, 2));
    return { features: [], meta };
  }
  // 2026-10-23 Fleming 回報 Rust 專案「跑完但空 map」：舊版在 features=0（Rust 無 route/ui/pub 偵測時）
  // 直接 early return 空 map，連 LLM orphan utility 分組都沒跑。現在有 orphans 就繼續走分組管線。

  // ── prompt 模板：agent 段 + orphan 段（同檔案，ORPHAN-SPLIT 分隔）──
  const template = _loadTemplate(projectRoot);
  if (!template) throw new Error("prompt template feature-map-v2.md not found");
  const [agentTpl, orphanTpl = ""] = template.split("<!-- ORPHAN-SPLIT").map(s => s.replace(/^.*?-->\s*/, "").trim());

  // ── C：orphan 同型重複偵測（零 token）— 兄弟目錄同檔名模式 → 機械歸一，不浪費 LLM 分組 ──
  // 例：src/providers/{openai,anthropic,...}/{api.ts,index.ts} ×N → 一個「同型單元」群
  const { templateGroups, remaining: orphansForLLM } = detectTemplateOrphans(dm.orphans);
  if (templateGroups.length > 0) onProgress?.(`同型重複偵測：${templateGroups.length} 組（${templateGroups.reduce((s, g) => s + g.files.length, 0)} 檔）機械歸一（零 token）`);
  const orphanPool = new Set(orphansForLLM);

  // ── 3. orphan 分組（單次小 call — 只有檔名，context 極小）──
  let orphanGroups = templateGroups.map(g => ({ name: g.name, description: g.description, files: g.files, template: true }));
  if (orphansForLLM.length > 0 && orphanTpl) {
    onProgress?.(`Orphan 分組（${orphansForLLM.length} 檔，單次小 call）...`);
    try {
      const res = await callLLM({
        messages: [{ role: "user", content: orphanTpl + "\n\n--- ORPHAN FILES ---\n" + JSON.stringify(orphansForLLM.slice(0, 400)) }],
        temperature: 0,
        thinking: { type: "disabled" },
        timeoutMs: 300_000,
      });
      const j = _extractJson(res?.content);
      if (Array.isArray(j?.orphanGroups)) {
        const assigned = new Set();
        for (const g of j.orphanGroups) {
          const files = _arr(g.files, 60).filter(f => orphanPool.has(f) && !assigned.has(f));
          if (!files.length) continue;
          files.forEach(f => assigned.add(f));
          orphanGroups.push({ name: _str(g.name, 80) || `Utility ${orphanGroups.length + 1}`, description: _str(g.description), files });
        }
      }
    } catch (e) { onProgress?.(`Orphan 分組失敗（略過，孤兒留在 meta）: ${e.message}`); }
  }

  // 決定論保底（2026-10-23）：LLM 分組沒跑成（沒模板/呼叫失敗/回應不可解析）而有孤兒時，
  // 依頂層目錄分組 — 骨架仍然是數學（字典序固定），肉照樣交 agent loop 長。map 永不為空。
  const llmGrouped = orphanGroups.filter(g => !g.template);
  if (llmGrouped.length === 0 && orphansForLLM.length > 0) {
    const byTop = new Map();
    for (const f of orphansForLLM) {
      const segs = f.split("/");
      const top = segs.length > 1 ? segs[0] : "(root)";
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top).push(f);
    }
    for (const [top, files] of [...byTop.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      orphanGroups.push({ name: `${top}（目錄自動分組）`, description: `LLM 分組未執行，依頂層目錄 ${top}/ 機械分組（共 ${files.length} 檔）。`, files: files.slice(0, 60) });
    }
    onProgress?.(`Orphan LLM 分組未產出 — 改用目錄決定論分組（${orphanGroups.length} 組）`);
  }

  // ── 4. work items：每個 feature 一個獨立 agent loop；拆出子結構的 → parent 複合 + 每子群一個 loop ──
  // 測試檔已決定論映射到 feature 的 tests（code-graph 分流 — 測試不是 feature，2026-09-06）
  const _topDirs = (files) => {
    const d = new Map();
    for (const f of files) { const seg = f.split("/"); const k = seg.slice(0, Math.min(3, seg.length - 1)).join("/") || "(root)"; d.set(k, (d.get(k) || 0) + 1); }
    return [...d].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([k, n]) => `${k}×${n}`);
  };
  const workItems = [];
  dm.features.forEach((f, i) => {
    const r = refinements[i];
    const base = { apis: f.apis, kinds: f.kinds, entryCount: f.entryCount, reachFiles: f.reachFiles.length, tests: (dm.tests?.featureTests?.[i] || []).slice() };
    if (r?.split) {
      const parentIdx = workItems.length;
      workItems.push({ kind: "parent", grade: "deterministic", files: f.codeFiles, refinement: r, subItemIdxs: [], ...base });
      for (const sub of r.subFeatures) {
        workItems[parentIdx].subItemIdxs.push(workItems.length);
        workItems.push({ kind: "subfeature", grade: "deterministic-sub", files: sub.codeFiles, apis: [], kinds: { sub: sub.codeFiles.length }, entryCount: 0, reachFiles: 0, tests: [], subKey: sub.key, vocabTop: sub.vocabTop, consensus: sub.consensus });
      }
    } else {
      // grade 尊重骨架（example tier 的 feature 標 grade=example，不當成產品功能）
      workItems.push({ kind: "deterministic", grade: f.grade || "deterministic", files: f.codeFiles, ...base });
    }
  });
  for (const g of orphanGroups.map(g => ({ kind: "utility", grade: "utility", files: g.files, apis: [], kinds: { orphan: g.files.length }, entryCount: 0, reachFiles: 0, groupName: g.name, groupDesc: g.description, template: !!g.template }))) workItems.push(g);

  // 斷點續跑：先載已完成 parts（帶簽名 — 結構變了（L2 拆法變）就丢棄舊 part，不誤接）
  const partsDir = join(projectRoot, ".paaw", "features", "parts");
  mkdirSync(partsDir, { recursive: true });
  const partPath = i => join(partsDir, `part-${String(i).padStart(3, "0")}.json`);
  const _itemSig = (item) => `${item.kind}:${item.subKey || ""}:${item.files.length}:${item.files[0] || ""}:${item.files[item.files.length - 1] || ""}`;
  const parts = new Map();
  for (let i = 0; i < workItems.length; i++) {
    try {
      const p = JSON.parse(readFileSync(partPath(i), "utf-8"));
      if (p && p.flesh && p.sig === _itemSig(workItems[i])) parts.set(i, p);
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
      const _notes = [];
      if (item.kind === "parent") _notes.push(`此 feature 已由「擾動穩定共識」拆出 ${item.refinement.subFeatures.length} 個穩定子群（SUB_FEATURES）+ ${item.refinement.internalShared.length} 個內部共享檔（INTERNAL_SHARED）。不要逐檔讀完全部 — 依子群結構為這個 feature（子群總稱）命名與描述；想抽驗可任讀 1-2 檔。`);
      if (item.kind === "subfeature") _notes.push(`這是大 feature 內的穩定子群（deterministic-sub，共識 ${item.consensus}）— 讀這些檔案，為「這個子能力」命名與描述，它是可獨立理解的單位。`);
      if (item.tests?.length) _notes.push(`TESTS 是此 feature 的測試檔（機器映射）— 讀它們幫助寫 bizLogic，但它們不是 feature 的 code 檔`);
      if (item.files.length > 40) _notes.push(`FILE LIST 只列前 40 檔（共 ${item.files.length}），其餘可用 glob 確認`);
      const material = {
        kind: item.kind,
        apis: item.apis.slice(0, 20).map(a => `${a.method} ${a.path}`),
        entryCount: item.entryCount,
        fileCount: item.files.length,
        FILE_LIST: item.files.slice(0, 40),
        ...(item.kind === "parent" ? {
          SUB_FEATURES: item.refinement.subFeatures.map((s) => ({ key: s.key, files: s.codeFiles.length, dirs: _topDirs(s.codeFiles), vocabTop: s.vocabTop, consensus: s.consensus })),
          INTERNAL_SHARED: item.refinement.internalShared.slice(0, 40),
        } : {}),
        ...(item.kind === "subfeature" ? { SUB_KEY: item.subKey, VOCAB_TOP: item.vocabTop } : {}),
        ...(item.tests?.length ? { TESTS: item.tests.slice(0, 10) } : {}),
        ...(_notes.length ? { NOTES: _notes } : {}),
        SHARED_LAYER: sharedBrief,
      };
      const userPrompt = (item.kind === "utility"
        ? `這是一個${item.template ? "同型重複（template）群組" : "孤兒分組"}（utility 級）— 系統建議的暫定組名「${item.groupName}」。請讀檔後給正式命名與描述。\n\n--- GROUP SKELETON (machine) ---\n`
        : item.kind === "parent"
        ? `此 feature 含穩定子結構（L2 內生判準拆出）。請依 SUB_FEATURES 子群組成為這個 feature（子群總稱）命名與描述。\n\n--- FEATURE SKELETON (machine) ---\n`
        : item.kind === "subfeature"
        ? `請長肉這一個「子群」（大 feature 內的穩定子能力；檔案歸屬數學已定，不可更改）。\n\n--- SUB-FEATURE SKELETON (machine) ---\n`
        : `請長肉這一個 feature（檔案歸屬數學已定，不可更改）。\n\n--- FEATURE SKELETON (machine) ---\n`)
        + stableStringify(material)
        + "\n\n用 read_file 實際讀程式碼（至少進入點檔 + 1-3 個核心檔），最後一輪輸出 JSON（name/description/bizLogic/tags）。";

      let flesh = null, last = null, turns = 0, dur = 0, usage = null;
      const kindLabel = item.kind === "subfeature" ? "大 feature 內的穩定子群" : item.kind === "parent" ? "含穩定子群的 feature" : item.kind === "utility" ? "同型/孤兒分組（utility 級）" : "feature";
      for (let attempt = 1; attempt <= 2 && !flesh; attempt++) {
        try {
          const strictNote = attempt > 1 ? "\n\n⚠️ 上一次輸出無法解析。這次最後一輪的回覆必須只有一個 ```json fence，四個欄位（name/description/bizLogic/tags）全部都要有，前後不要有其他文字。" : "";
          onProgress?.(`🤖 feature ${i + 1}/${workItems.length} agent loop（${item.kind}${attempt > 1 ? ` 重試#${attempt}` : ""}）：${item.apis?.[0]?.path || item.files?.[0] || ""}`);
          const r = await agentRunner({ systemPrompt: agentTpl, prompt: userPrompt + strictNote, cwd: projectRoot, rootDir: paawRoot, model });
          enrichment.loops++; turns += r.turns || 0; dur += r.durationMs || 0;
          if (r.usage) usage = r.usage;
          flesh = _extractJson(r.content);
          // 2026-10-23：驗證放寬 — 只要求 name（bizLogic 缺就補空，不再整包拒絕重燒）
          if (flesh && !_str(flesh.name, 80)) flesh = null;
          else if (flesh && typeof flesh.bizLogic === "undefined") flesh.bizLogic = "";
          last = r;
        } catch (e) { last = { error: e.message }; }
      }
      // 第 3 層保底（2026-10-23）：直呼 LLM 命名（決定論抽樣證據）— 要命名成功
      if (!flesh) {
        try {
          onProgress?.(`🛟 feature ${i + 1}/${workItems.length} 直呼 LLM 命名保底（${kindLabel}）：${item.files?.[0] || item.groupName || ""}`);
          flesh = await _directNameFallback({ callLLM, item, projectRoot, material, kindLabel });
        } catch (e) { last = { error: e.message }; }
      }
      if (!flesh) { flesh = _fallbackFlesh(item); enrichment.degraded++; }
      else if (flesh.enrichedBy === "direct-llm") enrichment.directNamed = (enrichment.directNamed || 0) + 1;
      else enrichment.ok++;
      const _wallMs = Date.now() - _itemT0;
      part = { sig: _itemSig(item), flesh, turns: turns, durationMs: dur, wallMs: _wallMs, usage, degraded: !!flesh.degraded, finishedAt: new Date().toISOString() };
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

  // ── 5. 合併：骨架 + 肉 → FEATURES.json（2026-10-10 19:29 Fleming：merge 鐵律 — 不再毀滅性重建）──
  // 新 cluster × 舊 feature by 檔案交集（≥50% = 同一個）→ 繼承舊 ID + 所有人員欄位
  // （severityDecisions/severity/status/knowledgeGaps/documentation/…）。
  // 消失的舊 feature 標 retired 不刪。寫入走 saveFeatures（備份輪替生效）。
  const now = new Date().toISOString();
  const _mkFeature = (item, fl, extra = {}) => ({
    name: _str(fl.name, 80) || `Feature ${item.kind}`,
    description: _str(fl.description),
    bizLogic: _str(fl.bizLogic, 500),
    status: "active",
    codeFiles: item.files,
    apis: item.apis,
    tests: item.tests || [],
    runbooks: [],
    tags: _arr(fl.tags, 6),
    grade: item.grade,
    evidence: {
      kinds: item.kinds,
      entryCount: item.entryCount,
      reachFiles: item.reachFiles,
      method: item.kind === "utility" ? (item.template ? "template-pattern" : "llm-grouping") : "label-propagation",
      tier: item.grade === "example" ? "example" : "source",
      enrichedBy: fl.enrichedBy || "agent-loop",
    },
    issues: [],
    aiUnderstanding: "",
    aiUnderstandingAt: null,
    documentation: "",
    docsUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  const fresh = [];
  workItems.forEach((item, i) => {
    const fl = parts.get(i)?.flesh || {};
    if (item.kind === "subfeature") return; // 子群掛在 parent 的 subFeatures，不是獨立 feature
    if (item.kind === "parent") {
      const subs = item.subItemIdxs.map((si, n) => {
        const subDef = item.refinement.subFeatures[n];
        const sfl = parts.get(si)?.flesh || {};
        return {
          key: subDef.key,
          name: _str(sfl.name, 80) || `${subDef.vocabTop?.[0] || _topDirs(subDef.codeFiles)[0] || subDef.key}（子群自動命名）`,
          description: _str(sfl.description),
          codeFiles: subDef.codeFiles,
          grade: "deterministic-sub",
          tags: _arr(sfl.tags, 6),
          evidence: { method: "stability-consensus-v1", consensus: subDef.consensus, vocabTop: subDef.vocabTop },
        };
      });
      fresh.push(_mkFeature(item, fl, {
        subFeatures: subs,
        internalShared: item.refinement.internalShared,
        evidence_sub: item.refinement.evidence,
      }));
    } else {
      fresh.push(_mkFeature(item, fl));
    }
  });

  const existing = loadFeatures(projectRoot);
  const newIds = nextFeatureIds(projectRoot, fresh.length); // 惰性拿號：只有真的新 feature 用
  const features = mergeFeaturesWithExisting(fresh, existing, (i) => newIds[i]);
  // 子群最終 ID = parent ID + SF 編號（parent ID 合併後才確定）
  for (const feat of features) {
    if (Array.isArray(feat.subFeatures)) for (const s of feat.subFeatures) s.id = `${feat.id}-${s.key}`;
  }

  const featuresDir = join(projectRoot, ".paaw", "features");
  mkdirSync(featuresDir, { recursive: true });
  saveFeatures(projectRoot, features); // 走 registry（備份輪替 + 標準形狀）

  // ── 橫切關注點（Cross-cutting Concepts）— overlay 層，確定性、零 token ──
  // 解「Budget Control 找不到獨立 feature」這類先天盲區：L1 是檔案歸屬的分割（partition），
  // 橫切關注點散在多 feature 分支、不擁有檔案 → 用 overlay concepts[] 表達（非分割、可重疊）。
  let crosscut = { concepts: [], stats: {}, gapReport: [] };
  try {
    onProgress?.("橫切關注點偵測（identifier fan-in + concern lexicon，零 token）...");
    crosscut = computeCrosscutConcepts(projectRoot, parsed, { features: features.filter((f) => f.status !== "retired") });
    if (crosscut.concepts.length) {
      onProgress?.(`橫切概念 ${crosscut.stats.concepts} 條（缺口 ${crosscut.stats.gaps} 條）`);
      writeFileSync(join(featuresDir, "CROSSCUT-CONCEPTS.json"), JSON.stringify({ scannedAt: new Date().toISOString(), ...crosscut }, null, 2));
    }
  } catch (e) {
    console.error("[feature-map] crosscut concepts:", e?.message || e);
  }

  // ── 5.5 CU 後自動落地 severity（2026-10-10 20:52 Fleming：不需要逐個 refresh 按鈕）──
  // 全量構成面掃描（deterministic 零 token）：by:scan/空 → 落地；by:ai 深度建議保留
  try { await autoScanAllFeatureSeverities(projectRoot); } catch (e) {
    console.error("[feature-map] auto severity scan:", e?.message || e);
  }

  const fileFeatureMap = {};
  for (const feat of features) {
    const subByFile = new Map();
    for (const s of feat.subFeatures || []) for (const f of s.codeFiles) subByFile.set(f, s.name);
    for (const f of [...(feat.codeFiles || []), ...(feat.tests || []), ...(feat.runbooks || [])]) {
      const norm = f.replace(/\\/g, "/");
      const entry = { id: feat.id, name: feat.name, tags: feat.tags || [] };
      if (subByFile.has(norm)) entry.sub = subByFile.get(norm);
      (fileFeatureMap[norm] ||= []).push(entry);
    }
  }
  writeFileSync(join(featuresDir, "FILE-FEATURES.json"), JSON.stringify({ files: fileFeatureMap, updatedAt: now }, null, 2));

  const orphanAssigned = new Set(orphanGroups.flatMap(g => g.files));
  const meta = {
    method: "deterministic-v3",
    tierStats: dm.stats?.tiers || null,
    coverage: dm.stats?.coverage ?? null,
    scannedAt: now,
    stats: dm.stats,
    shared: dm.shared,
    orphans: dm.orphans.filter(x => !orphanAssigned.has(x)),
    unmappedTests: dm.tests?.unmappedTests || [], // 測試檔歸不入任何 feature（dynamic import / 跨 feature）— Test Intelligence 頁看
    subFeatureRefinement: {
      method: "stability-consensus-v1",
      splitFeatures: refinements.filter(r => r.split).length,
      subFeatures: refinements.reduce((s, r) => s + r.subFeatures.length, 0),
      internalSharedFiles: refinements.reduce((s, r) => s + r.internalShared.length, 0),
      note: "拆/不拆由內生判準決定（擾動穩定共識 + 語義分離）；無檔數門檻。黏合橋接檔歸 feature 內部 internalShared。",
    },
    templateGroups: { count: templateGroups.length, files: templateGroups.reduce((s, g) => s + g.files.length, 0) },
    crosscutConcepts: crosscut.concepts,
    crosscutStats: crosscut.stats,
    gapReport: crosscut.gapReport,
    enrichment,
    note: "骨架 = Tier 分流（source/example/tooling/docs）→ barrel 塌縮 → Label Propagation 社群（100% 覆蓋、無 shared 黑洞）→ 目錄切分/寬目錄 roll-up → 入口標註（數學決定論，重跑不變）；grade=deterministic。長肉 = 每 feature 一個獨立 agent loop（core-read，多輪讀 code）；大 feature 由 L2 內生判準拆穩定子群（subFeatures，grade=deterministic-sub）。",
    skeleton: "deterministic-v3（label-propagation, 語言無關：js/ts/tsx/py/java/go/rust）",
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

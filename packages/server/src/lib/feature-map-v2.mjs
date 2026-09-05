/**
 * feature-map-v2.mjs — Deterministic Feature Map（2026-09-05 Fleming 定調）
 *
 * 「feature map 是骨架 → 數學說了算；長內容 → LLM；程式歸不了 → LLM 分但標 utility」
 *
 * Pipeline：
 *   1. parseProject（tree-sitter，無上限）
 *   2. buildDeterministicFeatureMap（code-graph.mjs — 進入點/reach/Jaccard 聚類，零 token、決定論）
 *   3. LLM 長肉（單 call）：每 cluster 命名 + 描述 + biz logic 摘要 + tags；orphans 分組建議
 *   4. 寫 .paaw/features/FEATURES.json（schema 相容 v1：id/name/description/status/codeFiles/apis/tests/runbooks/tags
 *      + 新欄位 bizLogic / grade("deterministic"|"utility") / evidence）
 *      + FILE-FEATURES.json（反查 map）+ FEATURE-MAP-META.json（shared/orphans/stats/方法）
 *
 * 決定論保證：2 是純數學（排序固定、無隨機）；同 repo 重跑 → 同 clusters → LLM 只換措辭。
 */
import { join, resolve as resolvePath } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
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

/**
 * @param root RU 絕對路徑
 * @param callLLM async ({messages}) => {content}
 * @param onProgress (msg) => void
 * @param paawRoot PAAW root（tree-sitter grammar 用）
 */
export async function organizeFeatureMapV2(root, { callLLM, onProgress, paawRoot }) {
  const projectRoot = resolvePath(root);

  onProgress?.("Tree-sitter parsing（無上限）...");
  const parsed = await parseProject(projectRoot, paawRoot, { maxFiles: 0, maxBytes: 500_000 });
  onProgress?.(`parsed ${parsed.stats.parsedFiles} files`);

  onProgress?.("Building deterministic code map（進入點 → reach → Jaccard 聚類）...");
  const dm = buildDeterministicFeatureMap(parsed);
  onProgress?.(`骨架完成：${dm.stats.clusters} clusters / ${dm.stats.shared} shared / ${dm.stats.orphans} orphans（零 token）`);

  if (dm.features.length === 0) {
    // 完全沒進入點的 repo：fallback 提示（不做 LLM 自由切分 — 寧可明說）
    const meta = { method: "deterministic-v2", scannedAt: new Date().toISOString(), stats: dm.stats, shared: dm.shared, orphans: dm.orphans, note: "No entry points found (no routes/ui/public api) — 無法決定論抽取，請人工或 LLM utility 模式" };
    const featuresDir = join(projectRoot, ".paaw", "features");
    mkdirSync(featuresDir, { recursive: true });
    writeFileSync(join(featuresDir, "FEATURE-MAP-META.json"), JSON.stringify(meta, null, 2));
    return { features: [], meta };
  }

  // ── LLM 長肉素材（緊湊、cap 過）──
  const clusterBrief = dm.features.map((f, i) => ({
    idx: i,
    kinds: f.kinds,
    entryCount: f.entryCount,
    apis: f.apis.slice(0, 6).map(a => `${a.method} ${a.path}`),
    files: f.codeFiles.slice(0, 12),
    fileCount: f.codeFiles.length,
  }));
  const material = {
    system: "每個 cluster = 一組高 call-graph 重疊的進入點（route/UI/公開 API）。檔案歸屬由數學決定，你只負責命名與摘要。",
    clusters: clusterBrief,
    sharedLayer: dm.shared.slice(0, 30),
    orphans: dm.orphans.slice(0, 40),
  };

  const template = _loadTemplate(projectRoot);
  if (!template) throw new Error("prompt template feature-map-v2.md not found");
  onProgress?.("LLM 長肉（命名 + biz logic 摘要 + orphan 分組）...");
  const res = await callLLM({
    messages: [{ role: "user", content: template + "\n\n--- DETERMINISTIC SKELETON (machine, 數學說了算) ---\n" + JSON.stringify(material) }],
    temperature: 0,
    thinking: { type: "disabled" },
    timeoutMs: 600_000,
  });
  let txt = String(res?.content || "").trim();
  if (!txt) throw new Error("empty LLM response");
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1].trim();
  let flesh;
  try { flesh = JSON.parse(txt); } catch (e) { throw new Error(`LLM flesh JSON invalid: ${e.message}`); }

  // ── 合成 features（骨架 + 肉）──
  const clusterNames = new Map();
  for (const c of Array.isArray(flesh.clusters) ? flesh.clusters : []) {
    if (Number.isInteger(c?.idx) && c.idx >= 0 && c.idx < dm.features.length) clusterNames.set(c.idx, c);
  }
  const ids = nextFeatureIds(projectRoot, dm.features.length + ((Array.isArray(flesh.orphanGroups) ? flesh.orphanGroups : []).length));
  const now = new Date().toISOString();
  const features = dm.features.map((f, i) => {
    const fl = clusterNames.get(i) || {};
    return {
      id: ids[i],
      name: _str(fl.name, 80) || `Feature ${i + 1}`,
      description: _str(fl.description),
      bizLogic: _str(fl.bizLogic, 500),
      status: "active",
      codeFiles: f.codeFiles,
      apis: f.apis,
      tests: [],
      runbooks: [],
      tags: _arr(fl.tags, 6),
      grade: "deterministic",
      evidence: {
        kinds: f.kinds,
        entryCount: f.entryCount,
        reachFiles: f.reachFiles.length,
        method: "entry-reach-jaccard",
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
  // orphans → utility 級 features（LLM 分組建議，人類可否決）
  const orphanGroups = Array.isArray(flesh.orphanGroups) ? flesh.orphanGroups : [];
  const orphanAssigned = new Set();
  orphanGroups.forEach((g, gi) => {
    const files = _arr(g.files, 60).filter(xf => dm.orphans.includes(xf));
    if (!files.length) return;
    files.forEach(xf => orphanAssigned.add(xf));
    features.push({
      id: ids[dm.features.length + gi],
      name: _str(g.name, 80) || `Utility ${gi + 1}`,
      description: _str(g.description),
      bizLogic: _str(g.bizLogic, 500),
      status: "active",
      codeFiles: files,
      apis: [],
      tests: [],
      runbooks: [],
      tags: _arr(g.tags, 6),
      grade: "utility", // ⚠️ 非決定論 — LLM 分的，人類定案前是建議
      evidence: { source: "orphans", method: "llm-grouping" },
      issues: [], aiUnderstanding: "", aiUnderstandingAt: null, documentation: "", docsUpdatedAt: null,
      createdAt: now, updatedAt: now,
    });
  });

  // ── 寫檔（FEATURES.json schema 相容 + 反查 map + meta）──
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

  const meta = {
    method: "deterministic-v2",
    scannedAt: now,
    stats: dm.stats,
    shared: dm.shared,
    orphans: dm.orphans.filter(x => !orphanAssigned.has(x)),
    note: "骨架 = 進入點 reach + Jaccard 聚類（數學決定論，重跑不變）；grade=deterministic。LLM 只命名/摘要/bizLogic；orphan 分組 grade=utility（建議，人類定案）。",
  };
  writeFileSync(join(featuresDir, "FEATURE-MAP-META.json"), JSON.stringify(meta, null, 2));

  // tree-sitter 完整分析留檔（debug 用，同 v1 行為）
  try {
    const { formatForAI } = await import("./tree-sitter-parser.mjs");
    writeFileSync(join(featuresDir, "tree-sitter-analysis.txt"), formatForAI(parsed));
  } catch {}

  return { features, meta };
}

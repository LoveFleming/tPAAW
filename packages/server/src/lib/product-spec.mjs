/**
 * product-spec.mjs — Product Spec（AI-Native Product Development Specification，2026-11-15 Fleming）
 *
 * 定位：8-section 規格 = 專案的單一真相文件，與 PROJECT.md 同位階。
 * - CU `product-spec` step：只做「第一次」— 為空 section 從 code 反向生成初稿（既有 section 一律不碰）
 * - 新 project（無 code）CU 不做 spec — 由架構師 agent 在 Spec 頁跟人逐段討論產出
 * - 之後維護 = 架構師 agent（spec side chat / spec_write 受控工具），CU 不自動同步
 *
 * 檔案佈局：<ru>/.paaw/spec/
 *   01-overview.md ... 08-operations.md（一 section 一檔）
 *   meta.json — { sections: { <id>: { status: draft|review|final, updatedAt } } }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 8 sections — schema 固定（Fleming 2026-11-15 提供），evidence = CU deterministic 產出 */
export const SPEC_SECTIONS = [
  { id: "overview", num: 1, file: "01-overview.md", title: "Product Overview", zh: "產品定位、目標、範圍、使用情境", owner: "PM + Architect" },
  { id: "functional", num: 2, file: "02-functional-reqs.md", title: "Functional Requirements", zh: "功能需求、業務規則、Acceptance Criteria", owner: "PM + Architect", evidence: ["features/FEATURES.json", "api-map.json"] },
  { id: "nfr", num: 3, file: "03-non-functional.md", title: "Non-Functional Requirements", zh: "Performance、Availability、Security、Scalability", owner: "Architect" },
  { id: "api", num: 4, file: "04-api-contract.md", title: "API & Data Contract", zh: "API、Request / Response、Error Code、Schema", owner: "Architect", evidence: ["api-map.json", "error-codes.json"] },
  { id: "architecture", num: 5, file: "05-architecture.md", title: "Architecture Design", zh: "Components、Sequence、Integration、Data Flow", owner: "Architect", evidence: ["c4-model.json", "scan.json"] },
  { id: "technical", num: 6, file: "06-technical-design.md", title: "Technical Design", zh: "Modules、Interface、核心邏輯、技術選型", owner: "Architect + Developer", evidence: ["code-intelligence/summary.json", "scan.json"] },
  { id: "testing", num: 7, file: "07-testing.md", title: "Testing Strategy", zh: "Unit、Integration、E2E、Failure Scenarios", owner: "Developer + AI", evidence: ["code-intelligence/test-intelligence.json"] },
  { id: "operations", num: 8, file: "08-operations.md", title: "Operations & Observability", zh: "Metrics、Logging、Tracing、Deployment、Alerting", owner: "SRE + Developer" },
];

export function specDir(root) { return join(root, ".paaw", "spec"); }

function readMeta(root) {
  try {
    return JSON.parse(readFileSync(join(specDir(root), "meta.json"), "utf-8"));
  } catch { return { sections: {} }; }
}

function writeMeta(root, meta) {
  const dir = specDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
}

/** 讀整份 spec 狀態（sections 內容 + meta）— GET /api/coding-project/spec 用 */
export function readSpecState(root) {
  const meta = readMeta(root);
  const sections = SPEC_SECTIONS.map((s) => {
    const path = join(specDir(root), s.file);
    let content = "";
    try { content = readFileSync(path, "utf-8"); } catch {}
    // scaffold（ensureSpecFiles 寫的「尚未填寫」起點）等同空 section
    const isScaffold = content.includes("（尚未填寫");
    const hasContent = content.trim().length > 0 && !isScaffold;
    const m = meta.sections?.[s.id] || {};
    return {
      ...s,
      content: hasContent ? content : "",
      hasContent,
      status: hasContent ? (m.status || "draft") : "empty",
      updatedAt: m.updatedAt || null,
    };
  });
  return { sections, schemaVersion: 1 };
}

/**
 * 寫單一 section（人編輯存檔 / spec_write 工具共用）。
 * status: draft | review | final（final = 人定稿）
 */
export function writeSpecSection(root, sectionId, content, status) {
  const def = SPEC_SECTIONS.find(s => s.id === sectionId);
  if (!def) throw new Error(`Unknown spec section: ${sectionId}`);
  const dir = specDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = join(dir, def.file);
  if (existsSync(target)) {
    try { writeFileSync(target + ".bak", readFileSync(target, "utf-8"), "utf-8"); } catch {} // 自動備份（同 handover_write 哲學）
  }
  writeFileSync(target, String(content ?? ""), "utf-8");
  const meta = readMeta(root);
  if (!meta.sections) meta.sections = {};
  const prev = meta.sections[sectionId] || {};
  meta.sections[sectionId] = {
    status: status || prev.status || "draft",
    updatedAt: new Date().toISOString(),
  };
  writeMeta(root, meta);
  return { ok: true, section: sectionId, status: meta.sections[sectionId].status };
}

/** section 模板標頭（空 section 討論起點） */
function scaffoldHeader(def) {
  return `# ${def.title}\n\n> ${def.zh}（負責：${def.owner}）— Status: Draft\n\n（尚未填寫 — 與架構師討論後逐段完成）\n`;
}

/** 確保 8 個 section 檔存在（空檔 = 討論起點 scaffold），回傳新建的 section ids */
export function ensureSpecFiles(root) {
  const dir = specDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const created = [];
  for (const s of SPEC_SECTIONS) {
    const p = join(dir, s.file);
    if (!existsSync(p)) {
      writeFileSync(p, scaffoldHeader(s), "utf-8");
      created.push(s.id);
    }
  }
  return created;
}

function readEvidence(root, rel, maxLen = 6000) {
  try {
    const c = readFileSync(join(root, ".paaw", rel), "utf-8");
    if (!c.trim()) return null;
    return c.length > maxLen ? c.slice(0, maxLen) + "\n... (truncated)" : c;
  } catch { return null; }
}

function loadPromptTemplate() {
  // 與 CU prompts 同一套載入約定：packages 內建（隨部署走）
  return readFileSync(join(__dirname, "..", "prompts", "code-understanding", "gen-product-spec.md"), "utf-8");
}

/**
 * CU step：只為「空 section」反向生成初稿（第一次）。
 * - 既有內容一律不碰（人/AI 討論的成果是權威，CU 不自動同步 — Fleming 2026-11-15 定調）
 * - opts.onProgress(stepName) 回報進度；opts.callLLM(fullPrompt) → { content }
 * @returns {{ generated: string[], skipped: number }}
 */
export async function generateMissingSpecSections(root, opts = {}) {
  const { onProgress, callLLM } = opts;
  if (typeof callLLM !== "function") throw new Error("callLLM required");

  // 新 project（幾乎無 source）不做 — spec 由架構師在 UI 逐段討論產出
  const { countSourceFiles } = await import("./cu-source-scan.mjs");
  const nFiles = countSourceFiles(root).count;
  if (nFiles < 5) {
    return { generated: [], skipped: 0, reason: `new/empty project (${nFiles} source files) — spec 由架構師討論產出，不跑 CU` };
  }

  const template = loadPromptTemplate();
  const state = readSpecState(root);
  const empty = state.sections.filter(s => !s.hasContent);
  if (empty.length === 0) return { generated: [], skipped: SPEC_SECTIONS.length, reason: "all sections exist" };

  // 全專案共用 evidence 摘要（一次讀，多 section 重用）
  const evidencePool = {};
  for (const rel of ["scan.json", "features/FEATURES.json", "api-map.json", "error-codes.json", "c4-model.json", "code-intelligence/summary.json", "code-intelligence/test-intelligence.json"]) {
    const c = readEvidence(root, rel, rel === "features/FEATURES.json" || rel === "api-map.json" ? 10000 : 6000);
    if (c) evidencePool[rel] = c;
  }

  const generated = [];
  for (const sec of empty) {
    onProgress?.(`${sec.num}. ${sec.title} 生成中…`);
    const ev = (sec.evidence || []).map(rel => evidencePool[rel] ? `--- ${rel} ---\n${evidencePool[rel]}` : null).filter(Boolean).join("\n\n");
    const prompt = template
      .replace(/\{\{num\}\}/g, String(sec.num))
      .replace(/\{\{title\}\}/g, sec.title)
      .replace(/\{\{zh\}\}/g, sec.zh)
      .replace(/\{\{owner\}\}/g, sec.owner)
      + `\n\n--- EVIDENCE（deterministic 產出，以此為準，不可發明不存在的 API/feature）---\n${ev || "（此 section 無 deterministic evidence — 依 scan/一般工程慣例保守撰寫，不明處標「待確認」）"}`;
    const result = await callLLM(prompt);
    const content = String(result.content || "").trim();
    if (!content) continue;
    const sanitized = content.replace(/^\s*```(?:markdown)?\s*\n?/m, "").replace(/\n?```\s*$/m, "");
    writeSpecSection(root, sec.id, sanitized, "draft");
    generated.push(sec.id);
  }
  return { generated, skipped: SPEC_SECTIONS.length - generated.length };
}

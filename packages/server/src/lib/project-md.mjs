// lib/project-md.mjs — PROJECT.md schema v2（User Remarks + AI Overview 兩區）
//
// 2026-10-09 Fleming 需求：維運/交接/troubleshooting agent 要有專案說明可參考。
// 設計（拍板版）：
//   - 一檔兩區：USER marker 區（人寫，AI 絕不覆蓋）+ AI marker 區（CU 每次重寫）
//   - AI 區固定六小節 schema：一句話定位 / 架構與模組 / 如何建置跑測 / Feature 清單 / 維運要點 / 最新決策
//   - 生成 = 確定性事實層（.paaw 產物 + package.json）→ LLM 潤飾；LLM 失敗 fallback 純事實層
//   - 舊檔遷移：無 marker → auto-draft 簽名檔丟棄重生；人寫內容整檔搬進 USER 區
//
// 注意：路徑用 .paaw/PROJECT.md（與 context-providers projectProvider、舊 maybeWriteProjectDraft 一致）

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createPaawProject } from "./paaw-project.mjs";

export const USER_START = "<!-- USER:START — 人的區（AI 絕不覆蓋） -->";
export const USER_END = "<!-- USER:END -->";
export const AI_START = "<!-- AI:START — CU 自動生成區（每次重寫，人改會被覆蓋） -->";
export const AI_END = "<!-- AI:END -->";
const LEGACY_AUTO_SIGN = "🤖 CU 自動生成初稿"; // 舊 deterministic draft 的簽名

function sliceBetween(md, startMark, endMark) {
  const s = md.indexOf(startMark);
  const e = md.indexOf(endMark);
  if (s === -1 || e === -1 || e < s) return null;
  return md.slice(s + startMark.length, e).replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

/** 解析 PROJECT.md → 兩區。無 marker 的舊檔做遷移判定（人寫→USER 區；auto-draft→丟棄） */
export function parseProjectMd(md) {
  if (!md || !md.trim()) return { userSection: "", aiSection: "", migrated: false };
  const user = sliceBetween(md, USER_START, USER_END);
  const ai = sliceBetween(md, AI_START, AI_END);
  if (user !== null || ai !== null) {
    return { userSection: user || "", aiSection: ai || "", migrated: false };
  }
  // 舊格式遷移
  if (md.includes(LEGACY_AUTO_SIGN)) {
    return { userSection: "", aiSection: "", migrated: true }; // auto-draft：全丟，重生 AI 區
  }
  // 人寫過的（或 placeholder）→ 整檔內容搬進 USER 區保護
  return { userSection: md.trim(), aiSection: "", migrated: true };
}

/** 合成整檔（schema v2） */
export function buildProjectMd(name, userSection, aiSection) {
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const L = [];
  L.push(`# ${name}`);
  L.push("");
  L.push(`> 📄 Schema v2 · AI 區每次 CU 重寫 · 上次生成 ${ts} · User Remarks 由人維護`);
  L.push("");
  L.push(USER_START);
  L.push("## 📌 User Remarks");
  L.push("");
  L.push(userSection?.trim() || "（人在 UI 或直接編輯這區 — AI 絕不覆蓋。放專案背景、地雷、口頭知識…）");
  L.push("");
  L.push(USER_END);
  L.push("");
  L.push(AI_START);
  L.push(aiSection?.trim() || "## 🤖 AI Overview\n\n（尚未生成 — 跑 CU 或按 🔄 重新生成）");
  L.push("");
  L.push(AI_END);
  L.push("");
  return L.join("\n");
}

/** 確定性事實層收集（來源：.paaw 產物 + package.json — 不掃 repo，零成本） */
async function collectFacts(root) {
  const paaw = createPaawProject(root);
  const readJson = async (rel) => {
    try { return JSON.parse((await paaw.readFile(rel)) || "null"); } catch { return null; }
  };
  const [fm, ti, ec, ciSum] = await Promise.all([
    readJson("features/FEATURES.json"),
    readJson("code-intelligence/test-intelligence.json"),
    readJson("error-codes.json"),
    readJson("code-intelligence/summary.json"),
  ]);

  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")); } catch {}

  // DECISIONS.md 最近 3 則 ADR 標題
  let adrTitles = [];
  try {
    const md = (await paaw.readFile("DECISIONS.md")) || "";
    adrTitles = (md.match(/^##\s+(ADR-\d+):.*$/gm) || []).slice(-3).reverse().map(l => l.replace(/^##\s+/, ""));
  } catch {}

  const features = fm?.features || [];
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const knownFw = [["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"], ["fastify", "Fastify"], ["nestjs", "NestJS"], ["@nestjs/core", "NestJS"], ["electron", "Electron"], ["vite", "Vite"], ["tailwindcss", "Tailwind CSS"]];
  const frameworks = knownFw.filter(([k]) => deps[k]).map(([, n]) => n);
  const scripts = pkg?.scripts ? Object.entries(pkg.scripts).filter(([k]) => ["dev", "dev:ui", "dev:server", "build", "start", "start:prod", "test", "typecheck", "lint"].includes(k)) : [];

  return {
    name: pkg?.name || root.split(/[\\/]/).pop() || "Project",
    description: pkg?.description || null,
    frameworks,
    scripts,
    features: features.map(f => ({ id: f.id, name: f.name, desc: f.description || "", codeFiles: f.codeFiles?.length || 0, apis: f.apis?.length || 0 })),
    tests: ti?.stats ? { files: ti.stats.totalTestFiles, byType: ti.stats.byType || {}, coverage: ti.stats.coverageRate } : null,
    errorCodes: ec?.stats?.uniqueCodes ?? null,
    codeIntel: ciSum ? { functions: ciSum.callGraph?.totalFunctions, symbols: ciSum.symbolIndex?.total } : null,
    adrTitles,
  };
}

/** 確定性 AI 區骨架（LLM 失敗的 fallback — 有事實就寫事實，沒有標待補） */
function deterministicAiSection(facts) {
  const L = [];
  L.push("## 🤖 AI Overview");
  L.push("");
  L.push("### 一句話定位");
  L.push(facts.description || `（資料待補 — package.json 無 description）`);
  L.push("");
  L.push("### 架構與模組");
  L.push(`框架：${facts.frameworks.join(", ") || "—"}`);
  if (facts.codeIntel) L.push(`程式規模：${facts.codeIntel.functions ?? "?"} functions / ${facts.codeIntel.symbols ?? "?"} symbols`);
  L.push("");
  L.push("### 如何建置/跑/測");
  if (facts.scripts.length) { for (const [k, v] of facts.scripts) L.push(`- \`npm run ${k}\`${v.length < 60 ? " — " + v : ""}`); }
  else L.push("- （package.json 無常用 script — 資料待補）");
  L.push("");
  L.push("### Feature 清單");
  L.push("| Feature | 說明 | 檔案數 |");
  L.push("|---|---|---|");
  if (facts.features.length) {
    for (const f of facts.features.slice(0, 25)) L.push(`| [${f.id}] ${f.name} | ${(f.desc || "").slice(0, 60)} | ${f.codeFiles} |`);
    if (facts.features.length > 25) L.push(`| … | 共 ${facts.features.length} features | |`);
  } else L.push("| （尚未跑 feature-map） | | |");
  L.push("");
  L.push("### 維運要點");
  const bits = [];
  if (facts.tests) bits.push(`測試：${facts.tests.files} 檔（unit ${facts.tests.byType.unit ?? 0} / e2e ${facts.tests.byType.e2e ?? 0}）coverage ${facts.tests.coverage ?? "—"}`);
  if (facts.errorCodes != null) bits.push(`Error codes：${facts.errorCodes} 個`);
  L.push(bits.length ? bits.map(b => `- ${b}`).join("\n") : "- （資料待補）");
  L.push("");
  L.push("### 最新決策");
  L.push(facts.adrTitles.length ? facts.adrTitles.map(t => `- ${t}`).join("\n") : "- （DECISIONS.md 尚無 ADR）");
  L.push("");
  return L.join("\n");
}

/** LLM 潤飾：事實層 → 六小節 markdown（標題 schema 固定） */
async function llmAiSection(facts, callLLM) {
  const schemaNote = "### 一句話定位\n### 架構與模組\n### 如何建置/跑/測\n### Feature 清單（表格：| Feature | 說明 | 檔案數 |）\n### 維運要點\n### 最新決策";
  const prompt = `你是 release unit 的技術文件工程師。根據下方「事實資料」寫 PROJECT.md 的 AI Overview 區塊。

嚴格規則：
- 只用事實資料，不捏造；資料沒有的寫「（資料待補）」
- 固定六個小節，標題照抄（三級標題）：
${schemaNote}
- 一句話定位：1-2 句，講清楚這是什麼、給誰用（從 description/features 推導，不要發明新事實）
- 架構與模組：框架 + 程式規模 + 從 features 推模組分佈
- Feature 清單：全部 features 進表格
- 維運要點：測試/error codes 現況 + 給維運工程師的提醒
- 最新決策：照 ADR 標題列點；沒有就寫尚無
- 只輸出六節 markdown 本體：不要在最外層包 \`\`\` 圍籬、不要 # 一級標題（頂層用 ## 🤖 AI Overview 開頭）、不要前言結語；小節內需要 code block 時正常用 \`\`\` 圍籬（如指令清單）

事實資料（JSON）：
${JSON.stringify(facts, null, 2)}`;
  const r = await callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.2, maxTokens: 8192, thinking: { type: "disabled" } }); // 摘要任務停 thinking（2026-08-30 教訓：thinking 燸光 max_tokens → content 空）
  let content = r?.content?.trim() || "";
  if (!content) return null;
  // 去圍籬 + 確保頂層標題
  content = content.replace(/^```(?:markdown)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  if (!content.startsWith("## ")) content = `## 🤖 AI Overview\n\n${content}`;
  return content;
}

/**
 * 重生成 PROJECT.md（AI 區重寫、USER 區原樣保留）
 * @param {string} root project root
 * @param {{ callLLM?: Function, model?: string }} opts callLLM: coding.mjs callProjectLLM 同簽名
 * @returns {Promise<{written:boolean, reason:string, features:number, aiSource:"llm"|"deterministic"}>}
 */
export async function regenerateProjectMd(root, opts = {}) {
  const paaw = createPaawProject(root);
  const existing = await paaw.readFile("PROJECT.md");
  const parsed = parseProjectMd(existing);
  const facts = await collectFacts(root);

  // AI 區：LLM 優先，失敗 fallback 確定性骨架
  let aiSection = null;
  let aiSource = "deterministic";
  if (opts.callLLM) {
    try {
      aiSection = await llmAiSection(facts, opts.callLLM);
      if (aiSection) aiSource = "llm";
    } catch { /* fallback below */ }
  }
  if (!aiSection) aiSection = deterministicAiSection(facts);

  const next = buildProjectMd(facts.name, parsed.userSection, aiSection);

  // diff-write：內容相同就不動檔案 mtime（git 友善）
  if (existing === next) return { written: false, reason: "identical", features: facts.features.length, aiSource };
  await paaw.writeFile("PROJECT.md", next);
  return {
    written: true,
    reason: existing ? (parsed.migrated ? "migrated" : "ai-updated") : "created",
    features: facts.features.length,
    aiSource,
  };
}

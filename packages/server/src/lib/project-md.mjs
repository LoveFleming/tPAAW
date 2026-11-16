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
import { loadFeatures as registryLoadFeatures } from "./feature-registry.mjs";

export const USER_START = "<!-- USER:START — 人的區（AI 絕不覆蓋） -->";
export const USER_END = "<!-- USER:END -->";
// 2026-11-16 schema v3：中間加 Product Spec 區（人+AI 共寫；Fleming — spec 做在 project page，不另開頁/agent）
export const SPEC_START = "<!-- SPEC:START — Product Spec（人+AI 共寫區） -->";
export const SPEC_END = "<!-- SPEC:END -->";
export const AI_START = "<!-- AI:START — CU 自動生成區（每次重寫，人改會被覆蓋） -->";
export const AI_END = "<!-- AI:END -->";

/** Product Spec 固定 8 節 schema（2026-11-16 — 同原 spec 設計，落在 PROJECT.md） */
export const SPEC_SECTIONS = [
  "1. Product Overview — 產品定位、目標、範圍、使用情境",
  "2. Functional Requirements — 功能需求、業務規則、Acceptance Criteria",
  "3. Non-Functional Requirements — Performance、Availability、Security、Scalability",
  "4. API & Data Contract — API、Request/Response、Error Code、Schema",
  "5. Architecture Design — Components、Sequence、Integration、Data Flow",
  "6. Technical Design — Modules、Interface、核心邏輯、技術選型",
  "7. Testing Strategy — Unit、Integration、E2E、Failure Scenarios",
  "8. Operations & Observability — Metrics、Logging、Tracing、Deployment、Alerting",
];
const LEGACY_AUTO_SIGN = "🤖 CU 自動生成初稿"; // 舊 deterministic draft 的簽名

/** 分節用純標題（tab sheet / split-join 對齊這個） */
export const SPEC_SECTION_TITLES = SPEC_SECTIONS.map(s => s.split(" — ")[0]);

/** 把 spec markdown 切成 8 節內容（無標題的空字串）— tab sheet 用（2026-11-16 Fleming） */
export function splitSpecSections(specMd) {
  const parts = new Array(8).fill("");
  if (!specMd) return parts;
  const lines = specMd.split("\n");
  let idx = -1;
  for (const line of lines) {
    const m = line.match(/^##\s+(\d)\.\s/);
    if (m) {
      const n = parseInt(m[1], 10);
      idx = n >= 1 && n <= 8 ? n - 1 : -1;
      continue;
    }
    if (idx >= 0) parts[idx] += line + "\n";
  }
  return parts.map(p => p.split("\n").filter(l => l.trim() !== "（尚未撰寫 — 跟右邊林曉薇討論後按「✍️ 曉薇寫入本節」，或手動編輯）").join("\n").trim());
}

/** 8 節内容合回 spec markdown */
export function joinSpecSections(parts) {
  const L = [];
  for (let i = 0; i < 8; i++) {
    L.push(`## ${SPEC_SECTION_TITLES[i]}`);
    const c = (parts[i] || "").trim();
    L.push(c || "（尚未撰寫 — 跟右邊林曉薇討論後按「✍️ 曉薇寫入本節」，或手動編輯）");
    L.push("");
  }
  return L.join("\n").trim();
}

/** 讀林曉薇 spec side chat 對話歷史當寫入依據：active.json 優先， fallback 最新 s-*.json */
async function readSpecAiConversation(paaw) {
  const dir = "coding-memory/conversations/coding.spec-side";
  const readJson = async (rel) => {
    try { return JSON.parse(await paaw.readFile(rel)); } catch { return null; }
  };
  let conv = await readJson(`${dir}/active.json`);
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
    try {
      const { readdir } = await import("fs/promises");
      const { join } = await import("node:path");
      const names = (await readdir(join(paaw.paawDir, dir))).filter(n => n.startsWith("s-") && n.endsWith(".json")).sort();
      if (names.length) conv = await readJson(`${dir}/${names[names.length - 1]}`);
    } catch {}
  }
  const msgs = Array.isArray(conv?.messages) ? conv.messages : (Array.isArray(conv) ? conv : []);
  return msgs.filter(m => (m.role === "user" || m.role === "assistant") && m.content).slice(-30);
}

/**
 * 林曉薇寫入單一 section（2026-11-16 Fleming — 人不用寫，AI 觸發頁面更新）
 * 依據：跟曉薇的討論對話 + 專案事實（.paaw 產物）。LLM 失敗回 null 不寫。
 */
export async function generateSpecSection(root, index, opts = {}) {
  if (!(index >= 0 && index < 8)) throw new Error("bad index");
  if (!opts.callLLM) return null; // 無 LLM 管線不寫入（间單拒絕，不破壞檔案）
  const paaw = createPaawProject(root);
  const [conversation, facts] = await Promise.all([readSpecAiConversation(paaw), collectFacts(root)]);
  const title = SPEC_SECTIONS[index];
  const transcript = conversation.map(m => `${m.role === "user" ? "人" : "曉薇"}: ${m.content}`).join("\n\n").slice(-16000);
  const prompt = `你是林曉薇（Product Spec 協作助理）。根據下方「與人的討論紀錄」和「專案事實」，寫出 Product Spec 的其中一節。

目標 section：## ${title}

嚴格規則：
- 討論紀錄裡人的決定/結論最優先；其次專案事實；都没有的寫「（待討論）」
- 不得起造事實；專案事實沒有的 API/feature 不要發明
- 輸出 5-15 條 markdown 要點（### 小標可自訂），直接可用；流程/架構/互動盡量附 mermaid 圖（mermaid 圍籬：flowchart / sequenceDiagram / stateDiagram-v2）
- 只輸出這一節的 markdown 本體：不加 ## 標題（外層會加）、不包 \`\`\` 圍籬、無前言結語
${transcript ? `
與人的討論紀錄（最新在後）：
${transcript}` : "\n（尚無討論紀錄 — 依專案事實寫，沒有的寫待討論）"}

專案事實（JSON）：
${JSON.stringify(facts, null, 2)}`;
  const r = await opts.callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.3, maxTokens: 8192, thinking: { type: "disabled" } });
  let content = r?.content?.trim() || "";
  if (!content) return null;
  content = content.replace(/^```(?:markdown)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  // 寫入：只動這一節
  const existing = await paaw.readFile("PROJECT.md");
  const parsed = parseProjectMd(existing);
  const parts = splitSpecSections(parsed.specSection || "");
  parts[index] = content;
  const specSection = joinSpecSections(parts);
  let name = facts.name || "Project";
  await paaw.writeFile("PROJECT.md", buildProjectMd(name, null, null, specSection));
  return { written: true, index, content };
}

function sliceBetween(md, startMark, endMark) {
  const s = md.indexOf(startMark);
  const e = md.indexOf(endMark);
  if (s === -1 || e === -1 || e < s) return null;
  return md.slice(s + startMark.length, e).replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}


/** 骨架行剝除（marker/註解/schema 標籤/區塊標題）— marker 路徑也要用，防「## 📌 User Remarks」每輪重生成疊一層（2026-11-08 browser 實測抓到 10 層） */
const stripSkeletonLines = (s) => s.split("\n").filter(l => {
  const t = l.trim();
  if (/^<!--[\s\S]*-->$/.test(t)) return false;
  if (/^>\s*📄\s*Schema v2/.test(l)) return false;
  if (/^##\s*📌\s*User Remarks$/.test(t)) return false;
  if (/^##\s*🤖\s*AI Overview$/.test(t)) return false;
  if (/^##\s*📄\s*Product Spec$/.test(t)) return false;
  if (/^>\s*📄\s*Schema v3/.test(t)) return false;
  return true;
}).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** 解析 PROJECT.md → 三區（user / spec / ai）。無 marker 的舊檔做遷移判定（人寫→USER 區；auto-draft→丟棄） */
export function parseProjectMd(md) {
  if (!md || !md.trim()) return { userSection: "", specSection: "", aiSection: "", migrated: false };
  const user = sliceBetween(md, USER_START, USER_END);
  const spec = sliceBetween(md, SPEC_START, SPEC_END);
  const ai = sliceBetween(md, AI_START, AI_END);
  if (user !== null || spec !== null || ai !== null) {
    const stripSpecPlaceholder = (s) => (s && /^（尚未撰寫/.test(s.trim()) ? "" : s);
    return {
      userSection: user ? stripSkeletonLines(user) : "",
      specSection: spec ? stripSpecPlaceholder(stripSkeletonLines(spec)) : "",
      aiSection: ai ? stripSkeletonLines(ai) : "",
      migrated: false,
    };
  }
  // 舊格式遷移
  if (md.includes(LEGACY_AUTO_SIGN)) {
    return { userSection: "", aiSection: "", migrated: true }; // auto-draft：全丟，重生 AI 區
  }
  // 人寫過的（或 placeholder）→ 整檔內容搬進 USER 區保護
  // 2026-10-09 防滾雪球：marker 被剝掉的 schema v2 檔（公司端回存常見）再 migrate 會把整包骨架
  // 一層層疊進 USER 區 — 偵測 v2 特徵時按標題切兩區，不用「整檔當人寫」
  const hasV2 = /^##\s*📌\s*User Remarks/m.test(md) || /^##\s*🤖\s*AI Overview/m.test(md) || /^>\s*📄\s*Schema v2/m.test(md);
  const stripSkeleton = stripSkeletonLines;
  if (hasV2) {
    const mUser = md.match(/[\s\S]*?^##\s*📌\s*User Remarks[^\n]*\n([\s\S]*?)(?=^##\s*🤖\s*AI Overview|\s*$)/m);
    const mAi = md.match(/^##\s*🤖\s*AI Overview[^\n]*\n([\s\S]*)/m);
    return { userSection: mUser ? stripSkeleton(mUser[1]) : "", specSection: "", aiSection: mAi ? stripSkeleton(mAi[1]) : "", migrated: true };
  }
  const stripped = stripSkeleton(md);
  // 剝完只剩 H1 專案名（或空）→ 沒有人寫內容，當全新檔重生
  const onlyTitle = stripped.split("\n").filter(l => l.trim()).every(l => /^#\s+\S/.test(l.trim()));
  if (!stripped || onlyTitle) return { userSection: "", specSection: "", aiSection: "", migrated: true };
  return { userSection: stripped, specSection: "", aiSection: "", migrated: true };
}

/** 合成整檔（2026-11-16 晚：User Remarks 區也移除 — Fleming；只剩 Product Spec） */
export function buildProjectMd(name, userSection, aiSection, specSection = "") {
  // userSection/aiSection 參數保留相容（忽略不寫）
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const L = [];
  L.push(`# ${name}`);
  L.push("");
  L.push(`> 📄 Product Spec · 上次更新 ${ts} · 人+AI 共寫`);
  L.push("");
  L.push(SPEC_START);
  L.push("## 📄 Product Spec");
  L.push("");
  L.push(specSection?.trim() || "（尚未撰寫 — 人跟 AI 在 Prod Spec 頁共寫；import 專案首次 CU 可生成初稿，或按 ✨）");
  L.push("");
  L.push(SPEC_END);
  L.push("");
  return L.join("\n");
}

/** 確定性事實層收集（來源：.paaw 產物 + package.json — 不掃 repo，零成本） */
async function collectFacts(root) {
  const paaw = createPaawProject(root);
  const readJson = async (rel) => {
    try { return JSON.parse((await paaw.readFile(rel)) || "null"); } catch { return null; }
  };
  // 2026-11-01 API-first：API features 來源 = coding.db api_features（feature map 退役）
  const { readApiFeatures } = await import("./coding-db/reads.mjs");
  const apiFeats = readApiFeatures(root) || [];
  const [ti, ec, ciSum] = await Promise.all([
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

  const features = apiFeats.map(a => ({ id: a.id, name: a.name, desc: a.description || "", codeFiles: (a.codeFiles || []).length, apis: 1 }));
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

/**
 * Product Spec 初稿（8 節 schema，evidence 優先）
 * 2026-11-16 Fleming：spec 做在 PROJECT.md / project page — import 專案首次（spec 空且有 code）
 * CU 收尾自動生一版；新專案（無 code）不生，留給人+AI 共寫。
 */
export async function generateSpecDraft(root, opts = {}) {
  const facts = await collectFacts(root);
  const hasCode = (facts.features?.length || 0) > 0 || (facts.codeIntel?.functions || 0) > 0 || (facts.codeIntel?.symbols || 0) > 0;
  if (!hasCode) return { generated: false, reason: "no-code", specSection: "" };

  const schemaNote = SPEC_SECTIONS.map(s => `## ${s}`).join("\n");
  let specSection = null;
  let source = "deterministic";
  if (opts.callLLM) {
    try {
      const prompt = `你是 release unit 的 spec 工程師。根據下方「事實資料」寫 PRODUCT Spec 初稿（code→spec 反向生成）。

嚴格規則：
- 只用事實資料，不捏造；資料沒有的寫「（資料待補 — 待人確認）」
- 固定八個二級標題照抄：
${schemaNote}
- 每節 3-8 條要點，简潔；API & Data Contract 從 features/API 事實寫
- 只輸出 markdown 本體：不包 \`\`\` 圍籬、不加 # 一級標題、無前言結語

事實資料（JSON）：
${JSON.stringify(facts, null, 2)}`;
      const r = await opts.callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.2, maxTokens: 8192, thinking: { type: "disabled" } });
      let c = r?.content?.trim() || "";
      if (c) {
        c = c.replace(/^```(?:markdown)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
        specSection = c;
        source = "llm";
      }
    } catch { /* fallback */ }
  }
  if (!specSection) {
    // 確定性 fallback：骨架 + 事實能填的填
    const L = [];
    L.push(`## 1. Product Overview`);
    L.push(facts.description ? `- ${facts.description}` : "- （資料待補 — 待人確認）");
    L.push("");
    L.push(`## 2. Functional Requirements`);
    if (facts.features.length) for (const f of facts.features.slice(0, 30)) L.push(`- [${f.id}] ${f.name}${f.desc ? " — " + f.desc.slice(0, 60) : ""}`);
    else L.push("- （資料待補 — 待人確認）");
    L.push("");
    for (const t of ["3. Non-Functional Requirements", "4. API & Data Contract", "5. Architecture Design", "6. Technical Design", "7. Testing Strategy", "8. Operations & Observability"]) {
      L.push(`## ${t}`);
      L.push("- （資料待補 — 待人確認）");
      L.push("");
    }
    if (facts.frameworks.length) L.splice(L.indexOf("## 5. Architecture Design") + 1, 0, `- 技術栈：${facts.frameworks.join(" / ")}`);
    if (facts.tests) { const i = L.indexOf("## 7. Testing Strategy"); if (i > -1) L.splice(i + 1, 0, `- 測試：${facts.tests.files} 檔，coverage ${facts.tests.coverage ?? "—"}`); }
    specSection = L.join("\n").trim();
  }
  return { generated: true, reason: "draft", specSection, source };
}

/**
 * 重生成 PROJECT.md（AI 區重寫、USER/SPEC 區原樣保留；import 首次 spec 空且 opts.specDraft 時生 spec 初稿）
 * @param {string} root project root
 * @param {{ callLLM?: Function, model?: string, specDraft?: boolean }} opts callLLM: coding.mjs callProjectLLM 同簽名
 * @returns {Promise<{written:boolean, reason:string, features:number, aiSource:"llm"|"deterministic", specDraft?:{generated:boolean, source:string}}>}
 */
export async function regenerateProjectMd(root, opts = {}) {
  const paaw = createPaawProject(root);
  const existing = await paaw.readFile("PROJECT.md");
  const parsed = parseProjectMd(existing);
  const facts = await collectFacts(root);

  // 2026-11-16 晚：AI Overview 區移除 — 不再生成；重點只剩 spec 初稿 + 檔案遷移

  // Spec 初稿：只在 spec 區空且明確要求（CU 收尾 import 場景 / 手動 ✨）時生
  let specSection = parsed.specSection || "";
  let specDraftInfo;
  if (!specSection && opts.specDraft) {
    const d = await generateSpecDraft(root, opts);
    specDraftInfo = { generated: d.generated, source: d.source };
    if (d.generated) specSection = d.specSection;
  }

  const next = buildProjectMd(facts.name, null, null, specSection);

  // diff-write：內容相同就不動檔案 mtime（git 友善）
  if (existing === next) return { written: false, reason: "identical", features: facts.features.length, specDraft: specDraftInfo };
  await paaw.writeFile("PROJECT.md", next);
  return {
    written: true,
    reason: existing ? (parsed.migrated ? "migrated" : "updated") : "created",
    features: facts.features.length,
    specDraft: specDraftInfo,
  };
}

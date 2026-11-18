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

/**
 * 每節各自的格式 schema（2026-11-18 Fleming 定調：像 GHS spec 的 FR 條目 — 簡單、清楚、人跟 AI 都好懂；不要過度設計）
 * 生成/寫入 prompt 與 spec_write tool 共用這份格式定義。
 */
export const SPEC_SECTION_SCHEMAS = [
  {
    n: 1, title: "Product Overview",
    format: `以條列呈現，固定五塊（沒有的寫「（待討論）」）：
- **定位**：一句話產品定位
- **目標**：
- **範圍內**：
- **範圍外**：
- **使用情境**：`,
  },
  {
    n: 2, title: "Functional Requirements",
    format: `每條需求一個單元，格式固定（GitHub GHS spec 同款）：

#### FR-01 — 短標題

**Requirement**

一小段需求描述。

**Acceptance Criteria**

- 驗收條件 1
- 驗收條件 2

**Business Rule**

- 業務規則（沒有可省略整塊）`,
  },
  {
    n: 3, title: "Non-Functional Requirements",
    format: `每條一個單元：

#### NFR-01 — Performance / Availability / Security / Scalability（擇一當標題）

**Requirement**

需求描述。

**Acceptance Criteria**

- 驗收條件`,
  },
  {
    n: 4, title: "API & Data Contract",
    format: `先一張總表（Endpoint | Method | 用途），再逐一：

#### API-01 — POST /path

- 用途：
- Request：（JSON 範例或 schema）
- Response：（JSON 範例或 schema）
- Error Codes：HTTP status + 意義（條列）`,
  },
  {
    n: 5, title: "Architecture Design",
    format: `四塊：
- **Components**：表格（Component | 職責）
- **Sequence**：mermaid sequenceDiagram（關鍵流程一張）
- **Integrations**：表格（From | To | Protocol/Format）
- **Data Flow**：條列或 mermaid flowchart`,
  },
  {
    n: 6, title: "Technical Design",
    format: `四塊：
- **技術選型**：表格（項目 | 選擇）
- **Modules**：表格（Module | 職責）
- **核心邏輯**：說明或 mermaid
- **關鍵決策**：表格（主題 | 決定 | 原因）`,
  },
  {
    n: 7, title: "Testing Strategy",
    format: `先一句測試目標，再一張測試案例表：

| ID | 類型 | 情境 | 預期結果 |

類型 = Unit / Integration / E2E / Failure / Load。`,
  },
  {
    n: 8, title: "Operations & Observability",
    format: `五塊：
- **Metrics**：表格（Metric | 用途）
- **Logging**：條列規則（含「不記什麼」）
- **Tracing**：一句話策略（可「暫不」）
- **Deployment**：部署方式條列
- **Alerting**：表格（Alert | 觸發條件）`,
  },
];

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
  return msgs.filter(m => (m.role === "user" || m.role === "assistant") && m.content).slice(-60);
}

const stripCodeFence = (c) => (c || "").replace(/^```(?:markdown)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

/** 共用：單節生成 prompt（帶各節 schema 格式 — 2026-11-18 Fleming） */
function buildSectionPrompt(index, transcript, facts, extra = "") {
  const schema = SPEC_SECTION_SCHEMAS[index];
  const title = SPEC_SECTIONS[index];
  return `你是林曉薇（Product Spec 協作助理）。根據下方「與人的討論紀錄（含人貼上的內容）」和「專案事實」，寫出 Product Spec 的其中一節。

目標 section：## ${title}

本節固定格式（照這個 schema 寫，不要自創結構）：
${schema.format}

嚴格規則：
- 人貼的內容/決定最優先，原汁原味收錄（可整理排版，不得改意思）；其次專案事實；都沒有的寫「（待討論）」
- 不得捏造事實；專案事實沒有的 API/feature 不要發明
- ID 編號（FR-01 等）延續遞增，不要重號
- 流程/架構/互動盡量附 mermaid 圖（mermaid 圍籬：flowchart / sequenceDiagram / stateDiagram-v2）
- 只輸出這一節的 markdown 本體：不加 ## 標題（外層會加）、不包 \`\`\` 圍籬、無前言結語${extra}
${transcript ? `
與人的討論紀錄（最新在後，可能含人貼上的規格內容）：
${transcript}` : "\n（尚無討論紀錄 — 依專案事實寫，沒有的寫待討論）"}

專案事實（JSON）：
${JSON.stringify(facts, null, 2)}`;
}

async function callAndStrip(callLLM, prompt) {
  const r = await callLLM({ messages: [{ role: "user", content: prompt }], temperature: 0.3, maxTokens: 8192, thinking: { type: "disabled" } });
  return stripCodeFence(r?.content);
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
  const transcript = conversation.map(m => `${m.role === "user" ? "人" : "曉薇"}: ${m.content}`).join("\n\n").slice(-24000);
  const content = await callAndStrip(opts.callLLM, buildSectionPrompt(index, transcript, facts));
  if (!content) return null;
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

/**
 * 一次填整份 spec（2026-11-18 Fleming：人把 project 內容貼給右邊曉薇 → 一鍵/AI 觸發填好全部 8 節）
 * 依據：side chat 對話（含人貼上的內容，取較長窗口）+ 專案事實；逐節生成（各節帶各自 schema），全成功才寫入。
 * @returns {{written:boolean, sections:number[], failed?:number[]}}
 */
export async function generateFullSpec(root, opts = {}) {
  if (!opts.callLLM) return { written: false, reason: "no-llm" };
  const paaw = createPaawProject(root);
  const [conversation, facts] = await Promise.all([readSpecAiConversation(paaw), collectFacts(root)]);
  const transcript = conversation.map(m => `${m.role === "user" ? "人" : "曉薇"}: ${m.content}`).join("\n\n").slice(-60000);
  const parts = new Array(8).fill("");
  const failed = [];
  for (let i = 0; i < 8; i++) {
    // 前一節結果帶入下一節 prompt，避免 ID 編號/内容重複（FR-01 起頭等）
    const prev = i > 0 && parts[i - 1] ? `\n\n（前一節 ${SPEC_SECTION_TITLES[i - 1]} 已寫内容，供參考保持一致、ID 不重號）：\n${parts[i - 1].slice(0, 2000)}` : "";
    try {
      const c = await callAndStrip(opts.callLLM, buildSectionPrompt(i, transcript, facts, prev));
      if (c) parts[i] = c; else failed.push(i + 1);
    } catch { failed.push(i + 1); }
  }
  if (failed.length === 8) return { written: false, reason: "all-failed", failed };
  // 失敠的節保留原内容（原本空就維持空）
  const existing = await paaw.readFile("PROJECT.md");
  const parsed = parseProjectMd(existing);
  const oldParts = splitSpecSections(parsed.specSection || "");
  for (let i = 0; i < 8; i++) if (!parts[i] && oldParts[i]) parts[i] = oldParts[i];
  let name = facts.name || root.split(/[\\/]/).pop() || "Project";
  await paaw.writeFile("PROJECT.md", buildProjectMd(name, null, null, joinSpecSections(parts)));
  return { written: true, sections: parts.map((p, i) => (p ? i + 1 : 0)).filter(Boolean), failed: failed.length ? failed : undefined };
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

  const schemas = SPEC_SECTION_SCHEMAS;
  let specSection = null;
  let source = "deterministic";
  if (opts.callLLM) {
    try {
      const schemaNote = schemas.map(s => `## ${SPEC_SECTIONS[s.n - 1]}\n格式：\n${s.format}`).join("\n\n");
      const prompt = `你是 release unit 的 spec 工程師。根據下方「事實資料」寫 PRODUCT Spec 初稿（code→spec 反向生成）。

嚴格規則：
- 只用事實資料，不捏造；資料沒有的寫「（資料待補 — 待人確認）」
- 固定八個二級標題照抄，每節照各自的格式 schema 寫：
${schemaNote}
- 不包 \`\`\` 圍籬、不加 # 一級標題、無前言結語

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

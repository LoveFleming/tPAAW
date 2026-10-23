/**
 * Coding Features Route — Feature-centric code understanding
 *
 * Endpoints:
 *   GET    /api/coding-features?path=...                    — List all features
 *   GET    /api/coding-features/:id?path=...                — Get single feature with full detail
 *   POST   /api/coding-features?path=...                    — Create feature
 *   PUT    /api/coding-features/:id?path=...                — Update feature
 *   DELETE /api/coding-features/:id?path=...                — Delete feature
 *   POST   /api/coding-features/:id/understand?path=...     — AI generate/update understanding for feature
 *   POST   /api/coding-features/:id/link-issue?path=...     — Link an issue to a feature
 *   POST   /api/coding-features/:id/unlink-issue?path=...   — Unlink an issue
 *   GET    /api/coding-features/stats?path=...              — Summary stats
 *   PUT    /api/coding-features/:id/docs?path=...           — Update feature documentation (markdown)
 */

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { walkSourceFiles } from "../lib/cu-source-scan.mjs";
import { isTestFile } from "../lib/code-graph.mjs";
import { fileURLToPath } from "url";
import { readBody, normalizePath } from "./shared.mjs";
import { resolveDefaultModel, dateTimeContextBlock } from "../lib/llm-utils.mjs";
import { callProjectLLM } from "./coding.mjs"; // 統一 LLM 咽喉：thinking 控制 + llm log 歸因 + 空回應診斷（2026-08-30）
import { DATA_HOME } from "../data-home.mjs";
import { nextFeatureId, inferFeatureType, touchFeature, ensureMiscFeature, featureExists } from "../lib/feature-registry.mjs";
import { scanFeatureRisk, isValidSeverity } from "../lib/feature-risk-scan.mjs";
import { stableStringify } from "../lib/stable-stringify.mjs";

function getMaxTokens(providerConfig, providerId, model) {
  const provider = providerConfig.providers?.[providerId];
  const models = provider?.models || [];
  for (const m of models) {
    if (typeof m === "object" && m.id === model) return m.maxTokens || 16384;
  }
  return 16384;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── Helpers ──

function parseQuery(rawUrl) {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx < 0) return {};
  const params = {};
  for (const part of rawUrl.slice(qIdx + 1).split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return params;
}

// genId replaced by feature-registry.nextFeatureId (F+YYYYMMDD+seq format)

function now() {
  return new Date().toISOString();
}

function getFeaturesDir(projectPath) {
  return join(projectPath, ".paaw", "features");
}

function getFeaturesFile(projectPath) {
  return join(getFeaturesDir(projectPath), "FEATURES.json");
}

// loadFeatures/saveFeatures: use feature-registry.mjs (single source of truth)
// Local helpers below delegate to the registry for backward compat
async function loadFeatures(projectPath) {
  const { loadFeatures: _lf } = await import("../lib/feature-registry.mjs");
  return _lf(projectPath);
}

async function saveFeatures(projectPath, features) {
  const { saveFeatures: _sf } = await import("../lib/feature-registry.mjs");
  _sf(projectPath, features);
}

// ── Load related data for feature detail ──

async function loadIssueSummaries(projectPath, issueIds) {
  const issuesFile = join(projectPath, ".paaw", "issues", "ISSUES.json");
  if (!existsSync(issuesFile) || !issueIds?.length) return [];
  try {
    const data = JSON.parse(readSync(issuesFile, "utf-8"));
    const allIssues = data.issues || [];
    return allIssues
      .filter(i => issueIds.includes(i.id))
      .map(i => ({ id: i.id, title: i.title, status: i.status, priority: i.priority }));
  } catch {
    return [];
  }
}

// ── LLM Call for AI Understanding ──

/** 決定論抽樣讀檔（2026-10-23）：每子群取首檔（進入點序）+ shared 前 3 檔，各截 maxChars */
async function _readSamples(projectPath, files, maxChars) {
  const out = [];
  for (const filePath of files) {
    const absPath = resolve(projectPath, filePath);
    if (existsSync(absPath)) {
      try {
        const content = await readFile(absPath, "utf-8");
        out.push(`### ${filePath}\n\`\`\`\n${content.slice(0, maxChars)}\n\`\`\``);
      } catch {}
    }
  }
  return out;
}

async function generateUnderstanding(projectPath, feature, providersFile, subKey = null) {
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch { return null; }
  const providerId = providerConfig.active || "zai";
  const model = resolveDefaultModel(providerConfig);
  const provider = providerConfig.providers?.[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") return null;

  const subs = Array.isArray(feature.subFeatures) ? feature.subFeatures : [];
  const sub = subKey ? subs.find(s => s.id === subKey || s.key === subKey || s.id === `${feature.id}-${subKey}`) : null;

  let prompt;
  let result;

  if (sub) {
    // ── per-sub 深讀（2026-10-23 ①）：子群檔案少（≤40），直接全讀 ──
    const codeSnippets = await _readSamples(projectPath, sub.codeFiles || [], 2500);
    const testSnippets = await _readSamples(projectPath, (feature.tests || []).slice(0, 5), 1200);
    prompt = `You are a senior code analyst. Analyze this SUB-FEATURE (stable sub-group inside a larger feature, split by deterministic stability consensus) and provide a comprehensive understanding.

## Parent Feature: ${feature.name}
${feature.description || ""}

## Sub-Feature: ${sub.name}（${sub.codeFiles?.length || 0} files, consensus ${(sub.evidence?.consensus ?? "?")}, key terms: ${(sub.evidence?.vocabTop || []).join(", ")}）
${sub.description || ""}

## Code Files (this sub-group)
${codeSnippets.join("\n\n") || "(no code files)"}

## Parent Tests (sample)
${testSnippets.join("\n\n") || "(no tests mapped)"}

Please provide (markdown, 繁體中文):
1. **Overview** — 這個子能力做什麼、為何存在
2. **Architecture** — 程式結構與關鍵模式
3. **Data Flow** — 資料怎麼流過這個子群
4. **Key Decisions** — 設計選擇與理由
5. **Risks** — 潛在問題、按衛生誠實標註信心（檔案截斷處標（推論））
6. **Dependencies** — 依賴誰、被誰依賴（含 parent 的 internalShared 角色）`;
    result = { store: "sub", sub };
  } else if (subs.length > 0 && !subKey) {
    // ── parent 複合理解（2026-10-23 ①：改吃子群摘要，不逐檔讀全清單）──
    // 每子群：機器摘要（名/描述/詞彙/檔數）+ 首檔抽樣；shared 取前 3 檔短摘
    const subSummaries = [];
    for (const s of subs) {
      const sample = await _readSamples(projectPath, (s.codeFiles || []).slice(0, 1), 1200);
      subSummaries.push(`### ${s.name}（${s.codeFiles?.length || 0} 檔，共識 ${s.evidence?.consensus ?? "?"}）
${s.description || "(no description)"}
Key terms: ${(s.evidence?.vocabTop || []).join(", ")}
Files: ${(s.codeFiles || []).slice(0, 8).join(", ")}${(s.codeFiles?.length || 0) > 8 ? ` …(+${s.codeFiles.length - 8})` : ""}${sample.length ? "\n" + sample[0] : ""}`);
    }
    const sharedSnippets = await _readSamples(projectPath, (feature.internalShared || []).slice(0, 3), 800);
    prompt = `You are a senior code analyst. Analyze this feature at the ARCHITECTURE level. It has been split by deterministic stability consensus into ${subs.length} stable sub-groups + ${(feature.internalShared || []).length} internal shared (bridge) files. Do NOT try to read every file — reason from the sub-group composition below.

## Feature: ${feature.name}
${feature.description || ""}

## Sub-Groups (machine-deterministic, each independently understood)
${subSummaries.join("\n\n")}

## Internal Shared / Bridge Files
${(feature.internalShared || []).slice(0, 15).join(", ") || "(none)"}
${sharedSnippets.join("\n\n")}

## API Endpoints
${(feature.apis || []).map(a => `- ${a.method} ${a.path} (${a.file})`).join("\n") || "(no APIs mapped)"}

## Tests (count)
${(feature.tests || []).length} mapped

Please provide (markdown, 繁體中文):
1. **Overview** — 這個 feature 整體做什麼、為何存在
2. **子群組成** — 每個子群的角色與彼此關係（用機器給的子群名；推論處標（推論））
3. **Architecture** — 子群如何協作（誰叫誰、shared 檔扮演什麼角色）
4. **Data Flow** — 請求/資料怎麼流過子群
5. **Risks & 治理** — 跨子群耦合、shared 檔風險
6. **Dependencies** — 對外依賴與被依賴
誠實標註：哪些判斷來自子群摘要而非逐檔閱讀。`;
    result = { store: "parent" };
  } else {
    // ── 原路徑：無子群的小 feature 直接全讀 ──
    const codeSnippets = [];
    for (const filePath of (feature.codeFiles || [])) {
      const absPath = resolve(projectPath, filePath);
      if (existsSync(absPath)) {
        try {
          const content = await readFile(absPath, "utf-8");
          codeSnippets.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
        } catch {}
      }
    }
    const testSnippets = [];
    for (const filePath of (feature.tests || [])) {
      const absPath = resolve(projectPath, filePath);
      if (existsSync(absPath)) {
        try {
          const content = await readFile(absPath, "utf-8");
          testSnippets.push(`### ${filePath}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``);
        } catch {}
      }
    }
    const runbookSnippets = [];
    for (const filePath of (feature.runbooks || [])) {
      const absPath = resolve(projectPath, filePath);
      if (existsSync(absPath)) {
        try {
          const content = await readFile(absPath, "utf-8");
          runbookSnippets.push(`### ${filePath}\n${content.slice(0, 1000)}`);
        } catch {}
      }
    }
    prompt = `You are a senior code analyst. Analyze the following feature and provide a comprehensive understanding.

## Feature: ${feature.name}
${feature.description || ""}

## Code Files
${codeSnippets.join("\n\n") || "(no code files mapped)"}

## Tests
${testSnippets.join("\n\n") || "(no tests mapped)"}

## Runbooks
${runbookSnippets.join("\n\n") || "(no runbooks mapped)"}

## API Endpoints
${(feature.apis || []).map(a => `- ${a.method} ${a.path} (${a.file})`).join("\n") || "(no APIs mapped)"}

Please provide:
1. **Overview** — What this feature does and why it exists
2. **Architecture** — How the code is structured, key patterns used
3. **Data Flow** — How data moves through this feature (request → response)
4. **Key Decisions** — Important design choices and their rationale
5. **Test Coverage** — What's tested, what's missing
6. **Known Risks** — Potential issues, tech debt, security concerns
7. **Dependencies** — What this feature depends on and what depends on it

Write in clear, concise markdown. Use the project's context if available.`;
    result = { store: "parent" };
  }

  try {
    // 2026-08-30：統一走 callProjectLLM（thinking off + llm log 歸因 + 空回應診斷）
    const data = await callProjectLLM({
      model,
      messages: [
        { role: "system", content: dateTimeContextBlock() + "\nYou are a senior code analyst. Provide clear, actionable code understanding in markdown." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 3000,
      thinking: { type: "disabled" },
    }, { caller: "features", agentId: "features" });
    return data.content || null;
  } catch {
    return null;
  }
}

// ── LLM Call for Severity Suggestion（2026-10-10：事實靠掃描，LLM 只推理嚴重度）──

async function suggestSeverity(feature, scan, providersFile) {
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch { return null; }
  const providerId = providerConfig.active || "zai";
  const model = resolveDefaultModel(providerConfig);
  const provider = providerConfig.providers?.[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") return null;

  const profile = [
    `### 資料異動（deterministic 掃描）`,
    scan.dataTouch.length
      ? scan.dataTouch.map(d => `- ${d.target}：${d.ops.join("/")}`).join("\n")
      : "- （無偵測到 SQL 異動）",
    scan.migration ? "- ⚠ 含 schema migration / DDL" : "",
    scan.mutatingOutbound ? "- ⚠ 含對外 mutating 呼叫（POST/PUT/PATCH/DELETE）" : "",
    `### API 介面`,
    scan.apiSurface.length ? scan.apiSurface.slice(0, 30).map(p => `- ${p}`).join("\n") : "- （無）",
    `### 外部服務`,
    scan.externalCalls.length ? scan.externalCalls.slice(0, 20).map(h => `- ${h}`).join("\n") : "- （無）",
    `### 規則掃描結果`,
    `${scan.computedSeverity}（${scan.computedReason}）`,
  ].filter(Boolean).join("\n");

  const prompt = `你是軟體風險分析師。根據以下 feature 的構成面事實，建議它的變更嚴重度。

## Feature: ${feature.name}
${feature.description || ""}

${profile}

嚴重度定義：
- S0 🟢 低風險：純讀取/UI/config，做壞了影響小且可快速修復
- S1 🟡 中風險：新增資料（INSERT）或對外 mutating 呼叫，做壞了產生髒資料但可清理
- S2 🔴 高風險：修改/刪除資料（UPDATE/DELETE）、schema migration、觸及 PII/金流，做壞了難以回滚

規則掃描已給出 baseline。你可以根據語意上下升級（例如：SELECT 但讀的是 PII 且外傳、外部服務是金流），但必須給理由；不確定時沿用 baseline。

只回覆 JSON（不要 markdown code fence）：{"severity":"S0|S1|S2","reason":"一句話理由","notes":"補充（可空）"}`;

  try {
    const data = await callProjectLLM({
      model,
      messages: [
        { role: "system", content: dateTimeContextBlock() + "\nYou are a risk analyst. Reply with strict JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 500,
      thinking: { type: "disabled" },
    }, { caller: "features-risk", agentId: "features" });
    const raw = (data.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!isValidSeverity(parsed.severity)) return null;
    return { severity: parsed.severity, reason: String(parsed.reason || scan.computedReason).slice(0, 300), notes: String(parsed.notes || "").slice(0, 200) };
  } catch {
    return null;
  }
}

// ── Route Handler ──

export default async function codingFeaturesRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  if (!url.startsWith("/api/coding-features")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const projRoot = resolve(projectPath); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
  const providersFile = join(DATA_HOME, "config", "providers.json");

  // ── GET /api/coding-features/file-map ──
  if (url === "/api/coding-features/file-map" && method === "GET") {
    const fileMapPath = join(getFeaturesDir(projRoot), "FILE-FEATURES.json"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    if (!existsSync(fileMapPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "FILE-FEATURES.json not found — run Code Understanding first" }));
      return true;
    }
    try {
      const data = JSON.parse(await readFile(fileMapPath, "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to parse FILE-FEATURES.json" }));
    }
    return true;
  }

  // ── GET /api/coding-features/validate — Layer 3 validation ──
  if (url === "/api/coding-features/validate" && method === "GET") {
    try {
      const { runFullValidation } = await import("../lib/feature-map-validator.mjs");
      const result = await runFullValidation(projRoot);
      res.writeHead(result.ok ? 200 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/coding-features/stats ──
  if (url === "/api/coding-features/stats" && method === "GET") {
    const features = await loadFeatures(projRoot);
    const stats = {
      total: features.length,
      active: features.filter(f => f.status === "active").length,
      deprecated: features.filter(f => f.status === "deprecated").length,
      byType: {
        frontend: features.filter(f => f.type === "frontend").length,
        backend: features.filter(f => f.type === "backend").length,
        mixed: features.filter(f => !f.type).length,
      },
      withUnderstanding: features.filter(f => f.aiUnderstanding).length,
      withTests: features.filter(f => (f.tests || []).length > 0).length,
      withIssues: features.filter(f => (f.issues || []).length > 0).length,
      totalCodeFiles: features.reduce((sum, f) => sum + (f.codeFiles || []).length, 0),
      totalApis: features.reduce((sum, f) => sum + (f.apis || []).length, 0),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return true;
  }

  // ── POST /api/coding-features/:id/risk-profile — 構成面掃描 + AI 嚴重度建議（2026-10-10）──
  const riskMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/risk-profile$/);
  if (riskMatch && method === "POST") {
    const id = decodeURIComponent(riskMatch[1]);
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { body = {}; }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const feature = features[idx];
    const scan = await scanFeatureRisk(projRoot, feature);
    feature.riskProfile = scan;
    feature.riskProfileScannedAt = now();
    feature.severityComputed = scan.computedSeverity;

    let suggestedBy = "scan";
    if (body.ai !== false) {
      const ai = await suggestSeverity(feature, scan, providersFile);
      if (ai) {
        feature.severitySuggested = ai.severity;
        feature.severitySuggestedReason = ai.reason;
        feature.severitySuggestedNotes = ai.notes || "";
        feature.severitySuggestedBy = "ai";
        suggestedBy = "ai";
      } else {
        feature.severitySuggested = scan.computedSeverity;
        feature.severitySuggestedReason = scan.computedReason;
        feature.severitySuggestedNotes = "";
        feature.severitySuggestedBy = "scan";
      }
      feature.severitySuggestedAt = now();
    }
    feature.updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, suggestedBy, feature }));
    return true;
  }

  // ── PUT /api/coding-features/:id/severity — 新增人員判定（append-only，2026-10-10 18:18 Fleming：並存）──
  // 人跟 AI 的判定並存：AI 判定在 severitySuggested；人的每次判定（by/severity/remark）
  // append 進 severityDecisions 永不覆蓋 — 生效值 = 最新人判定 || AI 判定 || 即時掃描（release-evidence 三層）
  const sevMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/severity$/);
  if (sevMatch && method === "PUT") {
    const id = decodeURIComponent(sevMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    if (!isValidSeverity(body.severity)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "severity must be one of: S0, S1, S2" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const decisions = features[idx].severityDecisions || [];
    decisions.push({
      id: `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      by: String(body.by || "human").slice(0, 40),
      at: now(),
      severity: body.severity,
      remark: String(body.remark || "").slice(0, 300),
    });
    features[idx].severityDecisions = decisions.slice(-50); // cap 50 防爆
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── DELETE /api/coding-features/:id/severity-decision/:did — 刪單筆判定（寫錯移除）──
  const delSevMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/severity-decision\/([^/?]+)$/);
  if (delSevMatch && method === "DELETE") {
    const id = decodeURIComponent(delSevMatch[1]);
    const did = decodeURIComponent(delSevMatch[2]);
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const before = features[idx].severityDecisions?.length || 0;
    features[idx].severityDecisions = (features[idx].severityDecisions || []).filter(d => d.id !== did);
    if (features[idx].severityDecisions.length === before) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Decision not found" }));
      return true;
    }
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── POST /api/coding-features/:id/understand（?sub=<subKey> = 只理解那個子群，2026-10-23 ①）──
  const understandMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/understand$/);
  if (understandMatch && method === "POST") {
    const id = decodeURIComponent(understandMatch[1]);
    const subKey = q.sub || null;
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const understanding = await generateUnderstanding(projRoot, features[idx], providersFile, subKey);
    if (understanding) {
      let storedOn = "feature";
      if (subKey) {
        const sub = (features[idx].subFeatures || []).find(s => s.id === subKey || s.key === subKey || s.id === `${features[idx].id}-${subKey}`);
        if (sub) {
          sub.aiUnderstanding = understanding;
          sub.aiUnderstandingAt = now();
          storedOn = `sub:${sub.id}`;
        } else subKey = null; // 找不到子群 → 退回 parent
      }
      if (!subKey) {
        features[idx].aiUnderstanding = understanding;
        features[idx].aiUnderstandingAt = now();
      }
      features[idx].updatedAt = now();
      await saveFeatures(projRoot, features);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(stableStringify({ ok: true, understanding, storedOn, feature: features[idx] }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: false, error: "understanding generation failed" }));
    return true;
  }

  // ── POST /api/coding-features/:id/link-issue ──
  const linkMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/link-issue$/);
  if (linkMatch && method === "POST") {
    const id = decodeURIComponent(linkMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    if (!features[idx].issues) features[idx].issues = [];
    if (!features[idx].issues.includes(body.issueId)) {
      features[idx].issues.push(body.issueId);
      features[idx].updatedAt = now();
      await saveFeatures(projRoot, features);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── POST /api/coding-features/:id/unlink-issue ──
  const unlinkMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/unlink-issue$/);
  if (unlinkMatch && method === "POST") {
    const id = decodeURIComponent(unlinkMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    features[idx].issues = (features[idx].issues || []).filter(i => i !== body.issueId);
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── PUT /api/coding-features/:id/docs ──
  const docsMatch = url.match(/^\/api\/coding-features\/([^/?]+)\/docs$/);
  if (docsMatch && method === "PUT") {
    const id = decodeURIComponent(docsMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    features[idx].documentation = body.documentation || "";
    features[idx].docsUpdatedAt = now();
    features[idx].updatedAt = now();
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, feature: features[idx] }));
    return true;
  }

  // ── GET /api/coding-features/:id ──
  const singleMatch = url.match(/^\/api\/coding-features\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const id = decodeURIComponent(singleMatch[1]);
    const features = await loadFeatures(projRoot);
    const feature = features.find(f => f.id === id);
    if (!feature) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    // Enrich with issue summaries
    const issueSummaries = await loadIssueSummaries(projRoot, feature.issues || []);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...feature, _issueSummaries: issueSummaries }));
    return true;
  }

  // ── PUT /api/coding-features/:id (update) ──
  if (singleMatch && method === "PUT") {
    const id = decodeURIComponent(singleMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    // If codeFiles changed and no explicit type, re-infer
    if (body.codeFiles && !body.type) {
      body.type = inferFeatureType(body.codeFiles);
    }
    const updated = {
      ...features[idx],
      ...body,
      id: features[idx].id,
      updatedAt: now(),
    };
    features[idx] = updated;
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // ── DELETE /api/coding-features/:id ──
  if (singleMatch && method === "DELETE") {
    const id = decodeURIComponent(singleMatch[1]);
    const features = await loadFeatures(projRoot);
    const idx = features.findIndex(f => f.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Feature not found" }));
      return true;
    }
    const deleted = features.splice(idx, 1)[0];
    await saveFeatures(projRoot, features);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return true;
  }

  // ── GET /api/coding-features (list) ──
  if (url === "/api/coding-features" && method === "GET") {
    let features = await loadFeatures(projRoot);
    console.log(`[coding-features] GET list: projRoot=${projRoot}, loaded=${features.length}, file=${getFeaturesFile(projRoot)}, exists=${existsSync(getFeaturesFile(projRoot))}`); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    // Filter
    if (q.status) {
      features = features.filter(f => f.status === q.status);
    }
    if (q.type) {
      features = features.filter(f => (f.type || "") === q.type);
    }
    if (q.search) {
      const s = q.search.toLowerCase();
      features = features.filter(f =>
        f.name?.toLowerCase().includes(s) ||
        f.description?.toLowerCase().includes(s) ||
        f.id?.toLowerCase().includes(s)
      );
    }
    // Sort by updatedAt desc (most recently active first)
    features.sort((a, b) => {
      const aT = a.updatedAt || a.createdAt || "";
      const bT = b.updatedAt || b.createdAt || "";
      return bT.localeCompare(aT);
    });
    // Attach issue summaries (lightweight)
    const enriched = await Promise.all(features.map(async f => {
      const issueSummaries = await loadIssueSummaries(projRoot, f.issues || []);
      return { ...f, _issueSummaries: issueSummaries };
    }));
    res.writeHead(200, { "Content-Type": "application/json", "X-Features-Path": getFeaturesFile(projRoot), "X-Features-Count": String(enriched.length), "X-Features-Exists": String(existsSync(getFeaturesFile(projRoot))) }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    res.end(JSON.stringify({ features: enriched }));
    return true;
  }

  // ── POST /api/coding-features (create) ──
  if (url === "/api/coding-features" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    if (!body.name?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Name is required" }));
      return true;
    }
    const features = await loadFeatures(projRoot);
    const newFeature = {
      id: nextFeatureId(projRoot),
      name: body.name.trim(),
      description: body.description || "",
      status: body.status || "active",
      type: body.type || inferFeatureType(body.codeFiles || []),
      codeFiles: body.codeFiles || [],
      apis: body.apis || [],
      tests: body.tests || [],
      runbooks: body.runbooks || [],
      issues: body.issues || [],
      tags: body.tags || [],
      aiUnderstanding: "",
      aiUnderstandingAt: null,
      documentation: "",
      docsUpdatedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    features.push(newFeature);
    await saveFeatures(projRoot, features);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newFeature));
    return true;
  }

  // ── POST /api/coding-features/refresh-mapping — AI re-scan & update all feature mappings ──
  if (url === "/api/coding-features/refresh-mapping" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const features = await loadFeatures(projRoot);
    if (features.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No features to update. Run Code Understanding first." }));
      return true;
    }

    // Load provider config
    let providerConfig;
    try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Provider config not found" }));
      return true;
    }
    const providerId = providerConfig.active || "zai";
    const model = resolveDefaultModel(providerConfig);
    const provider = providerConfig.providers?.[providerId];
    if (!provider?.apiKey || provider.apiKey === "na") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No AI provider configured" }));
      return true;
    }

    // Scan codebase: list all source files
    // 2026-09-06：改共用 walker（cu-source-scan）— 支援 .gitignore、刪掉 shell find 雙分支
    // 2026-09-06：測試檔分流（isTestFile）— 測試不是 feature 的 code，只進 tests 欄位（與 CU 決定論分流一致）
    const _walked = walkSourceFiles(projRoot, { exts: new Set([".ts", ".tsx", ".mjs", ".js", ".jsx"]) });
    const allFiles = _walked.files.filter(f => !isTestFile(f));
    const testFiles = _walked.files.filter(isTestFile);

    // Read API contract if exists
    let apiContract = "";
    const apiSpecFile = join(projRoot, ".paaw", "specs", "api-contract.md"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    if (existsSync(apiSpecFile)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      try { apiContract = (await readFile(apiSpecFile, "utf-8")).slice(0, 3000); } catch {} // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    }

    const prompt = `You are a code analyst. Update the file mappings for existing features based on the current codebase.

## Current Features
${stableStringify(features.map(f => ({ id: f.id, name: f.name, description: f.description, currentCodeFiles: f.codeFiles, currentApis: f.apis, currentTests: f.tests, currentRunbooks: f.runbooks })))}

## All Source Files in Codebase (production code only)
${allFiles.join("\n")}

## Test Files (tests are NOT feature code — only map them into the \`tests\` field, never \`codeFiles\`)
${testFiles.length ? testFiles.join("\n") : "(none)"}

## API Contract
${apiContract || "(not available)"}

## Task
For EACH feature, review its current file mappings and update them based on what files actually exist now.

Rules:
1. If files were renamed/moved, update the paths
2. If new files belong to this feature, add them
3. If mapped files no longer exist, remove them
4. Check API endpoints — add new ones, remove deleted ones
5. Check test files — add new ones, remove deleted ones
6. Check runbooks — same
7. Do NOT change feature id, name, description, or status
8. Do NOT invent files that don't exist in the file lists above
9. Test files (list above) go ONLY into the tests field — never into codeFiles

Output a JSON array with updated mappings. Each element:
{ "id": "F20260904-001", "codeFiles": [...], "apis": [{"method":"GET","path":"/api/x","file":"src/x.mjs"}], "tests": [...], "runbooks": [...] }

Output ONLY the JSON array, no markdown fences.`;

    try {
      // 2026-08-30：direct fetch → callProjectLLM（統一咽喉）
      // 原問題：自己 fetch 不進 llm log（LlmLogTab 看不到）、thinking 預設全開燒輸出額度、無空回應診斷
      // 大輸出任務（全部 features 的 mapping JSON）— thinking off + 10min timeout + 歸因 caller=features
      const llmData = await callProjectLLM({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        thinking: { type: "disabled" },
      }, { caller: "features", agentId: "features", timeoutMs: 600_000, maxRetries: 2 });
      const content = llmData.content || "";
      const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
      if (!cleanJson) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AI 回應為空，無法更新 Feature Map。請重新執行。" }));
        return true;
      }
      let updates;
      try {
        updates = JSON.parse(cleanJson);
      } catch (parseErr) {
        // Recovery: find last complete object (AI output may be truncated)
        let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
        for (let i = 0; i < cleanJson.length; i++) {
          const c = cleanJson[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') braceCount++;
          if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
        }
        if (lastComplete === 0) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI refresh failed: no valid JSON in response (${parseErr.message})` }));
          return true;
        }
        const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
        try {
          updates = JSON.parse(recovered);
        } catch (recoverErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI refresh failed: truncated JSON (parse: ${parseErr.message}, recovery: ${recoverErr.message})` }));
          return true;
        }
      }

      if (!Array.isArray(updates)) throw new Error("AI did not return an array");

      // Apply updates
      let updatedCount = 0;
      for (const upd of updates) {
        const idx = features.findIndex(f => f.id === upd.id);
        if (idx < 0) continue;
        if (upd.codeFiles) features[idx].codeFiles = upd.codeFiles;
        if (upd.apis) features[idx].apis = upd.apis;
        if (upd.tests) features[idx].tests = upd.tests;
        if (upd.runbooks) features[idx].runbooks = upd.runbooks;
        features[idx].updatedAt = now();
        updatedCount++;
      }
      await saveFeatures(projRoot, features);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, updated: updatedCount, total: features.length, features }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `AI refresh failed: ${err.message}` }));
    }
    return true;
  }

  // ── POST /api/coding-features/discover — AI discovers new features from orphan files ──
  if (url === "/api/coding-features/discover" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const features = await loadFeatures(projRoot);

    // Load provider config
    let providerConfig;
    try { providerConfig = JSON.parse(readSync(providersFile, "utf-8")); } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Provider config not found" }));
      return true;
    }
    const providerId = providerConfig.active || "zai";
    const model = body.model || resolveDefaultModel(providerConfig);
    const provider = providerConfig.providers?.[providerId];
    if (!provider?.apiKey || provider.apiKey === "na") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No AI provider configured" }));
      return true;
    }

    // Find orphan files using L3 validator
    const { checkCoverage, scanAllSourceFiles } = await import("../lib/feature-map-validator.mjs");
    const coverage = checkCoverage(projRoot, features);
    const orphans = coverage.orphans;

    if (orphans.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "No orphan files — all source files are mapped", created: 0 }));
      return true;
    }

    // Get existing feature names so AI doesn't duplicate
    const existingNames = features.map(f => ({ id: f.id, name: f.name, description: f.description }));
    const { nextFeatureId } = await import("../lib/feature-registry.mjs");
    const nextId = nextFeatureId(projRoot); // 2026-09-05：正式 ID 格式（原第 5 處 F-001 硬編碼）

    const prompt = `You are a software architect analyzing unmapped source files in a codebase.

## Existing Features (DO NOT duplicate these)
${stableStringify(existingNames)}

## Unmapped Source Files (${orphans.length} files)
${orphans.join("\n")}

## Task
Group these unmapped files into NEW features. Each feature should be a coherent functional unit.

Rules:
1. Group files that work together into the same feature
2. Give each feature a clear name and 1-sentence description
3. DO NOT create a feature that overlaps with existing features
4. Small related files can share a feature
5. Don't over-split — prefer fewer features with more files over many tiny features
6. Config files, utils, and shared types can be grouped as "Shared Infrastructure"
7. Every unmapped file MUST appear in exactly one new feature

Output a JSON array of new features:
[
  {
    "name": "Feature Name",
    "description": "What this feature does",
    "codeFiles": ["path/to/file.ts", ...],
    "tests": ["path/to/test.ts", ...],
    "tags": ["tag1", "tag2"]
  }
]

Output ONLY the JSON array, no markdown fences.`;

    try {
      // 2026-08-30 同 refresh-mapping：走 callProjectLLM 統一咽喉（thinking off + llm log 歸因）
      const llmData = await callProjectLLM({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        thinking: { type: "disabled" },
      }, { caller: "features", agentId: "features", timeoutMs: 600_000, maxRetries: 2 });
      const content = llmData.content || "";
      const cleanJson = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

      if (!cleanJson) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "AI 回應為空" }));
        return true;
      }

      let newFeatures;
      try {
        newFeatures = JSON.parse(cleanJson);
      } catch (parseErr) {
        // Recovery: find last complete object
        let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
        for (let i = 0; i < cleanJson.length; i++) {
          const c = cleanJson[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') braceCount++;
          if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
        }
        if (lastComplete === 0) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI discovery failed: no valid JSON (${parseErr.message})` }));
          return true;
        }
        const recovered = cleanJson.substring(0, lastComplete + 1).trim() + '\n]';
        try {
          newFeatures = JSON.parse(recovered);
        } catch (recoverErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `AI discovery failed: truncated JSON (${recoverErr.message})` }));
          return true;
        }
      }

      if (!Array.isArray(newFeatures)) throw new Error("AI did not return an array");

      // Create new features
      let createdCount = 0;
      const allFiles = new Set(scanAllSourceFiles(projRoot));
      for (const nf of newFeatures) {
        // Validate: all codeFiles must exist on disk (L3 check before writing!)
        const validFiles = (nf.codeFiles || []).filter(f => {
          const norm = f.replace(/^\.\//, "").replace(/\\/g, "/");
          return allFiles.has(norm);
        });
        const validTests = (nf.tests || []).filter(f => {
          const norm = f.replace(/^\.\//, "").replace(/\\/g, "/");
          return allFiles.has(norm);
        });

        const fid = nextFeatureId(projRoot);
        features.push({
          id: fid,
          name: nf.name || "Unnamed Feature",
          description: nf.description || "",
          status: "active",
          type: inferFeatureType(validFiles),
          codeFiles: validFiles,
          apis: [],
          tests: validTests,
          runbooks: [],
          issues: [],
          tags: nf.tags || [],
          aiUnderstanding: "",
          aiUnderstandingAt: null,
          documentation: "",
          docsUpdatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });
        createdCount++;
      }

      await saveFeatures(projRoot, features);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, created: createdCount, totalFeatures: features.length, orphansBefore: orphans.length, features: newFeatures }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `AI discovery failed: ${err.message}` }));
    }
    return true;
  }

  return false;
}

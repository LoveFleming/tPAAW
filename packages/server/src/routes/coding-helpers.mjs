// coding-helpers.mjs — 2026-11-07 從 routes/coding.mjs 機械抽取（不改行為）
// 共用 helpers：CU log / diff write / sanitize / skill 綁定 / query / JSON 抽取 / manifest
import { readFile, writeFile, readdir, mkdir, unlink, appendFile, stat as fsStat } from "fs/promises";
import { existsSync, readFileSync as readSync, readdirSync, statSync, openSync, readSync as fsReadSync, closeSync as fsCloseSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "../lib/shell-exec.mjs";
import { createPaawProject, maybeWriteProjectDraft } from "../lib/paaw-project.mjs";
import { parseProjectMd, buildProjectMd, regenerateProjectMd, USER_START, USER_END, AI_START, AI_END } from "../lib/project-md.mjs";
import { callLLMWithRetry, dateTimeContextBlock, parseModelReference } from "../lib/llm-utils.mjs";
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";
import { parseProject, formatForAI, formatCondensed } from "../lib/tree-sitter-parser.mjs";
import { runSemgrep } from "../lib/semgrep-runner.mjs";
import { buildCodeIntelligence, buildContextPackage } from "../lib/code-intelligence.mjs";
import { buildTestIntelligence } from "../lib/test-intelligence.mjs";
import { buildChangeIntelligence } from "../lib/change-intelligence.mjs";
import { rescanMechanicalLayer } from "../lib/cu-mechanical.mjs";
import { countSourceFiles, walkSourceFiles, changedSourceFilesSince } from "../lib/cu-source-scan.mjs";
import { appendFileSync, existsSync as existsSyncSync, mkdirSync } from "fs";
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { SECURITY_RULES } from "../lib/security-rules.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { runningCodingAgents } from "../lib/running-agents.mjs";
import { DATA_HOME, LOG_HOME, logSlug } from "../data-home.mjs";

function cuLog(step, msg) {
  const line = `[${new Date().toISOString()}] [CU] step=${step} ${msg}\n`;
  console.log(line.trim());
  try {
    mkdirSync(LOG_HOME, { recursive: true });
    appendFileSync(join(LOG_HOME, "cu-debug.log"), line);
  } catch {}
}

/** Diff-aware write: only overwrite if content has meaningful changes.
 *  Returns true if written (changed), false if skipped (no real diff). */
async function diffWriteFile(paaw, filename, newContent) {
  const old = await paaw.readFile(filename).catch(() => null);
  if (old !== null && old === newContent) {
    cuLog("diffWrite", `${filename}: identical, skipped`);
    return false;
  }
  // Compare meaningful lines — ignore whitespace-only diffs and timestamp lines
  if (old !== null) {
    const oldLines = old.split("\n").filter(l => l.trim() && !l.match(/^>\s*\*Last\s+updated/i) && !l.match(/^>\s*\*Updated/i));
    const newLines = newContent.split("\n").filter(l => l.trim() && !l.match(/^>\s*\*Last\s+updated/i) && !l.match(/^>\s*\*Updated/i));
    const oldNorm = oldLines.map(l => l.trim()).join("\n");
    const newNorm = newLines.map(l => l.trim()).join("\n");
    if (oldNorm === newNorm) {
      cuLog("diffWrite", `${filename}: no meaningful diff, skipped`);
      return false;
    }
    const diffLines = newLines.filter((l, i) => !oldLines[i] || l.trim() !== oldLines[i].trim()).length;
    const pct = Math.round(diffLines / Math.max(newLines.length, 1) * 100);
    cuLog("diffWrite", `${filename}: ${diffLines} lines changed (${pct}%), writing`);
  } else {
    cuLog("diffWrite", `${filename}: new file, writing`);
  }
  await paaw.writeFile(filename, newContent);
  return true;
}

/** Sanitize LLM-produced markdown before saving to .paaw/ — prevents frontend render crashes */
function _stripCodeFence(text) {
  // LLM 偶爾把 JSON 輸出用 ```json 圍籬包住（2026-11-05 learning-space scan.json 實例）
  // → JSON.parse 失敗 → features 匯入 0 筆 → Evidence Matrix 全空。寫 JSON 產出檔前一律剝圍籬。
  const m = text.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```\s*$/);
  return m ? m[1] : text;
}
function _sanitizeMd(md) {
  if (!md || typeof md !== "string") return md || "";
  let out = md;
  // 1. Auto-close unclosed code fences
  const fenceCount = (out.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) out += "\n```";
  // 2. Remove null bytes / control chars that break parsers
  out = out.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  // 3. Remove raw <script> tags (security + parser crash)
  out = out.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  // 4. Trim trailing whitespace per line (trailing spaces break some markdown parsers)
  out = out.split("\n").map(l => l.replace(/\s+$/, "")).join("\n");
  return out;
}

// Shared agent rules
// ── Running agent tracking (for busy check + interrupt) ──
// ── LLM Call Helper for project routes ──
// Resolves provider config and calls LLM with proper 4-arg signature
// CU 智能層/知識產出 LLM 呼叫統一參數（2026-08-30）
// maxTokens 不 hardcode — 由 providers.json 的 model.maxTokens 當事實來源（全升 32768）
// temperature：程式/結構化產出 = 0（deterministic），對話型 = 0.3
// caller em：這批呼叫屬 EM dashboard 的 AI 初始化/知識建構流 — 成本歸集（R3）別記在 coding 帳上
export const CU_LLM_OPTS = { caller: "em", agentId: "em" };

// ── CU step skill 外掛（2026-09-03 Fleming：CU 綁定 PAAW 的 skill）──
// 綁定存在專案 .paaw/crew.json 的 skillBindings["cu.<stepId>"]，跟 crew agent 同一套
// skill 內容由 project-crew.readSkillContent 讀 physical-skill/input-prompt/building 的 SKILL.md
function cuStepSkillKey(stepId) { return `cu.${stepId}`; }

async function loadCuStepSkills(root, stepId) {
  try {
    const { readProjectSkills } = await import("../lib/project-crew.mjs");
    return readProjectSkills(root, cuStepSkillKey(stepId)) || [];
  } catch { return []; }
}

export async function callProjectLLM(body, opts = {}) {
  // providers.json lives at {DATA_HOME}/config/providers.json
  // (PAAW_DATA_HOME env > repo data/ — gateway 版 data 在 HOME/data)
  const providersFile = join(DATA_HOME, "config", "providers.json");
  let providerConfig;
  try { providerConfig = JSON.parse(readSync(providersFile, "utf8")); } catch { return { content: null }; }
  // Parse "providerId/modelId" format (from ModelSelector) — 與 paaw-agent-loop resolveLLMConfig 同邏輯
  // 2026-09-14 fix：改用 parseModelReference — model id 自帶 provider prefix（如 anthropic/claude-opus-4.8）
  // 不再被 first-slash 剝過頭直送 API 400 (unknown model)
  let providerId = providerConfig.active || "zai";
  let model = body.model || resolveDefaultModel(providerConfig);
  ({ providerId, model } = parseModelReference(providerConfig, model));
  const provider = providerConfig.providers[providerId];
  if (!provider?.apiKey || provider.apiKey === "na") { return { content: null }; }

  // Resolve maxTokens: caller override > model config in providers.json > 32768
  const modelConfig = (provider.models || []).find(m => m.id === model);
  const defaultMaxTokens = modelConfig?.maxTokens || providerConfig.defaultMaxTokens || 65536;
  const maxTokens = body.maxTokens ?? defaultMaxTokens;

  const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
  };
  const reqBody = {
    model,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    max_tokens: maxTokens,
  };
  // thinking 控制（zai GLM 格式；其他 provider 不帶免得 fallback/格式不符）
  // 2026-08-30 教訓：CU feature-map 29k-token prompt + thinking 默認全開 →
  // reasoning 烒光 16k max_tokens（reasoning_tokens=15989）→ content 空 × 4 次（finish=length）
  if (body.thinking && providerId === "zai") {
    reqBody.thinking = body.thinking;
  }
  return callLLMWithRetry(apiUrl, headers, reqBody, {
    maxRetries: opts.maxRetries ?? 3,
    timeoutMs: opts.timeoutMs ?? 300_000,
    validateContent: true,
    sanitize: true,
    // 2026-10-23：caller 要求 thinking disabled（CU 結構化命名）→ 一併對 openrouter 注入
    // reasoning:{enabled:false}。否則 openrouter/deepseek 會把 token 燒在 reasoning 回空 content
    // （portkey CU 實測 0 字 × 多輪 → 命名降級）。
    disableThinking: !!(body.thinking || body.disableThinking),
    caller: opts.caller || "coding",
    agentId: opts.agentId || "coding",
    // 2026-09-03 fix：caller 沒傳 fallbacks 時，自動用 resolveLLMConfig 的 chain（providers.json fallbacks / auto）
    // 否則 zai 429 時 CU 各步驟直接報錯，不會轉 DeepSeek
    fallbacks: opts.fallbacks?.length ? opts.fallbacks
      : (await import("../lib/paaw-agent-loop.mjs")).resolveLLMConfig(null).fallbacks || [],
  });
}

// ── Query parser ──


function parseQuery(url) {
  const u = new URL(url, "http://localhost");
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// ── Route Handler ──

// ── CU 共用 helpers（2026-11-02 修正：原宣告在 ai-initial-step 單步 route 的 block 內 →
// block-scoped function declaration，bulk ai-initial 路徑看不到 → "X is not defined"。搬到 module top-level）──
// 2026-11-01 API-first：LLM JSON array 解析（code fence 剝除 + 截斷修復）
function _extractJsonArray(text) {
  if (Array.isArray(text)) return text;
  const raw = String(text || "").replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  if (!raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch {}
  // 取第一個 [ 起；結尾有 ] 用它，沒有（截斷）就取到尾
  const i = raw.indexOf("[");
  if (i === -1) return null;
  const j = raw.lastIndexOf("]");
  const slice = j > i ? raw.slice(i, j + 1) : raw.slice(i);
  try { const v = JSON.parse(slice); return Array.isArray(v) ? v : null; } catch {}
  // 截斷修復：補好未關閉的物件/字串/陣列
  let t = slice, inStr = false, esc = false;
  const stack = [];
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "[" || c === "{") stack.push(c === "[" ? "]" : "}");
    else if (c === "]" || c === "}") stack.pop();
  }
  if (inStr) t += '"';
  while (stack.length) {
    // 關閉前先剝掉懸掛逗號 / 半截 key-value（"key": → 整組丟）
    t = t.replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
    const tail = t.slice(-1);
    if (tail === "{" || tail === "[" || tail === ":") { t = t.slice(0, -1); continue; }
    const closer = stack.pop();
    if (tail === ":") t += "null"; // 半截 "key": → 補 null 值
    t += closer;
  }
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : null; } catch { return null; }
}

// 2026-11-01 API-first：backfillFeatureTests 退役 → tests 回寫 api_features（副檔名配對：foo.ts ↔ foo.test.ts）
async function backfillApiTests(root) {
  try {
    const { readApiFeatures } = await import("../lib/coding-db/reads.mjs");
    const { saveApiFeatures } = await import("../lib/coding-db/api-features.repo.mjs");
    const { readDoc, writeDoc } = await import("../lib/coding-db/docs.repo.mjs");
    const apis = readApiFeatures(root) || [];
    if (!apis.length) return 0;
    const fileApiMap = readDoc(root, "fileApiMap");
    const testsByFile = {};
    if (fileApiMap?.files) {
      // 用 test-intelligence 的 file 層資訊不可得時退回副檔名配對；先建 code→test 對照
    }
    let enriched = 0;
    for (const a of apis) {
      if ((a.tests || []).length) continue;
      const matched = new Set();
      for (const cf of a.codeFiles || []) {
        const base = String(cf).replace(/\.[tj]sx?$/, "");
        for (const t of apis) for (const tt of t.tests || []) {
          const tb = String(tt).replace(/\.(test|spec)\.[tj]sx?$/, "");
          if (tb === base) matched.add(tt);
        }
      }
      // 沒有跨 API 測試池：直接掃 .paaw/code-intelligence/test-intelligence.json
      if (!matched.size) {
        try {
          const ti = JSON.parse(await (await import("../lib/paaw-project.mjs")).createPaawProject(root).readFile("code-intelligence/test-intelligence.json") || "null");
          const pool = [];
          const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (typeof v === "string" && /\.(test|spec)\.[tj]sx?$/.test(v)) pool.push(v); };
          walk(ti);
          for (const cf of a.codeFiles || []) {
            const base = String(cf).replace(/\.[tj]sx?$/, "");
            for (const t of pool) if (String(t).replace(/\.(test|spec)\.[tj]sx?$/, "") === base) matched.add(t);
          }
        } catch {}
      }
      if (matched.size) { a.tests = [...matched]; enriched++; }
    }
    if (enriched) { saveApiFeatures(root, apis); if (fileApiMap) writeDoc(root, "fileApiMap", fileApiMap); }
    return enriched;
  } catch { return 0; }
}


/**
 * 多語言 manifest 摘要（2026-11-07）— CU prompt context 用，不只 package.json
 * 偵測：package.json / go.mod / Cargo.toml / pom.xml / build.gradle* / requirements.txt / pyproject.toml
 * @param {string} root
 * @returns {string} "Language: ...\nPackage: ...\nDependencies: ..."（偵測不到回空字串）
 */
function _buildManifestContext(root) {
  const parts = [];
  // Node/JS
  try {
    const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
    parts.push(`Language: JavaScript/TypeScript (package.json)`, `Package: ${pkg.name || "unknown"}`);
    const deps = Object.keys(pkg.dependencies || {});
    if (deps.length) parts.push(`Dependencies: ${deps.slice(0, 40).join(", ")}${deps.length > 40 ? " …" : ""}`);
  } catch {}
  // Go
  try {
    const gomod = readSync(join(root, "go.mod"), "utf-8");
    const module = (gomod.match(/^module\s+(\S+)/m) || [])[1] || "unknown";
    const reqs = (gomod.match(/^\t[^\s()]+/gm) || []).map((s) => s.trim()).filter((s) => !s.startsWith("go "));
    parts.push(`Language: Go (go.mod)`, `Module: ${module}`);
    if (reqs.length) parts.push(`Requires: ${reqs.slice(0, 40).join(", ")}${reqs.length > 40 ? " …" : ""}`);
  } catch {}
  // Rust（2026-11-07 複查：workspace 根目錄的 [workspace]/[profile]/[lints] 區段鍵會被當依賴 → 改區段感知，只收集 dependencies 區段）
  try {
    const cargo = readSync(join(root, "Cargo.toml"), "utf-8");
    const pkgName = (cargo.match(/^\[package\]\s*[\s\S]*?^name\s*=\s*"([^"]+)"/m) || [])[1]
      || (cargo.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || "unknown";
    const depSections = /\[workspace\.dependencies\]|\[dependencies\]|\[dev-dependencies\]|\[build-dependencies\]/;
    const cdeps = [];
    let inDeps = false;
    for (const line of cargo.split("\n")) {
      if (/^\s*\[/.test(line)) { inDeps = depSections.test(line.trim()); continue; }
      if (inDeps) { const km = line.match(/^([\w-]+)\s*=/); if (km) cdeps.push(km[1]); }
    }
    parts.push(`Language: Rust (Cargo.toml)`, `Crate: ${pkgName}`);
    if (cdeps.length) parts.push(`Dependencies: ${[...new Set(cdeps)].slice(0, 40).join(", ")}${cdeps.length > 40 ? " …" : ""}`);
  } catch {}
  // Java (Maven)
  try {
    const pom = readSync(join(root, "pom.xml"), "utf-8");
    const artifact = (pom.match(/<artifactId>([^<]+)<\/artifactId>/) || [])[1] || "unknown";
    parts.push(`Language: Java (Maven)`, `Artifact: ${artifact}`);
    const deps = [...pom.matchAll(/<dependency>\s*<groupId>[^<]+<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]);
    if (deps.length) parts.push(`Dependencies: ${deps.slice(0, 40).join(", ")}${deps.length > 40 ? " …" : ""}`);
  } catch {}
  // Java (Gradle)
  try {
    const g = readdirSync(root).find((f) => /^build\.gradle/.test(f));
    if (g && !parts.some((p) => p.startsWith("Language:"))) {
      const txt = readSync(join(root, g), "utf-8");
      parts.push(`Language: Java (Gradle, ${g})`);
      const ideps = [...txt.matchAll(/implementation\s+["']([^"']+)/g)].map((m) => m[1]);
      if (ideps.length) parts.push(`Dependencies: ${ideps.slice(0, 40).join(", ")}${ideps.length > 40 ? " …" : ""}`);
    }
  } catch {}
  // Python
  try {
    const req = readSync(join(root, "requirements.txt"), "utf-8");
    const pydeps = req.split("\n").map((l) => l.trim().split(/[=<>~!]/)[0]).filter((l) => l && !l.startsWith("#"));
    if (pydeps.length) parts.push(`Language: Python (requirements.txt)`, `Dependencies: ${pydeps.slice(0, 40).join(", ")}${pydeps.length > 40 ? " …" : ""}`);
  } catch {}
  try {
    const py = readSync(join(root, "pyproject.toml"), "utf-8");
    if (!parts.some((p) => p.startsWith("Language:"))) {
      const pname = (py.match(/^name\s*=\s*"([^"]+)"/m) || [])[1] || "unknown";
      parts.push(`Language: Python (pyproject.toml)`, `Package: ${pname}`);
    }
  } catch {}
  return parts.join("\n");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** repo root（routes/ 往上四層）— 2026-11-07 從 coding.mjs 移入共用 */
export const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

export { cuLog, diffWriteFile, _stripCodeFence, _sanitizeMd, cuStepSkillKey, loadCuStepSkills, parseQuery, _extractJsonArray, backfillApiTests, _buildManifestContext };

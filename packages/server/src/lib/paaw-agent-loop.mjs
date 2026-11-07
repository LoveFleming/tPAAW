/**
 * PAAW Agent Loop - Self-owned runtime for AI coding tasks
 *
 * Replaces external CLI agents (qwen code, opencode, claude code) with a
 * lightweight tool-calling loop that runs against PAAW's configured LLM API.
 *
 * Core flow:
 *   1. Assemble system prompt (skill + context)
 *   2. Send to LLM API with tool definitions (function calling)
 *   3. LLM responds with tool_calls → execute tools → feed results back
 *   4. LLM responds with text → done
 *   5. Repeat 2-4 until maxTurns
 *
 * Tool set aligned with Claude Code:
 *   read_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user
 *
 * Security: All tools are PAAW-owned. Every action is audit-logged.
 * Future: wrap in Docker container for sandbox isolation.
 */

import { readFile, writeFile, readdir, stat, mkdir, rm } from "fs/promises";
import { cleanupProjectTempFiles } from "./temp-janitor.mjs";
import { existsSync, readFileSync as readSync, mkdirSync, appendFileSync, writeFileSync as writeSync, readdirSync, statSync } from "fs";
import { getModuleCrew } from "./module-registry.mjs";
import { loadFeatureData, matchFeaturesForFiles, buildContextBoundary } from "./feature-boundary.mjs";
import { exec as execCb } from "child_process";
// 2026-09-27 OOM 治本：bash 殘留程序帳本（背景程序跨 run 累積 → RAM 爆 → OOM 砍 Chrome/VSCode）
import { runShellGrouped, runContextALS, sweepRunProcesses } from "./proc-ledger.mjs";
import { logAuditEvent, scanCommandOutput } from "./audit-log.mjs"; // AI 犯傻審計（2026-10-10）
import { shellExec, IS_WIN as IS_WIN_SHARED } from "./shell-exec.mjs";
import { resolve, join, dirname, relative } from "path";
import { getDependencyContext, getAffectedTests } from "./dependency-context.mjs";
import { runTaskRetrofit } from "./task-retrofit.mjs";
import { fileURLToPath } from "url";
import { readFileSync as _readSync, existsSync as _exSync } from "fs";
import { join as _pathJoin, dirname as _pathDirname, basename as _pathBasename, extname as _pathExtname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent, fetchStreamWithRetry } from "./llm-utils.mjs";
import { smartTruncateToolResult, truncateToolResultsInMessages, limitHistoryTurns, estimateTokens } from "./context-truncation.mjs";
import { compactIfNeeded, estimateMessageTokens, shouldCompact } from "./context-compaction.mjs";
import { messagesForModel, isVisionModel, hasImages, extractImageMarkers, buildImageAttachmentMessage, resolveVisionLlmConfig, visionAvailable } from "./vision-content.mjs";
import { startAgentLog } from "./agent-exec-logger.mjs";
import { createPaawProject } from "./paaw-project.mjs";
import { PaawSnapshot } from "./paaw-snapshot.mjs";
import { resolveDefaultModel, parseModelReference, jsonStringifySafe, cutSafeStart } from "./llm-utils.mjs";
import { toolRegistry } from "./tool-registry.mjs";
import { DATA_HOME, LOG_HOME, ASSET_LOGS_ROOT, logSlug } from "../data-home.mjs";
import {
  getBrowserPage, takeScreenshot, trackPage, readPageText, locateTarget,
  assertSafeUrl, browserState, PLAYWRIGHT_INSTALL_HINT, resolveBrowserKey,
  recordBrowserAction, takeActionShot, browserShotDir, getVisualMode, visualClick,
} from "./browser-session.mjs";
import { readDoc as readDocDb } from "./coding-db/docs.repo.mjs"; // feature docs（2026-11-01 coding.db）

// ── Types ──

/**
 * @typedef {Object} AgentRunConfig
 * @property {string} prompt - User's task/prompt
 * @property {string} [cwd] - Working directory (defaults to PAAW_ROOT)
 * @property {string} [skillMd] - SKILL.md content to inject as system context
 * @property {string} [systemPrompt] - Custom system prompt override
 * @property {string} [model] - Model override (defaults to provider defaultModel)
 * @property {number} [maxTurns=20] - Max agent loop iterations
 * @property {number} [timeout=120] - Overall timeout in seconds
 * @property {Object} [params] - Additional params to inject as context
 * @property {Function} [onEvent] - Callback for streaming events (SSE)
 * @property {string} [rootDir] - PAAW_ROOT for provider config
 */

/**
 * @typedef {Object} AgentRunResult
 * @property {boolean} success
 * @property {string} content - Final LLM text response
 * @property {number} turns - Number of loop iterations
 * @property {Array} toolCalls - Log of all tool calls made
 * @property {number} durationMs
 * @property {string} [error]
 */

// ── Provider Resolution ──
// providers.json is a PAAW server config file - always read from PAAW_ROOT,
// never from an arbitrary project cwd. The bug was that rootDir (which
// could be any project path) was used to find providers.json.

export const _PAAW_ROOT = resolve(__dirname, "../../../../");

function loadProviderConfig() {
  const configPath = resolve(DATA_HOME, "config/providers.json");
  try {
    return JSON.parse(readSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

export function resolveLLMConfig(_rootDir, modelOverride, fallbackModels) {
  const config = loadProviderConfig();
  if (!config) throw new Error("No provider config found - checked: " + resolve(DATA_HOME, "config/providers.json"));

  // Auto-read fallback preferences from user.json if no explicit fallbackModels
  if (!fallbackModels || fallbackModels.length === 0) {
    try {
      const userPrefs = JSON.parse(readSync(resolve(DATA_HOME, "config/user.json"), "utf-8"))?.preferences || {};
      // Collect all *Fallback keys (e.g. autoDispatchFallback, codingIDEFallback)
      const userFbs = Object.entries(userPrefs)
        .filter(([k]) => k.endsWith("Fallback"))
        .map(([, v]) => v)
        .filter(Boolean);
      if (userFbs.length > 0) fallbackModels = userFbs;
    } catch {}
  }
  // 2026-10-11（C）：user.json 的 *Fallback 偏好 + providers.json.fallbacks 合併成「一條」鏈
  // 舊行為：user.json 有 *Fallback 就完全蓋掉 providers.json.fallbacks（Settings UI 設的永遠不生效 → 幽靈 fallback）
  if (fallbackModels && fallbackModels.length > 0) {
    const merged = [...fallbackModels];
    for (const fb of (config.fallbacks || [])) {
      const ref = `${fb.provider}/${fb.model}`;
      if (!merged.includes(ref)) merged.push(ref);
    }
    fallbackModels = merged;
  }

  // Parse "providerId/modelId" format (from ModelSelector)
  // 2026-09-14 fix:改用 parseModelReference - model id 自帶 provider prefix(如 anthropic/claude-opus-4.8)
  // 不再被剝過頭(first-slash 剝成 claude-opus-4.8 → LLM API 400 unknown model)
  let providerId = config.active;
  let model = modelOverride || resolveDefaultModel(config);
  ({ providerId, model } = parseModelReference(config, model));

  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);

  const baseURL = provider.baseURL.replace(/\/+$/, "");
  const apiUrl = `${baseURL}/chat/completions`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  // OpenRouter requires extra headers
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://paaw.ai";
    headers["X-Title"] = "PAAW";
  }

  // Build fallback chain - priority: caller-supplied fallbackModels > providers.json fallbacks > hardcoded
  const fallbacks = [];

  // 1. Caller-supplied fallback models (e.g. from user.json preferences or request body)
  if (fallbackModels && fallbackModels.length > 0) {
    for (const fbModel of fallbackModels) {
      // Parse "providerId/modelId" format - 2026-09-14 同 parseModelReference(full-path model id 不剝過頭)
      const fbRef = parseModelReference(config, fbModel);
      const fbProviderId = fbRef.providerId;
      const fbModelId = fbRef.model;
      const fbProvider = config.providers[fbProviderId];
      if (!fbProvider) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${fbProvider.apiKey}` };
      if (fbProviderId === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      const fbModelDef = (fbProvider.models || []).find(m => (typeof m === "string" ? m : m.id) === fbModelId);
      // 2026-10-11（C）：provider 清單裡沒有的 model 直接跳過（幽靈 fallback）—
      // 教訓：user.json 曾指向已下架的 deepseek-v4-flash-0731 → 限流時回空內容，整步報錯
      if (!fbModelDef) { console.warn(`[resolveLLMConfig] fallback model not in ${fbProviderId} list — skipped: ${fbModelId}`); continue; }
      const fbMaxTokens = (typeof fbModelDef === "object" ? fbModelDef?.maxTokens : null) || 16384;
      fallbacks.push({ providerId: fbProviderId, apiUrl: `${fbProvider.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fbModelId, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: fbMaxTokens });
    }
  }

  // 2. providers.json fallbacks array (if no caller-supplied fallbacks)
  if (fallbacks.length === 0) {
    const configuredFallbacks = config.fallbacks || [];
    for (const fb of configuredFallbacks) {
      const fbProvider = config.providers[fb.provider];
      if (!fbProvider) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${fbProvider.apiKey}` };
      if (fb.provider === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      const fbModelDef = (fbProvider.models || []).find(m => (typeof m === "string" ? m : m.id) === fb.model);
      const fbMaxTokens = (typeof fbModelDef === "object" ? fbModelDef?.maxTokens : null) || 16384;
      fallbacks.push({ providerId: fb.provider, apiUrl: `${fbProvider.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fb.model, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: fbMaxTokens });
    }
  }

  // 3. Auto-build fallback from other providers' model lists (only if nothing else provided)
  // Uses each provider's first model - never references a model name not in that provider's list
  if (fallbacks.length === 0) {
    for (const [pid, p] of Object.entries(config.providers)) {
      if (pid === providerId) continue; // skip active provider
      const pModels = p.models || [];
      if (pModels.length === 0) continue;
      const firstModel = pModels[0];
      const fbModelId = typeof firstModel === "string" ? firstModel : firstModel.id;
      if (!fbModelId) continue;
      const fbHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` };
      if (pid === "openrouter") { fbHeaders["HTTP-Referer"] = "https://paaw.ai"; fbHeaders["X-Title"] = "PAAW"; }
      const fbModelDef = (p.models || []).find(m => (typeof m === "string" ? m : m.id) === fbModelId);
      const fbMaxTokens = (typeof fbModelDef === "object" ? fbModelDef?.maxTokens : null) || 16384;
      fallbacks.push({ providerId: pid, apiUrl: `${p.baseURL.replace(/\/+$/, "")}/chat/completions`, headers: fbHeaders, model: fbModelId, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: fbMaxTokens });
    }
  }

  // Get model's context window + max output tokens
  // Note: model may be a custom ID not in the provider's models list (e.g. "aigw_gpt5.6-terra")
  // In that case, modelDef is undefined and we use generous defaults
  const modelDef = (provider.models || []).find(m => m.id === model);
  if (!modelDef) {
    console.log(`[resolveLLMConfig] Model "${model}" not in provider's model list - using defaults (contextWindow=${DEFAULT_CONTEXT_WINDOW})`);
  }
  const contextWindow = modelDef?.contextWindow || DEFAULT_CONTEXT_WINDOW;
  const maxTokens = modelDef?.maxTokens || 16384;

  return { apiUrl, headers, model, providerId, fallbacks, contextWindow, maxTokens };
}

// ── Tool Definitions (OpenAI function-calling format) ──
// Aligned with Claude Code tool set

export { PAAW_TOOLS } from "./paaw-agent-tools.mjs"; // 2026-11-07 抽出（re-export 保相容）
import { PAAW_TOOLS } from "./paaw-agent-tools.mjs";
import { TOOL_GROUP_MAP, CORE_READ_TOOLS, AGENT_FALLBACK_GROUPS, _crewGroupCache, _crewDenyCache, DEFAULT_CONTEXT_WINDOW, CONTEXT_SAFETY_MARGIN, LLM_CALL_TIMEOUT_MS, executeTool, toolExecTimeoutMs, raceAbortTool, setAgentConfig as _setAgentConfig, _agentCfg, _agentCfgDefaults, _buildTestCommand, _parseTestResult, _findConventionTests, runShell, LOG } from "./paaw-agent-exec.mjs"; // 2026-11-07 抽出
export { executeTool, _setAgentConfig as setAgentConfig, LOG }; // re-export 保相容

function resolveCrewId(agentId) {
  return _AGENT_CREW_MAP[agentId] || (agentId && agentId.includes(".") ? agentId : undefined);
}

const _AGENT_CREW_MAP = {
  architect: "coding.architect",
  developer: "coding.developer",
  tester: "coding.tester",
  "doc-writer": "coding.doc-writer",
  qa: "coding.qa",
  helpdesk: "coding.helpdesk",
  em: "coding.em",
  rm: "coding.rm",
  ops: "coding.ops",
  handover: "coding.handover",
};

function getAgentToolsDeny(agentId, cwd = null) {
  const cacheKey = `${agentId}::${cwd || ""}`;
  if (_crewDenyCache.has(cacheKey)) return _crewDenyCache.get(cacheKey);
  const deny = new Set();
  const crewId = resolveCrewId(agentId);
  if (crewId) {
    // 2026-10-09：firmware crew 的 toolsDeny 只認 module 定義（.paaw 蓋不掉）
    const mod = getModuleCrew(crewId);
    if (mod) {
      if (Array.isArray(mod.crew.toolsDeny)) for (const n of mod.crew.toolsDeny) deny.add(n);
    } else {
      // user crew：.paaw override → data/crews（舊行為相容）
      const candidates = cwd ? [join(cwd, ".paaw", "agents", `${crewId}.json`)] : [];
      candidates.push(join(DATA_HOME, "crews", `${crewId}.json`));
      for (const p of candidates) {
        try {
          if (!existsSync(p)) continue;
          const cfg = JSON.parse(readSync(p, "utf-8"));
          if (Array.isArray(cfg.toolsDeny)) { for (const n of cfg.toolsDeny) deny.add(n); break; }
        } catch { /* bad json → skip */ }
      }
    }
  }
  _crewDenyCache.set(cacheKey, deny);
  return deny;
}

/**
 * Load toolGroups for an agent from crew.json.
 * Falls back to AGENT_FALLBACK_GROUPS if crew.json has no toolGroups.
 * @param {string} agentId - e.g. "developer", "architect"
 * @returns {string[]} tool group names
 */
function getAgentGroupsFromConfig(agentId, cwd = null) {
  // 2026-10-09：module registry 優先 — firmware crew 的 toolGroups 來自 packages/modules/*/crews/
  // 治理欄位（toolGroups/toolsDeny）為 firmware 專屬：.paaw/agents 覆蓋不了（多人 release 紀律）
  const cacheKey = `${agentId}::${cwd || ""}`;
  // Check cache first
  if (_crewGroupCache.has(cacheKey)) return _crewGroupCache.get(cacheKey);

  const crewId = resolveCrewId(agentId);
  if (!crewId) return AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];

  // ── 1. Firmware crew（module）優先 ──
  const mod = getModuleCrew(crewId);
  if (mod && Array.isArray(mod.crew.toolGroups) && mod.crew.toolGroups.length > 0) {
    _crewGroupCache.set(cacheKey, mod.crew.toolGroups);
    return mod.crew.toolGroups;
  }

  // ── 2. .paaw override（僅 user crew 適用 — firmware 的治理欄位不認）──
  if (cwd) {
    try {
      const projPath = join(cwd, ".paaw", "agents", `${crewId}.json`);
      if (existsSync(projPath)) {
        const proj = JSON.parse(readSync(projPath, "utf-8"));
        if (!mod && Array.isArray(proj.toolGroups) && proj.toolGroups.length > 0) {
          _crewGroupCache.set(cacheKey, proj.toolGroups);
          return proj.toolGroups;
        }
      }
    } catch {}
  }

  try {
    const crewPath = join(DATA_HOME, "crews", `${crewId}.json`);
    if (existsSync(crewPath)) {
      const crew = JSON.parse(readSync(crewPath, "utf-8"));
      if (Array.isArray(crew.toolGroups) && crew.toolGroups.length > 0) {
        _crewGroupCache.set(cacheKey, crew.toolGroups);
        return crew.toolGroups;
      }
    }
  } catch (err) {
    console.warn(`[getToolsForAgent] Failed to load crew config for ${agentId}:`, err.message);  // nosemgrep: unsafe-formatstring
  }

  // Fallback
  const fallback = AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];
  _crewGroupCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Clear crew group cache (call when crew.json is updated)
 */
export function clearCrewGroupCache() {
  _crewGroupCache.clear();
  _crewDenyCache.clear();
  _crewReasoningCache.clear();
}

/**
 * Get tool definitions for a specific agent.
 * Reads toolGroups from crew.json first, falls back to hardcoded defaults.
 * @param {string} agentId - Agent identifier (e.g. "developer", "architect")
 * @param {string[]} extraGroups - Additional groups to include
 * @returns {object[]} Filtered tool definitions
 */
export function getToolsForAgent(agentId, extraGroups = [], cwd = null) {
  const agentGroups = getAgentGroupsFromConfig(agentId, cwd);
  const groups = new Set([...agentGroups, ...extraGroups]);
  const useCoreRead = groups.has("core-read");
  const deny = getAgentToolsDeny(agentId, cwd); // 2026-10-09：crew toolsDeny 黑名單

  return PAAW_TOOLS.filter(tool => {
    const name = tool.function?.name;
    if (!name) return false;
    if (deny.has(name)) return false; // 代碼保證：黑名單工具物理拿不到

    // 🔧 2026-10-22：shell group — 診斷型 agent（ops/helpdesk）用 bash 做 system 診斷
    //（查 process/port/log/版本/環境）。邊界不靠 prompt 自律，靠既有四層 guard：
    // shell-guard(process 範圍) + script-guard(危險 pattern) + 審批卡 + 網路沙箱。
    // ⚠️ 必須在 core-read early-return 之前（bash 屬 core group，會先被 core-read 擓下來）
    if (groups.has("shell") && name === "bash") return true;
    // 🔧 2026-10-22：core-write-limited — ops 寫 runbook/文檔（write_file only；
    // 無 edit_file/git — source code 修改主力工具不開，動 code 轉 developer）
    if (groups.has("core-write-limited") && name === "write_file") return true;

    // Handle core-read: only read-only core tools
    if (useCoreRead && TOOL_GROUP_MAP[name] === "core") {
      return CORE_READ_TOOLS.has(name);
    }
    // If agent has core-read but NOT core, skip full-core tools
    if (useCoreRead && !groups.has("core") && TOOL_GROUP_MAP[name] === "core") {
      return CORE_READ_TOOLS.has(name);
    }

    const group = TOOL_GROUP_MAP[name];
    // 🌐 內建瀏覽器工具:所有 agent 一律可用(Fleming 2026-08-27 定調 - 讀網頁/操作/截圖是通用能力)
    if (group === "browser") return true;
    return group && groups.has(group);
  });
}

/**
 * Get list of available tool groups for debugging/UI
 */
export function getToolGroupInfo() {
  const groups = {};
  for (const [name, group] of Object.entries(TOOL_GROUP_MAP)) {
    if (!groups[group]) groups[group] = [];
    groups[group].push(name);
  }
  return groups;
}

/**
 * Get the tool groups assigned to an agent
 */
export function getAgentGroups(agentId) {
  return AGENT_FALLBACK_GROUPS[agentId] || ["core", "memory"];
}

// ── Shell Execution Helper ──

const IS_WIN = process.platform === "win32";

// Module-level debug logger (safe no-op if env var not set)

export function trimMessagesToFit(messages, contextWindow = DEFAULT_CONTEXT_WINDOW) {
  if (messages.length <= 4) return messages;

  const budget = contextWindow - CONTEXT_SAFETY_MARGIN;

  // Pass 1: Smart tool result truncation (head+tail, preserves errors at end)
  // 2026-10-22 Fleming（林雨晴讀檔被截斷）：context 還很寬鬆（<85% 預算）時不無腦截斷
  // tool result — 尤其 read_file 剛讀完就砍到 36K，agent 引用檔案內容時憑空少一半。
  // 只在真的接近預算時才被動截斷（那時 cap 也已放大，見 context-truncation.mjs tiers）。
  const _totalTokensBefore = estimateMessageTokens(messages);
  const afterToolTrunc = _totalTokensBefore > budget * 0.85 ? truncateToolResultsInMessages(messages) : messages;

  // Pass 2: Limit history turns (keep recent N user turns)
  const afterHistoryLimit = limitHistoryTurns(afterToolTrunc, 8);

  // Pass 3: Check total fits
  const totalTokens = estimateMessageTokens(afterHistoryLimit);
  if (totalTokens <= budget) {
    return afterHistoryLimit;
  }

  // Pass 4: Sliding window - keep head + as many tail messages as fit
  const head = afterHistoryLimit.slice(0, 2); // system + first user
  const tailMessages = afterHistoryLimit.slice(2);

  const keptTail = [];
  let tailTokens = estimateMessageTokens(head);
  const tailBudget = budget - tailTokens;

  for (let i = tailMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens([tailMessages[i]]);
    if (tailTokens + msgTokens > tailBudget) break;
    keptTail.unshift(tailMessages[i]);
    tailTokens += msgTokens;
  }

  const evicted = tailMessages.slice(0, tailMessages.length - keptTail.length);

  if (evicted.length === 0) {
    return [...head, ...keptTail];
  }

  // Build summary of evicted messages
  const summaryParts = evicted
    .filter(m => m.role === "assistant" || m.role === "user" || m.role === "system")
    .map(m => {
      const content = (m.content || "").slice(0, 300);
      const role = m.role === "assistant" ? "AI" : m.role === "user" ? "User" : "System";
      return `[${role}] ${content}`;
    });

  const summaryMsg = {
    role: "system",
    content: `[Context trimmed - ${evicted.length} earlier messages summarized]\n${summaryParts.join("\n").slice(0, 3000)}\n[End of summary - ${evicted.length} messages evicted to fit context window]`,
  };

  const trimmed = [...head, summaryMsg, ...keptTail];
  const trimmedTokens = estimateMessageTokens(trimmed);
  console.log(`[context-trim] ${messages.length} msgs → ${trimmed.length} msgs (est. ${totalTokens} tok → ~${trimmedTokens} tok, budget=${budget})`);
  return trimmed;
}

// ── LLM API Call ──

// ── Reasoning 控制（2026-10-11）— 兩層解析：crew > providers.json(model) > 軟預設 ──
// 值："off" | "low" | "medium" | "high" | "minimal" | {…object…}；undefined = 不注入
// 背景：deepseek-v4.1-flash 在 OpenRouter 預設 effort=high 且無法封頂（實測 max_tokens / effort 多數上游不甩）
//   → 會把整個 max_tokens 燒在 reasoning、回空答案。OpenClaw 同模型每輪都送 reasoning:{effort:…}，PAAW 過去完全不送。
// "off" 是硬開關（上游必生效）；"low/medium…" 是軟的（看 provider 路由，可能被忽略）。
const REASONING_DEFAULT_FOR_OPENROUTER = "low";
const _crewReasoningCache = new Map();

function _normalizeReasoningValue(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (v === false) return "off";
  if (typeof v === "object") return v;
  return String(v).toLowerCase();
}

/** crew 層 reasoning 覆寫。優先序（2026-10-11 二修）：
 *   RU 設定(.paaw/agents/_config.json models[id].reasoning，UI 可改)
 *   > .paaw/agents/<crew>.json > module firmware crew > data/crews
 *   reasoning 跟 model 同性質（行為偏好，非治理欄位）→ 使用者設定優先。
 */
function getAgentReasoning(agentId, cwd = null) {
  if (!agentId) return undefined;
  const cacheKey = `${agentId}::${cwd || ""}`;
  if (_crewReasoningCache.has(cacheKey)) return _crewReasoningCache.get(cacheKey);
  let val;
  const crewId = _AGENT_CREW_MAP[agentId];
  if (crewId) {
    // 1. RU 設定（Crew 編輯器 → 模型 tab）
    if (cwd) {
      try {
        const p = join(cwd, ".paaw", "agents", "_config.json");
        if (existsSync(p)) {
          const v = JSON.parse(readSync(p, "utf-8"))?.models?.[crewId]?.reasoning;
          if (v !== undefined && v !== "") val = v;
        }
      } catch { /* bad json → skip */ }
    }
    // 2. crew JSON（.paaw override > firmware > data/crews global）
    if (val === undefined) {
      const candidates = cwd ? [join(cwd, ".paaw", "agents", `${crewId}.json`)] : [];
      candidates.push(join(DATA_HOME, "crews", `${crewId}.json`));
      for (const p of candidates) {
        try {
          if (!existsSync(p)) continue;
          const cfg = JSON.parse(readSync(p, "utf-8"));
          if (cfg.reasoning !== undefined) { val = cfg.reasoning; break; }
        } catch { /* bad json → skip */ }
      }
    }
    if (val === undefined) {
      const mod = getModuleCrew(crewId);
      if (mod && mod.crew && mod.crew.reasoning !== undefined) val = mod.crew.reasoning;
    }
  }
  // CU（Code Understanding）結構化任務：reasoning 只會燒 token 回空 content
  // （2026-08-30 教訓；2026-10-23 portkey 實測 0 字 × 多輪 → 命名降級）→ 預設 off。
  // RU 設定若明確指定仍優先（上方 val 已帶值就不覆寫）。
  if (val === undefined && String(agentId).startsWith("cu-")) val = "off";
  const norm = _normalizeReasoningValue(val);
  _crewReasoningCache.set(cacheKey, norm);
  return norm;
}

/** 把 reasoning 指示轉成 provider-specific 參數寫進 body */
function applyReasoningDirective(body, providerId, val) {
  if (val === undefined) return;
  if (providerId === "openrouter") {
    if (val === "off") body.reasoning = { enabled: false };
    else if (typeof val === "object") body.reasoning = val;
    else body.reasoning = { effort: val };
  } else if (providerId === "zai") {
    if (val === "off") body.thinking = { type: "disabled" };
    else if (typeof val === "object") body.thinking = val;
    // zai 無 effort 分級 → 非 off 不注入（維持 provider 預設）
  }
}

export async function callLLM(apiUrl, headers, model, messages, tools, stream = false, onEvent = null, agentId = null, maxTokens = 16384, signal = null, reasoningDirective = undefined) {
  console.log(`[callLLM] model=${model}, stream=${stream}, apiUrl=${apiUrl}, messages=${messages.length}, max_tokens=${maxTokens}`);
  // Vision 保護(2026-08-30 Phase 1):非 vision model 收到含圖歷史 → 圖換佔位文字(防 API 400)
  // 所有 agent surface 的 LLM 請求都走這裡 - 一處攔截全鏈生效
  messages = messagesForModel(messages, isVisionModel(model));
  const body = {
    model,
    messages,
    ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    max_tokens: maxTokens,
    stream,
  };

  // reasoning 控制（2026-10-11）：crew 覆寫 > providers.json(model) > 軟預設
  const _reasoningProvider = /openrouter\.ai/.test(apiUrl) ? "openrouter" : (/z\.ai/.test(apiUrl) ? "zai" : null);
  let _reasoningVal = reasoningDirective !== undefined ? _normalizeReasoningValue(reasoningDirective) : getAgentReasoning(agentId, null);
  if (_reasoningVal === undefined && _reasoningProvider) {
    try {
      const _pc = loadProviderConfig();
      const _md = (_pc?.providers?.[_reasoningProvider]?.models || []).find(m => (typeof m === "string" ? m : m.id) === model);
      if (_md && typeof _md === "object" && _md.reasoning !== undefined) _reasoningVal = _normalizeReasoningValue(_md.reasoning);
    } catch {}
  }
  if (_reasoningVal === undefined && _reasoningProvider === "openrouter") _reasoningVal = REASONING_DEFAULT_FOR_OPENROUTER;
  applyReasoningDirective(body, _reasoningProvider, _reasoningVal);

  const callStartTime = Date.now();
  const callId = `llm-${callStartTime}-${Math.random().toString(36).slice(2, 8)}`;

  // ── LLM Request Logging ──
  // NOTE: callLLMWithRetry (llm-utils.mjs) already logs request+response for non-stream.
  // Only log here for the stream path (fetchStreamWithRetry doesn't log).
  const _countImages = (msgs) => (msgs || []).reduce((n, m) => n + (Array.isArray(m?.content) ? m.content.filter(p => p?.type === "image_url").length : 0), 0);
  const _previewMsg = (m) => {
    const c = m?.content;
    if (typeof c === "string") return { role: m.role, len: c.length, preview: c.slice(0, 200) };
    if (Array.isArray(c)) return { role: m.role, len: c.length, images: c.filter(p => p?.type === "image_url").length, preview: c.map(p => p?.type === "text" ? p.text : "[圖片]").join(" ").slice(0, 200) };
    return { role: m?.role, len: 0, preview: "" };
  };
  const _logStreamRequest = () => {
    try {
      // PAAW_LLM_LOG_DIR：測試隔離用（同 provider.mjs）
      const logDir = process.env.PAAW_LLM_LOG_DIR || join(ASSET_LOGS_ROOT, "llm");
      mkdirSync(logDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const logPath = join(logDir, `${dateStr}.jsonl`);
      const _imgTotal = _countImages(body.messages);
      const logEntry = {
        id: callId,
        ts: new Date(callStartTime).toISOString(),
        phase: "request",
        agentId: agentId || null,
        model: body.model,
        stream,
        apiUrl: apiUrl.replace(/\/v.*$/, "/..."), // don't log full URL with keys
        messageCount: body.messages?.length,
        messagesPreview: body.messages?.map(_previewMsg),
        images: _imgTotal > 0 ? _imgTotal : undefined, // Vision Phase 4:圖片成本歸因(不記 base64)
        toolsCount: body.tools?.length || 0,
        toolNames: (body.tools || []).map(t => t.function?.name).filter(Boolean),
        maxTokens: body.max_tokens,
        reasoning: body.reasoning || body.thinking || null,
      };
      appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
    } catch (_e) {}
  };
  // Stream path: log request now; non-stream path is handled by callLLMWithRetry
  if (stream) _logStreamRequest();

  // Helper to log stream response (only for stream path)
  const _logStreamResponse = (response, error = null) => {
    try {
      const logDir = join(ASSET_LOGS_ROOT, "llm");
      mkdirSync(logDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const logPath = join(logDir, `${dateStr}.jsonl`);
      const durationMs = Date.now() - callStartTime;
      const logEntry = {
        id: callId,
        ts: new Date().toISOString(),
        phase: "response",
        agentId: agentId || null,
        model: body.model,
        stream,
        durationMs,
        error: error || null,
        ...(response ? {
          finishReason: response.choices?.[0]?.finish_reason || null,
          contentLen: (response.choices?.[0]?.message?.content || "").length,
          contentPreview: (response.choices?.[0]?.message?.content || "").slice(0, 500),
          toolCalls: response.choices?.[0]?.message?.tool_calls?.map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || "").length })) || [],
          usage: response.usage || null,
        } : {}),
      };
      appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
    } catch (_e) {}
  };

  if (stream) {
    // 串流模式:用 fetchStreamWithRetry 取得連線,回傳 raw response
    const { fetchStreamWithRetry } = await import("./llm-utils.mjs");
    const resp = await fetchStreamWithRetry(apiUrl, {
      method: "POST",
      headers,
      body: jsonStringifySafe(body), // 2026-09-14: 孤兒 surrogate 清毒(emoji 截斷殘骸 → LLM 500)
    }, { timeoutMs: LLM_CALL_TIMEOUT_MS, readTimeoutMs: 600_000, maxRetries: 2, signal, onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    } });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      _logStreamResponse(null, `HTTP ${resp.status}: ${text.slice(0, 200)}`);
      throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 500)}`);
    }
    // Stream response - log metadata later in runAgentLoopStream
    // Attach callId so the loop can log the response
    resp._llmCallId = callId;
    resp._llmCallStart = callStartTime;
    return resp; // Return raw response for SSE streaming
  }

  // 非串流:用 callLLMWithRetry 統一處理 retry + 內容驗證
  const result = await callLLMWithRetry(apiUrl, headers, body, {
    maxRetries: 3,
    timeoutMs: LLM_CALL_TIMEOUT_MS,
    signal,
    validateContent: true,
    sanitize: true,
    agentId: agentId,
    caller: agentId,
    onRetry: (info) => {
      if (onEvent) onEvent("info", { message: `⏳ API 暫時不可用 (HTTP ${info.status}), ${info.delayMs / 1000}s 後重試...` });
    },
  });

  // callLLMWithRetry handles its own logging - no duplicate _logResponse here
  // 回傳跟原本一樣的 shape(把 result.raw 當 json 回傳)
  return result.raw;
}

// ── System Prompt Assembly ──

/** Skill bindings - 把 project crew 綁定的技能整份展開,直接附加到 system prompt送 LLM
 *  綁定存在 {cwd}/.paaw/agents/_config.json 的 skillBindings(Management 頁可設)
 *  auto-dispatch / crew chat / cron 都走這裡,一處注入全部生效
 *  2026-10-15：可選 meta out-param + 證據鏈 — 每次注入寫一筆 phase:"skills" 進 llm log
 *  （跟 request/response 同檔，agentId + 時間可對帳：「這單到底掛了哪些 skill」不再是黑盒） */
export async function appendSkillBindings(systemPrompt, cwd, agentId, meta = null) {
  if (!agentId || !cwd) return systemPrompt;
  try {
    const { readProjectSkills } = await import("./project-crew.mjs");
    let bound = readProjectSkills(cwd, agentId);
    if (!bound || bound.length === 0) {
      // 2026-10-15 fix（bug#5）：caller 咳短版 domain agentId（developer/architect…，如 a2a system-prompt 端點）
      // → skillBindings key 是 crewId（coding.developer）— 解析 crewId 再查一次
      // （agentId 已是完整 crewId 時第一次就命中，不進這分支；查得到綁定的短版 id 也優先尊重）
      try {
        const { getAgent } = await import("./domain-agent-registry.mjs");
        const crewId = getAgent(agentId)?.crewId;
        if (crewId && crewId !== agentId) bound = readProjectSkills(cwd, crewId);
      } catch {}
    }
    if (!bound || bound.length === 0) return systemPrompt;
    const section = bound.map(s => `### Skill: ${s.name}${s.path ? `\n(源路徑: ${s.path})` : ""}\n${s.prompt}`).join("\n\n");
    const skills = bound.map(s => ({ id: s.id, chars: s.prompt.length }));
    if (meta) { meta.skills = skills; meta.sectionChars = section.length; }
    try {
      const logDir = join(ASSET_LOGS_ROOT, "llm");
      mkdirSync(logDir, { recursive: true });
      const logPath = join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
      appendFileSync(logPath, JSON.stringify({
        id: `skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        phase: "skills",
        agentId, cwd,
        skills: skills.map(s => s.id),
        sectionChars: section.length,
      }) + "\n");
    } catch (_e) { /* 證據 log 失敗不阻斷注入 */ }
    return systemPrompt + `\n\n## 已掛載技能 (Skills)\n以下是綁定到此 Agent 的技能定義,請在執行任務時遵循這些規則(skill 定義優先於一般做法):\n\n${section}`;
  } catch (err) {
    console.warn("[AgentLoop] Skill binding injection failed:", err.message);
    return systemPrompt;
  }
}

/** Refresh dynamic context (MEMORY.md) in messages[0] after memory changes */
function refreshDynamicContext(messages) {
  if (!messages[0] || messages[0].role !== "system") return;
  try {
    const MEMORY_FILE = resolve(DATA_HOME, "config/MEMORY.md");
    let mem = "";
    try { mem = readSync(MEMORY_FILE, "utf-8"); } catch {}
    const marker = "=== 長期記憶 (MEMORY.md) ===";
    const content = messages[0].content;
    const idx = content.indexOf(marker);
    if (idx === -1) return; // no memory section in system prompt
    // Find the next === section after memory
    const afterMarker = content.indexOf("\n=== ", idx + marker.length);
    const before = content.slice(0, idx);
    const after = afterMarker === -1 ? "" : content.slice(afterMarker);
    messages[0].content = before + marker + "\n" + (mem || "(記憶是空白的)") + "\n" + after;
  } catch (err) {
    console.warn("[AgentLoop] Failed to refresh dynamic context:", err.message);
  }
}

function buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext }) {
  const parts = [];

  // ── 當前日期時間 + 時區(2026-09-06 Fleming:agent 預設要知道今天幾號、什麼時區)──
  {
    const _now = new Date();
    const _tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const _offMin = -_now.getTimezoneOffset();
    const _offStr = `UTC${_offMin >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(_offMin) / 60)).padStart(2, "0")}${Math.abs(_offMin) % 60 ? ":" + String(Math.abs(_offMin) % 60).padStart(2, "0") : ""}`;
    const _dateStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
    const _weekday = ["日", "一", "二", "三", "四", "五", "六"][_now.getDay()];
    const _timeStr = `${String(_now.getHours()).padStart(2, "0")}:${String(_now.getMinutes()).padStart(2, "0")}`;
    parts.push(`=== 當前日期時間 ===\n今天是 ${_dateStr}(星期${_weekday}),時間 ${_timeStr},時區 ${_tz} (${_offStr})`);
  }

  // ── Inject .paaw/ project context (pre-loaded by caller) ──
  if (paawContext) {
    parts.push(paawContext);
  }

  // If customPrompt is provided, it replaces the default agent prompt entirely
  // (customPrompt comes from contextEngine - e.g. skill-builder rules)
  if (customPrompt) {
    parts.push(customPrompt);
  } else {
    // Load agent loop system prompt from ai-settings
    const AGENT_LOOP_PROMPT_PATH = resolve(DATA_HOME, "ai-settings/agent-loop/system-prompt.md");
    let agentBase = "";
    try { agentBase = readSync(AGENT_LOOP_PROMPT_PATH, "utf-8").trim(); } catch {}
    if (agentBase) {
      parts.push(agentBase);
    } else {
      parts.push(`You are PAAW Agent, an AI coding assistant. Always use ABSOLUTE paths. Working directory: ${cwd}`);
    }
  }

  // Inject base context: knowledge listing + workspace paths (required for every AI request)
  const PAAW_R = _PAAW_ROOT;
  try {
    const refPaths = [];

    // 1. Knowledge: just the directory path, don't expand contents
    const knowledgeDir = resolve(PAAW_R, "data/knowledge");
    if (existsSync(knowledgeDir)) {
      refPaths.push(`📖 Knowledge (data/knowledge/) - 使用 reference_read(action="list|read|search", source="knowledge") 存取(唯讀)`);
    }

    // 2. Workspace: external dirs from workspaces.json (just the paths)
    try {
      const ws = JSON.parse(readSync(resolve(PAAW_R, "data/workspaces.json"), "utf-8"));
      if (ws.directories?.length) {
        refPaths.push(`📂 Workspace 目錄(使用 reference_read(action="list|read|search", source="workspace", path="...") 存取):\n${ws.directories.map(d => "  - " + d).join("\n")}`);
      }
    } catch {}

    if (refPaths.length > 0) {
      parts.push(`\n=== 參考資料路徑 ===\n${refPaths.join("\n\n")}\n\n使用 reference_read tool 瀏覽和搜尋以上資料。開發相似功能時,先用 reference_read(action="search", source="knowledge", path="關鍵字") 搜尋現有範例。`);
    }
  } catch {}

  // Inject cwd dynamically
  parts.push(`\nWorking directory: ${cwd}`);

  // Release Unit Boundary(RU = 專案目錄;FileGuard 已在路徑層強制,此處是明示)
  const _ruName = (cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "workspace");
  parts.push(`\n## Release Unit Boundary\n你目前服務的 Release Unit:${_ruName}\n檔案讀寫已被路徑邊界強制限制在此專案目錄內(deterministic enforcement,非提醒)。其他 Release Unit(其他專案目錄)的檔案不可存取也不需存取。若使用者要求的內容需要其他 Release Unit,請說明邊界並請使用者切換到該 RU 操作。`);
  if (IS_WIN) {
    parts.push(`\n⚠️ Windows 環境重要規則:\n- 寫檔案請用 write_file/edit_file 工具,不要用 bash 的 echo/cat 重定向(cmd.exe 字元轉義會出問題)\n- **禁止用 bash 跑 Unix 指令**:find、grep、ls、cat、head、tail、wc、sed、awk、xargs、rm、cp、mv、mkdir、touch 等在 Windows cmd.exe 不可用或行為不同\n- 用內建工具代替:glob 找檔案、grep 工具搜尋內容、read_file 讀檔、write_file 寫檔\n- bash 只用於:git 命令、node/npm/npx 命令、python 命令、跨平台指令\n- 路徑一律用正斜線 / 不要用反斜線 \\\n- 檔案路徑一律用相對路徑(如 data/apps/report/app.html),不要用絕對路徑(如 C:\\Users\\...)\n- git 命令可以正常使用\n- **每個 tool 呼叫都有 30 秒 timeout**,如果操作需要更久請分步驟執行`);
  }

  // Tool overview (compact - full schemas are sent via function-calling format)
  parts.push(`\n## Tools Overview\nproject_info(cat=...) → context/features/feature_detail/runbook/test_map/recent_changes/issues/api_history/project_read\nproject_edit(action=...) → issue_create/update/delete, change_record, feature_update_docs/mapping/delete\nread_file, write_file, edit_file, glob, grep, diff, git, bash, ask_user\n🧹 暫存規則(鐵律):測試/驗證/debug 用的暫存腳本一律寫 $PAAW_TMP/ 目錄(env 已注入,session 結束自動清)- 不要寫專案根目錄;寫進專案的 test-*.mjs / debug-* / tmp-* / scratch-* 等 session 結束會被自動刪\nreference_read(action=list|read|search, source=workspace|knowledge) → browse/read/search reference files in workspace/ and knowledge/ (read-only, for finding existing code examples and docs)\ntask_list(id?, status?, type?, featureId?, priority?) → list tasks or get single task\ntask_create(title, type, description?, fileScope?, acceptanceCriteria?, source?) → create new task(feature-first,無 pipeline)\ntask_update(id, action=update|note|assign, ...) → 改 task 欄位/狀態、加 note、派工\ntask_decompose(parentId, subTasks) → split a large task into sub-tasks
task_retrofit(priority?, featureIds?) → 上線前品質補強:從 feature map 每個 active feature 建一個補 review/test/qa/docs 的全版 task(以代碼現況為準,非歷史 task)\ndispatch_agent(agentId, task, taskId?) → dispatch work to another agent (architect/developer/tester/doc-writer/qa/helpdesk)\ncu_refresh, record_decision, docs(action=...), action_log_add/list, agent_memory_save/load`);

  if (skillMd) {
    parts.push(`\n## Skill Instructions\n\n${skillMd}`);
  }

  if (params && Object.keys(params).length > 0) {
    parts.push(`\n## User Parameters\n\n${JSON.stringify(params, null, 2)}`);
  }

  return parts.join("\n");
}

// ── Temp File Cleanup ──

/**
 * Clean up temporary/scratch files created by the agent during a session.
 *
 * Strategy:
 * 1. Files in log/tmp/<ru-slug>/($PAAW_TMP)- always cleaned (designated temp area)
 * 2. Created files matching temp patterns - cleaned (test-*.mjs, scratch.*, _temp.*, etc.)
 * 3. Created files that are legitimate source - kept (reported only)
 *
 * @param {string} cwd - project working directory
 * @param {Set<string>} createdFiles - files tracked as newly created
 * @param {Function} [logFn] - optional logger
 * @returns {Promise<number>} number of files cleaned
 */
async function cleanupTempFiles(cwd, createdFiles, logFn, sinceMs) {
  const LOG = logFn || (() => {});
  let cleaned = 0;

  // 1. Always clean log/tmp/<ru-slug>/($PAAW_TMP - 2026-09-06 起 scratch 不再進 .paaw)
  const tmpDir = join(LOG_HOME, "tmp", logSlug(cwd));
  try {
    const tmpFiles = await readdir(tmpDir).catch(() => []);
    for (const f of tmpFiles) {
      try {
        await rm(join(tmpDir, f), { recursive: true, force: true });
        cleaned++;
      } catch {}
    }
  } catch {}

  // 2. Clean created files that match temp patterns
  // These are files the agent created during work but shouldn't persist
  const tempPatterns = [
    /^test-_tmp/,           // test-_tmp-xxx.mjs
    /^_tmp/,                // _tmp-xxx.mjs, _tmp-xxx.js
    /^scratch[._-]/,        // scratch-test.mjs, scratch_verify.js
    /^tmp[._-]/,            // tmp-xxx.mjs
    /^_temp[._-]/,          // _temp-xxx.mjs
    /^temp[._-]/,           // temp-xxx.mjs
    /\.tmp$/,               // anything.tmp
    /\.scratch$/,           // anything.scratch
    /^verify[._-]/,         // verify-xxx.mjs (agent verification scripts)
    /^debug[._-]/,          // debug-xxx.mjs
    /^check[._-]/,          // check-xxx.mjs
    /^quick[._-]/,          // quick-test.mjs
    /^probe[._-]/,          // probe-xxx.mjs
    /^explore[._-]/,        // explore-xxx.mjs
    /^inspect[._-]/,        // inspect-xxx.mjs
    /^snippet[._-]/,        // snippet-xxx.mjs
  ];

  // Directories that should never have temp files cleaned (legit source)
  const protectedDirs = new Set(["src", "lib", "packages", "components", "pages", "app", "routes", "docs"]);

  for (const relPath of createdFiles) {
    const baseName = relPath.split(/[\\/]/).pop();
    const dirName = relPath.split(/[\\/]/).slice(-2, -1)[0] || "";

    // Skip files in protected directories (legit source code)
    if (protectedDirs.has(dirName)) continue;

    // Check if it matches temp patterns
    const isTemp = tempPatterns.some(p => p.test(baseName));
    if (!isTemp) continue;

    const fullPath = resolve(cwd, relPath);
    try {
      if (existsSync(fullPath)) {
        await rm(fullPath, { force: true });
        LOG(`[cleanup] Removed temp file: ${relPath}`);
        cleaned++;
      }
    } catch (e) {
      LOG(`[cleanup] Failed to remove ${relPath}: ${e.message}`);
    }
  }

  // 3. 專案掃描(2026-09-19):bash 創的檔不走 write_file → createdFiles 追蹤不到;
  //    git untracked + 暫存 pattern + mtime 在 session 窗內 → 刪(temp-janitor.mjs)
  try {
    const report = cleanupProjectTempFiles(cwd, sinceMs || (Date.now() - 30 * 60 * 1000), LOG);
    cleaned += report.removed.length;
  } catch (e) {
    LOG(`[cleanup] project scan failed: ${e.message}`);
  }

  if (cleaned > 0) {
    LOG(`[cleanup] Session cleanup: removed ${cleaned} temp file(s)`);
  }
  return cleaned;
}

// ── Main Agent Loop ──

// ── Rate-limit cache: remember which providers are throttled ──
const _rateLimitCache = new Map();
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown before retrying primary

function _providerKey(providerId, model) { return `${providerId}/${model}`; }

/**
 * Run the PAAW agent loop.
 *
 * @param {AgentRunConfig} config
 * @returns {Promise<AgentRunResult>}
 */
export async function runAgentLoop(config) {
  const {
    prompt,
    cwd = process.cwd(),
    skillMd = "",
    systemPrompt: customPrompt = "",
    model: modelOverride,
    fallbackModels,
    maxTurns,
    timeout,
    params = {},
    onEvent = null,
    rootDir = _PAAW_ROOT,
    agentId = null,
    abortSignal = null, // 使用者中斷 - 傳進 callLLM,即時殺 in-flight LLM 呼叫
    featureBoundary = null, // Context Boundary - { allowedFiles: string[], featureIds: string[] }
  } = config;

  // Load agent config for defaults (with fallback)
  let agentCfg = { ..._agentCfgDefaults };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig(); setAgentConfig(agentCfg);
  } catch {}

  const effectiveMaxTurns = maxTurns ?? agentCfg.maxTurns;
  const effectiveTimeout = timeout ?? agentCfg.timeoutSeconds;

  const startTime = Date.now();
  const timeoutMs = effectiveTimeout > 0 ? effectiveTimeout * 1000 : 0; // 0 = no timeout
  const toolCallLog = [];

  // 2026-09-27 OOM 治本：本 run 的 bash 殘留 process 群歸屬（結束時精準掃殺，lib/proc-ledger.mjs）
  const _runId = `run-${startTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  runContextALS.enterWith({ runId: _runId, ruSlug: logSlug(cwd) });

  // 2026-09-05 Fleming:每個 agent loop 的開始/結束要在 console 一眼看到
  console.log(`[AgentLoop] ▶️ agent=${agentId || "agent"} model=${modelOverride || "default"} turns≤${effectiveMaxTurns} cwd=${String(cwd).split("/").slice(-2).join("/")} prompt=${prompt.length}字`);

  // ── Execution logger ──
  const _logger = startAgentLog({
    agentId: agentId || "agent",
    prompt,
    model: modelOverride || "default",
    cwd,
    maxTurns: effectiveMaxTurns,
  });
  let snapshotTaken = false; // auto-snapshot before first file write
  const modifiedFiles = new Set(); // track modified files for post-edit test verification
  const createdFiles = new Set(); // track NEW files (didn't exist before) for cleanup

  // Ensure $PAAW_TMP exists as designated temp area (auto-cleaned each session)
  // log/tmp/<ru-slug>/(2026-09-06 Fleming:.paaw 只放資產 - scratch 一律中央 log/)
  // bash tool 已注入 $PAAW_TMP env;agents 寫 scratch 走這裡,不再碰 .paaw
  const tmpDir = join(LOG_HOME, "tmp", logSlug(cwd));
  try {
    await mkdir(tmpDir, { recursive: true });
    // Clean up previous session's temp files
    const oldTempFiles = await readdir(tmpDir).catch(() => []);
    for (const f of oldTempFiles) {
      try { await rm(join(tmpDir, f), { recursive: true, force: true }); } catch {}
    }
    LOG(`[cleanup] log/tmp cleared ${oldTempFiles.length} leftover temp files`);
  } catch {}

  // Resolve LLM config - mutable: fallback success updates active model for subsequent turns
  let llm = resolveLLMConfig(rootDir, modelOverride, fallbackModels);

  // ── Check rate-limit cache: skip primary if still throttled ──
  const primaryKey = _providerKey(llm.providerId, llm.model);
  const cached = _rateLimitCache.get(primaryKey);
  if (cached && Date.now() < cached.until && llm.fallbacks?.length > 0) {
    const fb = llm.fallbacks[0];
    console.log(`[Agent Loop] Primary ${primaryKey} is rate-limited (cache expires ${new Date(cached.until).toLocaleTimeString()}), using fallback ${fb.providerId}/${fb.model} directly`);
    llm = { ...llm, apiUrl: fb.apiUrl, headers: fb.headers, model: fb.model, providerId: fb.providerId, maxTokens: fb.maxTokens || llm.maxTokens, contextWindow: fb.contextWindow || llm.contextWindow };
  }

  if (onEvent) onEvent({ type: "start", model: llm.model, cwd, maxTurns: effectiveMaxTurns });

  // Build system prompt (load .paaw/ project context first)
  let paawContext = null;
  let paaw = null;
  try {
    paaw = createPaawProject(cwd);
    if (paaw.exists) {
      paawContext = await paaw.loadContextText();
    }
  } catch {}

  const systemPrompt = await appendSkillBindings(
    buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext }),
    cwd, agentId,
  );

  // Allow pre-built messages (for A2A conversation history injection)
  let messages = config.messages || [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  // 2026-10-15 fix：pre-built 對話（crew chat / A2A）以前直接跳過 skill 注入 — 這裡統一補上；
  // A2A 已自行 appendSkillBindings → 用 marker 防 double-inject
  if (config.messages && messages[0]?.role === "system" && typeof messages[0].content === "string"
      && !messages[0].content.includes("## 已掛載技能 (Skills)")) {
    const _enriched = await appendSkillBindings(messages[0].content, cwd, agentId);
    if (_enriched !== messages[0].content) {
      messages = [{ ...messages[0], content: _enriched }, ...messages.slice(1)];
    }
  }

  let finalContent = "";
  let turns = 0;
  let emptyRetryCount = 0;
  let _totalUsage = { prompt: 0, completion: 0, total: 0 };

  // ── 2026-10-24 doom-loop 修復：壓縮冷卻 ──
  // 壓完仍超預算（tail squeeze 也救不回）→ 訊息數比上次壓縮多 ≥6 則才准再壓；
  // 否則每步都重壓（每步多一次 30s 級全額摘要 call + 打壞 prompt cache）。
  let _lastCompactMsgCount = -1;
  let _lastCompactStillOver = false;

  for (let i = 0; i < effectiveMaxTurns; i++) {
    // Check abort signal (user interrupt)
    if (abortSignal?.aborted) {
      finalContent = "⏹️ Agent 已中斷。";
      break;
    }
    // Check timeout (skip if timeout=0 = no limit)
    if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
      finalContent += `\n\n---\n⏱️ 任務超時 (${effectiveTimeout}s),但已完成 ${turns} 個步驟。\n已修改的檔案已保存。\n你可以跟我說「繼續」來接著完成。\n---`;
      // Save progress so we can resume
      try {
        const paaw2 = createPaawProject(cwd);
        if (paaw2.exists) {
          await paaw2.addActionLog({
            agent: agentId || "unknown",
            action: "timeout",
            summary: `任務超時,已完成 ${turns}/${effectiveMaxTurns} 步。已部分完成,可續接。`,
            result: "partial",
          });
        }
      } catch {}
      if (onEvent) onEvent({ type: "timeout", turns, maxTurns: effectiveMaxTurns });
      break;
    }

    turns++;

    if (onEvent) onEvent({ type: "turn_start", turn: i + 1 });

    // ── Auto-compaction: if context is getting full, summarize older messages via LLM ──
    if (i > 0 && i % 2 === 0) { // check every 2 turns
      const compactCooldown = _lastCompactStillOver && (messages.length - _lastCompactMsgCount) < 6;
      if (compactCooldown) {
        console.log(`[compaction] Cooldown: last compaction still over budget, +${messages.length - _lastCompactMsgCount}/6 new msgs — skip`);
      } else {
        const compactResult = await compactIfNeeded(messages, {
          apiUrl: llm.apiUrl,
          headers: llm.headers,
          model: llm.model,
          contextWindow: llm.contextWindow || DEFAULT_CONTEXT_WINDOW,
          maxTokens: llm.maxTokens,
        }, { originalPrompt: prompt, onEvent });
        if (compactResult.compacted) {
          // Replace messages array contents in-place
          messages.length = 0;
          messages.push(...compactResult.messages);
          _lastCompactMsgCount = messages.length;
          _lastCompactStillOver = compactResult.stats?.stillOverBudget === true;
        }
      }
    }

    // Call LLM (with context window trimming - smart head+tail + history limit)
    const trimmedMessages = trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW);
    // ── Vision 路由(2026-08-30 Phase 3):歷史含圖 + active model 非 vision + visionModel 可用 → 本輪換 vision model ──
    // 每輪重算(compaction 收掉圖 → 自動換回原 model);429 fallback 鏈照舊走原鏈(佔位保護接手)
    const turnLlm = resolveVisionLlmConfig(llm, hasImages(messages)) || llm;
    if (turnLlm !== llm) console.log(`[Agent Loop] 👁 vision routing: ${llm.providerId}/${llm.model} → ${turnLlm.providerId}/${turnLlm.model} (history has images)`);
    let response;
    const _llmLog = _logger.llmCall({ turn: turns, model: turnLlm.model, messageCount: trimmedMessages.length, contextTokens: estimateMessageTokens(trimmedMessages) });
    try {
      response = await callLLM(turnLlm.apiUrl, turnLlm.headers, turnLlm.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId, [], cwd).map(t => t.function?.name)) : getToolsForAgent(agentId, [], cwd), false, (evt, data) => {
        if (onEvent) onEvent({ type: evt, ...data });
      }, agentId, turnLlm.maxTokens, abortSignal, getAgentReasoning(agentId, cwd));
    } catch (err) {
      // 使用者中斷 - 不進 fallback,直接結束
      if (abortSignal?.aborted || err.name === "AbortError") {
        finalContent = "⏹️ Agent 已中斷。";
        break;
      }
      // ── Provider-level fallback：429/限流 或 model 層級硬錯 ──
      // 2026-09-23 fix：model 硬錯（400 unknown model / 401 / 403 / 404）之前不進 fallback 直接整單死 —
      // EM 派工選到壞 model 時 qa/tester 全滅（公司 gpt5.6 事件）。跟 EM 規劃路徑對齊：任何 model 掛了都試下一個。
      const is429 = err.message && (err.message.includes("429") || err.message.includes("overloaded") || err.message.includes("rate") || err.message.includes("Limit Exhausted"));
      const isModelReject = err.message && /LLM API error (400|401|403|404)/.test(err.message);
      // 2026-09-30 fix：公司 LLM service 常見 502 — callLLMWithRetry 內部重試 3 次仍掛 → 之前不進 fallback 直接整單死（tool call UI 卡住）
      const isServerErr = err.message && /LLM API error (5\d\d|408)/.test(err.message);
      const _reason = is429 ? "429 rate-limited" : isServerErr ? "server error (5xx/408)" : "model rejected";
      if ((is429 || isModelReject || isServerErr) && llm.fallbacks && llm.fallbacks.length > 0) {
        for (const fb of llm.fallbacks) {
          console.log(`[Agent Loop] ${_reason} on ${llm.providerId}/${llm.model}, trying fallback: ${fb.providerId}/${fb.model}`);
          if (onEvent) onEvent({ type: "info", message: `${is429 ? "⏳ " + llm.providerId + " 限流" : "⚠️ " + llm.providerId + "/" + llm.model + " 不可用（" + String(err.message).slice(0, 120) + "）"},切換到 ${fb.providerId}/${fb.model}` });
          try {
            response = await callLLM(fb.apiUrl, fb.headers, fb.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId, [], cwd).map(t => t.function?.name)) : getToolsForAgent(agentId, [], cwd), false, (evt, data) => {
              if (onEvent) onEvent({ type: evt, ...data });
            }, agentId, fb.maxTokens || llm.maxTokens, abortSignal, getAgentReasoning(agentId, cwd));
            console.log(`[Agent Loop] Fallback to ${fb.providerId}/${fb.model} succeeded - switching active model for subsequent turns`);
            // Cache rate-limit: remember primary is throttled
            _rateLimitCache.set(primaryKey, { until: Date.now() + RATE_LIMIT_COOLDOWN_MS, fallbackKey: _providerKey(fb.providerId, fb.model) });
            // Update active LLM config so next loop iteration uses the fallback model directly
            llm = { ...llm, apiUrl: fb.apiUrl, headers: fb.headers, model: fb.model, providerId: fb.providerId, maxTokens: fb.maxTokens || llm.maxTokens, contextWindow: fb.contextWindow || llm.contextWindow };
            break;
          } catch (fbErr) {
            console.log(`[Agent Loop] Fallback ${fb.providerId}/${fb.model} also failed:`, fbErr.message);  // nosemgrep: unsafe-formatstring
            continue;
          }
        }
        if (!response) {
          finalContent = `LLM API error: All providers failed (${_reason}). ${err.message}`;
          if (onEvent) onEvent({ type: "error", error: finalContent });
          break;
        }
      } else {
        finalContent = `LLM API error: ${err.message}`;
        if (onEvent) onEvent({ type: "error", error: err.message });
        break;
      }
    }

    // Parse response
    const choice = response.choices?.[0];
    if (!choice) {
      finalContent = "LLM returned empty response";
      if (onEvent) onEvent({ type: "error", error: "LLM returned no choices" });
      break;
    }

    const assistantMsg = choice.message;
    _llmLog.done({ model: llm.model, finishReason: choice.finish_reason || null, toolCallCount: (assistantMsg.tool_calls || []).length, usage: response.usage || null });
    // Accumulate token usage
    if (response.usage) {
      _totalUsage.prompt += response.usage.prompt_tokens || 0;
      _totalUsage.completion += response.usage.completion_tokens || 0;
      _totalUsage.total += response.usage.total_tokens || 0;
    }
    // sanitize content(清隱藏字元)
    let content = sanitizeContent(assistantMsg.content || "");
    const toolCalls = assistantMsg.tool_calls;

    // Add assistant message to history
    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    // 2026-10-11：不再把 reasoning_content 帶回下一輪（原 2026-08-30 思考連續性）。
    // 理由：deepseek 在 OpenRouter 上，歷史 reasoning 會被模型當示範 → 推理越滾越大、甚至燒光 max_tokens 變空回答。
    // OpenClaw 同模型反而會 stripDeepSeekV4ReasoningContent() 把歷史 reasoning 刪掉 — 對齊它。
    delete historyMsg.reasoning_content;
    messages.push(historyMsg);

    // If LLM just responded with text (no tool calls), we're done
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      // 防禦:如果 content 是空的或只有隱藏字元,重試一次
      if (!isMeaningfulContent(content)) {
        if (emptyRetryCount < 1) {
          emptyRetryCount++;
          console.warn(`[Agent Loop] LLM returned empty/whitespace response, retrying... (attempt ${emptyRetryCount})`);
          if (onEvent) onEvent({ type: "info", message: "⚠️ AI 回應為空,重新呼叫中..." });
          // 移除剛加的 assistant message
          messages.pop();
          i--; // retry same turn
          continue;
        }
        finalContent = "[LLM 回應為空或僅含隱藏字元,重試後仍失敗]";
        if (onEvent) onEvent({ type: "assistant", content: finalContent });
      } else {
        finalContent = content;
        if (onEvent) onEvent({ type: "assistant", content });
      }
      break;
    }

    // LLM wants to call tools
    let _thinkLog = null;
    if (content) {
      if (onEvent) onEvent({ type: "assistant_thinking", content });
      _thinkLog = _logger.thinking(content);
    }

    // Execute each tool call
    // ── doom_loop 防呆（2026-10-09，抄 OpenCode 預設 ask；PAAW 版=第 3 次攔）──
    // 同一個 tool call（name + arguments 完全相同）重複 3 次 = agent 卡死燒 token，硬停
    const _doomSeen = new Map();
    for (const call of toolCalls) {
      const _toolName = call.function?.name;
      const _doomKey = _toolName + "::" + (call.function?.arguments || "");
      const _doomN = (_doomSeen.get(_doomKey) || 0) + 1;
      _doomSeen.set(_doomKey, _doomN);
      if (_doomN >= 3) {
        if (onEvent) onEvent({ type: "tool_start", name: _toolName, args: (call.function.arguments || "").slice(0, 120) });
        const _doomMsg = `🛑 doom_loop 攔截：工具「${_toolName}」以完全相同的參數重複呼叫第 ${_doomN} 次 — 你在原地打轉。停止重試同一個呼叫。改變做法：換參數、換工具、換路徑，或用 ask_user 向使用者說明卡住的原因。`;
        logAuditEvent({ kind: "doom_loop", severity: "block", tool: _toolName, command: (call.function?.arguments || "").slice(0, 2000), reason: `同參數重複呼叫第 ${_doomN} 次`, detail: { repeatCount: _doomN }, agentId, cwd });
        if (onEvent) onEvent({ type: "tool_end", name: _toolName, result: _doomMsg });
        messages.push({ role: "tool", tool_call_id: call.id, content: _doomMsg });
        continue;
      }
      const _ctx = { cwd, rootDir, onEvent, agentId };
      const _toolLog = _logger.toolCall({ tool: _toolName, argsSummary: (call.function.arguments || "").slice(0, 200) });
      // Pre-check if file exists (for new-file tracking)
      let _wasNewFile = false;
      let _toolArgs = {};
      try { _toolArgs = JSON.parse(call.function.arguments || "{}"); } catch {}
      if (_toolName === "write_file" && _toolArgs.path) {
        const _fullPath = resolve(cwd, _toolArgs.path);
        _wasNewFile = !existsSync(_fullPath);
      }
      // Execute tool with timeout (prevent hanging) + abort race (中斷可即時生效)
      // 2026-10-11：改用共用 toolExecTimeoutMs（bash ≤5min、test_run/scan 11min、browser_* 45s、其他 2min）
      const _toolTimeoutMs = toolExecTimeoutMs(_toolName, _toolArgs, _agentCfg);
      let toolResult;
      let _toolEndSent = false;
      let _toolTimer = null;
      // Wrap onEvent to track whether tool_end was emitted inside executeTool
      const _wrappedOnEvent = onEvent ? (evt) => {
        if (evt.type === "tool_end") _toolEndSent = true;
        onEvent(evt);
      } : null;
      try {
        toolResult = await raceAbortTool(Promise.race([
          toolRegistry.initialized && toolRegistry.has(_toolName)
            ? toolRegistry.execute(_toolName, JSON.parse(call.function.arguments || "{}"), { cwd, rootDir, onEvent: _wrappedOnEvent, agentId })
            : executeTool(call, cwd, rootDir, _wrappedOnEvent, agentId, featureBoundary),
          new Promise((_, reject) => {
            _toolTimer = setTimeout(() => reject(new Error(`Tool '${_toolName}' timed out after ${Math.round(_toolTimeoutMs / 1000)}s`)), _toolTimeoutMs);
            if (_toolTimer.unref) _toolTimer.unref();
          })
        ]), abortSignal, _toolName);
        toolResult = String(toolResult);
      } catch (toolErr) {
        if (toolErr?.name === "AbortError" || abortSignal?.aborted) {
          if (!_toolEndSent && onEvent) onEvent({ type: "tool_end", name: _toolName, result: "(interrupted by user)" });
          try { _toolLog.done({ resultLen: 0, resultPreview: "(interrupted by user)" }); } catch {}
          break; // 上層 for 頂端偵測 abortSignal → 收尾
        }
        toolResult = `Error: ${toolErr.message}`;
      } finally { if (_toolTimer) clearTimeout(_toolTimer); }
      // GUARANTEE: always emit tool_end if executeTool didn't
      // (fixes spinning when read_file/write_file hit error paths like isPathAllowed failures)
      if (!_toolEndSent && onEvent) {
        onEvent({ type: "tool_end", name: _toolName, result: toolResult.slice(0, 500) });
      }
      // Track modified/created files
      if (_toolName === "write_file" || _toolName === "edit_file") {
        const _p = _toolArgs.path || _toolArgs.file || "";
        const _normP = _p.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");
        if (_normP) {
          modifiedFiles.add(_normP);
          if (_wasNewFile) createdFiles.add(_normP);
        }
      }
      _toolLog.done({ resultLen: toolResult.length, resultPreview: toolResult.slice(0, 200) });
      toolCallLog.push({
        turn: i + 1,
        name: call.function.name,
        args: call.function.arguments,
        result: toolResult.slice(0, 1000),
      });
      // ── Vision Phase 3(2026-08-30):tool result 帶 [[PAAW_IMAGE:...]] → 圖進 agent message ──
      // 有看圖能力(active model 是 vision 或 visionModel 可路由)→ tool 訊息帶乾淨文字 + 追加圖片訊息
      // 沒有 → 標記降級為「已存檔」文字提示(呼叫 callLLM 時佔位保護也接不到圖,不白附 base64)
      let _pushToolMsg = toolResult;
      let _imageMsg = null;
      const { text: _cleanText, imagePaths: _imgPaths } = extractImageMarkers(toolResult);
      if (_imgPaths.length > 0) {
        if (visionAvailable(llm)) {
          _pushToolMsg = _cleanText;
          _imageMsg = buildImageAttachmentMessage(
            _imgPaths,
            "📸 [系統附圖] 這是 browser_screenshot 拍的目前畫面(系統自動附上,非使用者輸入)- 請基於畫面內容做視覺驗證"
          );
          console.log(`[Agent Loop] 👁 vision attach: ${_imgPaths.length} image(s) from ${_toolName}`);
        } else {
          _pushToolMsg = _cleanText + "\n(圖片已存檔但本 run 無 vision 能力 - 請改用 browser_read 讀取文字內容)";
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: _pushToolMsg,
      });
      if (_imageMsg) messages.push(_imageMsg);

      // Refresh system prompt dynamic context after memory changes
      if (call.function.name === "memory_add" || call.function.name === "memory_update") {
        refreshDynamicContext(messages);
      }
    }

    // ── 安全停止（2026-10-11 Fleming）：被擋後仍重複嘗試 → 停此工作（audit 已於 executeTool 記）──
    try {
      const _st = runContextALS.getStore();
      if (_st?.stopReason) {
        finalContent = `⛔ 已停止此工作：${_st.stopReason}。已記錄審計，需人工處理（設定 → 🛡 安全）。`;
        if (onEvent) onEvent({ type: "security_stop", reason: _st.stopReason });
        if (onEvent) onEvent({ type: "assistant", content: finalContent });
        break;
      }
    } catch { /* no ALS */ }
  }

  const durationMs = Date.now() - startTime;

  if (onEvent) onEvent({ type: "end", turns, durationMs, toolCalls: toolCallLog.length });

  // End thinking log if active (declared inside loop, safe no-op if already done)

  // ── Finalize execution log ──
  await _logger.end({ turns, status: "completed" });

  // ── Record session to .paaw/sessions/ ──
  if (paaw && paaw.exists) {
    try {
      await paaw.recordSession({
        task: prompt.slice(0, 200),
        prompt,
        success: !finalContent.includes("[Agent loop timed out]") && !finalContent.startsWith("LLM API error"),
        partial: finalContent.includes("[Agent loop timed out]"), // timed out but may have partial work
        content: finalContent,
        toolCalls: toolCallLog,
        durationMs,
      });
      // Auto-generate changelog if there were file changes
      if (toolCallLog.some(tc => tc.name === "write_file" || tc.name === "edit_file")) {
        await paaw.generateChangelogFromSession({
          task: prompt.slice(0, 200),
          toolCalls: toolCallLog,
        });

        // ── P0: Auto-run affected tests after code changes ──
        const changedFiles = [...modifiedFiles];
        if (changedFiles.length > 0) {
          try {
            const affectedTests = getAffectedTests(cwd, changedFiles);
            if (affectedTests.length > 0) {
              LOG(`[post-edit-verify] Found ${affectedTests.length} affected test files for ${changedFiles.length} changed files`);
              // Run the tests using the project's test runner
              const testCmd = _buildTestCommand(cwd, affectedTests);
              if (testCmd) {
                LOG(`[post-edit-verify] Running: ${testCmd}`);
                const testResult = await runShell(testCmd, cwd, 60_000);
                const testPassed = _parseTestResult(testResult);
                if (!testPassed.ok) {
                  LOG(`[post-edit-verify] ⚠️ Tests FAILED: ${testPassed.failed}/${testPassed.total}`);
                  // Append test failure info to the final content so the AI knows
                  const failureNotice = [
                    "",
                    "━━━ ⚠️ Post-Edit Test Verification ━━━",
                    testPassed.ok ? "✅ All affected tests passed!" : `❌ ${testPassed.failed}/${testPassed.total} tests FAILED after your changes:`,
                    "",
                    testResult.slice(0, 3000),
                    "",
                    "💡 Your changes may have broken these tests. Please review and fix.",
                  ].join("\n");
                  finalContent += failureNotice;
                } else {
                  LOG(`[post-edit-verify] ✅ All ${testPassed.total} affected tests passed`);
                  finalContent += "\n\n✅ Post-edit verification: All affected tests passed.";
                }
              }
            } else {
              // Convention-based test lookup
              const conventionTests = _findConventionTests(cwd, changedFiles);
              if (conventionTests.length > 0) {
                LOG(`[post-edit-verify] Found ${conventionTests.length} convention-based test files`);
                const testCmd = _buildTestCommand(cwd, conventionTests);
                if (testCmd) {
                  const testResult = await runShell(testCmd, cwd, 60_000);
                  const testPassed = _parseTestResult(testResult);
                  if (!testPassed.ok) {
                    const failureNotice = ["", "━━━ ⚠️ Post-Edit Test Verification ━━━", `❌ ${testPassed.failed}/${testPassed.total} tests FAILED:`, "", testResult.slice(0, 3000), "", "💡 Your changes may have broken these tests. Please review and fix."].join("\n");
                    finalContent += failureNotice;
                  } else {
                    finalContent += "\n\n✅ Post-edit verification: All affected tests passed.";
                  }
                }
              } else {
                LOG("[post-edit-verify] No affected tests found - skipping auto-verify");
              }
            }
          } catch (verifyErr) {
            LOG("[post-edit-verify] Error:", verifyErr.message);
          }
        }
      }
    } catch (e) {
      console.error("[paaw-project] Failed to record session:", e.message);
    }
  }

  // ── Auto-cleanup temp files created during this session ──
  await cleanupTempFiles(cwd, createdFiles, (msg) => console.log(msg), startTime);

  // ── OOM 治本（2026-09-27）：掃掉本 run bash 殘留的背景 process（test harness / verify server…）──
  // 只殺本 run 帳本裡的 process group — dev_server 工具起的（自帶生命週期）與系統程序不受影響
  try {
    const _swept = await sweepRunProcesses(_runId, { reason: `run-end ${agentId || "agent"}` });
    if (_swept.length > 0) {
      console.log(`[AgentLoop] 🧹 殘留背景程序掃除 ×${_swept.length}（run=${_runId}）：${_swept.map((s) => String(s.command).slice(0, 50)).join(" | ")}`);
    }
  } catch (e) { console.error("[AgentLoop] proc-ledger sweep error:", e.message); }

  const _loopOk = !finalContent.includes("[Agent loop timed out]") && !finalContent.startsWith("LLM API error");
  console.log(`[AgentLoop] ${_loopOk ? "✅" : "❌"} agent=${agentId || "agent"} 結束(${turns} turns, ${((Date.now() - startTime) / 1000).toFixed(0)}s, ${_totalUsage.total || 0} tokens, 輸出 ${finalContent.length} 字)`);

  return {
    success: _loopOk,
    partial: finalContent.includes("[Agent loop timed out]"),
    content: finalContent,
    turns,
    toolCalls: toolCallLog,
    durationMs,
    usage: _totalUsage,
    boundaryViolations: featureBoundary?._violations || [],
  };
}

/**
 * Run agent loop with streaming (SSE) support.
 * Returns the raw fetch Response for the caller to pipe as SSE.
 */
export async function runAgentLoopStream(config, res) {
  const {
    prompt,
    cwd = process.cwd(),
    skillMd = "",
    systemPrompt: customPrompt = "",
    model: modelOverride,
    fallbackModels,
    maxTurns,
    timeout,
    params = {},
    rootDir = _PAAW_ROOT,
    agentId = null,
    abortSignal = null,
    featureBoundary = null,
    // 2026-09-11 治本:事件側車 - 不管 res 生死都回報(a2a stream-state 靠這個在 client 斷線後繼續 buffer)
    onStreamEvent = null,
  } = config;

  let agentCfg = { ..._agentCfgDefaults };
  try {
    const { loadAgentConfig } = await import("../routes/context.mjs");
    agentCfg = await loadAgentConfig(); setAgentConfig(agentCfg);
  } catch {}

  const effectiveMaxTurns = maxTurns ?? agentCfg.maxTurns;
  const effectiveTimeout = timeout ?? agentCfg.timeoutSeconds;

  const startTime = Date.now();
  const timeoutMs = timeout > 0 ? timeout * 1000 : 0; // 0 = no timeout
  const streamModifiedFiles = new Set(); // track modified files for post-edit verification
  const streamCreatedFiles = new Set(); // track NEW files for cleanup

  // 2026-09-27 OOM 治本：本 run 的 bash 殘留 process 群歸屬（同 runAgentLoop，lib/proc-ledger.mjs）
  const _runId = `run-${startTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  runContextALS.enterWith({ runId: _runId, ruSlug: logSlug(cwd) });

  // Ensure $PAAW_TMP exists as designated temp area (auto-cleaned each session)
  // log/tmp/<ru-slug>/(2026-09-06:.paaw 只放資產)- 同 runAgentLoop
  const streamTmpDir = join(LOG_HOME, "tmp", logSlug(cwd));
  try {
    await mkdir(streamTmpDir, { recursive: true });
    const oldTempFiles = await readdir(streamTmpDir).catch(() => []);
    for (const f of oldTempFiles) {
      try { await rm(join(streamTmpDir, f), { recursive: true, force: true }); } catch {}
    }
    console.log(`[cleanup] log/tmp cleared ${oldTempFiles.length} leftover temp files`);
  } catch {}

  // ── Execution logger ──
  const _logger = startAgentLog({
    agentId: agentId || "coding",
    prompt,
    model: modelOverride || "default",
    cwd,
    maxTurns: effectiveMaxTurns,
  });

  // SSE helper
  const sendSSE = (event, data) => {
    try { if (onStreamEvent) onStreamEvent(event, data); } catch {} // 側車先送 - res.destroyed 後 finalContent 靠它落地
    try {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Resolve LLM config
  // Resolve LLM config - mutable for fallback
  let llm = resolveLLMConfig(rootDir, modelOverride, fallbackModels);

  // ── Check rate-limit cache: skip primary if still throttled ──
  const primaryKey = _providerKey(llm.providerId, llm.model);
  const cached = _rateLimitCache.get(primaryKey);
  if (cached && Date.now() < cached.until && llm.fallbacks?.length > 0) {
    const fb = llm.fallbacks[0];
    console.log(`[Agent Loop Stream] Primary ${primaryKey} is rate-limited (cache), using fallback ${fb.providerId}/${fb.model} directly`);
    llm = { ...llm, apiUrl: fb.apiUrl, headers: fb.headers, model: fb.model, providerId: fb.providerId, maxTokens: fb.maxTokens || llm.maxTokens, contextWindow: fb.contextWindow || llm.contextWindow };
  }

  sendSSE("start", { model: llm.model, cwd, maxTurns });

  // Build system prompt (load .paaw/ project context first)
  let paawContext = null;
  try {
    const paaw = createPaawProject(cwd);
    if (paaw.exists) {
      paawContext = await paaw.loadContextText();
    }
  } catch {}
  const systemPrompt = await appendSkillBindings(
    buildSystemPrompt({ cwd, skillMd, customPrompt, params, paawContext }),
    cwd, agentId,
  );
  // Allow pre-built messages (for conversation history injection)
  // If provided, use them directly; otherwise build from prompt + systemPrompt
  // 2026-10-15 fix：同非串流版 — pre-built 對話統一補 skill 注入（marker 防 double）
  let messages = config.messages || [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  if (config.messages && messages[0]?.role === "system" && typeof messages[0].content === "string"
      && !messages[0].content.includes("## 已掛載技能 (Skills)")) {
    const _enriched = await appendSkillBindings(messages[0].content, cwd, agentId);
    if (_enriched !== messages[0].content) {
      messages = [{ ...messages[0], content: _enriched }, ...messages.slice(1)];
    }
  }

  let turns = 0;
  let contentEmitted = false;
  let streamEmptyRetryCount = 0;
  // 2026-09-25 fix：主 loop 已因 LLM 掛掉（429 全 fallback 失敗 / model 硬錯）送出 error →
  // 結尾的強制總結（final summary）不再重打同一條註定失敗的鏈，避免 UI 顯示兩筆錯誤（Fleming 公司 429 事件）
  let llmFatalError = false;

  for (let i = 0; i < effectiveMaxTurns; i++) {
    // Check abort signal (user interrupt)
    if (abortSignal?.aborted) {
      sendSSE("interrupted", { message: "Agent interrupted by user", turns });
      break;
    }
    if (timeoutMs > 0 && Date.now() - startTime > timeoutMs) {
      sendSSE("error", { error: `Agent loop timed out after ${Math.round(timeoutMs/60000)} min (${turns} turns completed). Work may be partially done - moving to next sub-task. Check action log for what was completed.` });
      break;
    }

    turns++;
    sendSSE("turn", { turn: i + 1 });

    // ── Auto-compaction: if context is getting full, summarize older messages via LLM ──
    if (i > 0 && i % 2 === 0) { // check every 3 turns
      const compactResult = await compactIfNeeded(messages, {
        apiUrl: llm.apiUrl,
        headers: llm.headers,
        model: llm.model,
        contextWindow: llm.contextWindow || DEFAULT_CONTEXT_WINDOW,
        maxTokens: llm.maxTokens,
      }, { originalPrompt: prompt, onEvent: sendSSE });
      if (compactResult.compacted) {
        // Replace messages array contents in-place
        messages.length = 0;
        messages.push(...compactResult.messages);
      }
    }

    // Call LLM with fallback chain on 429/rate-limit (with context window trimming)
    const trimmedMessages = trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW);
    let response;
    // ── Vision 路由(2026-08-30 Phase 3):同 runAgentLoop - 歷史含圖 → 本輪換 vision model ──
    let usedLlm = resolveVisionLlmConfig(llm, hasImages(messages)) || llm;
    if (usedLlm !== llm) console.log(`[Agent Loop Stream] 👁 vision routing: ${llm.providerId}/${llm.model} → ${usedLlm.providerId}/${usedLlm.model} (history has images)`);
    const _llmLog = _logger.llmCall({ turn: turns, model: usedLlm.model, messageCount: trimmedMessages.length, contextTokens: estimateMessageTokens(trimmedMessages) });
    try {
      response = await callLLM(usedLlm.apiUrl, usedLlm.headers, usedLlm.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId, [], cwd).map(t => t.function?.name)) : getToolsForAgent(agentId, [], cwd), false, sendSSE, agentId, usedLlm.maxTokens, abortSignal, getAgentReasoning(agentId, cwd));
    } catch (err) {
      // 使用者中斷 - 殺掉 in-flight LLM 呼叫後立即停止,不進 fallback/retry
      if (abortSignal?.aborted || err.name === "AbortError") {
        sendSSE("interrupted", { message: "Agent interrupted by user", turns });
        break;
      }
      // 2026-09-23 fix：同 runAgentLoop — model 硬錯（400/401/403/404）也要走 fallback，不再只限 429
      // 2026-09-30 fix：同 runAgentLoop — 5xx/408（公司 LLM service 502）也走 fallback，不再整單死
      const is429 = err.message && (err.message.includes("429") || err.message.includes("overloaded") || err.message.includes("rate"));
      const isModelReject = err.message && /LLM API error (400|401|403|404)/.test(err.message);
      const isServerErr = err.message && /LLM API error (5\d\d|408)/.test(err.message);
      if ((is429 || isModelReject || isServerErr) && llm.fallbacks && llm.fallbacks.length > 0) {
        for (const fb of llm.fallbacks) {
          console.log(`[callLLM] ${is429 ? "429 rate-limited" : isServerErr ? "server error (5xx/408)" : "model rejected"}, trying fallback: ${fb.providerId}/${fb.model}`);
            // Cache rate-limit: remember primary is throttled
            _rateLimitCache.set(primaryKey, { until: Date.now() + RATE_LIMIT_COOLDOWN_MS, fallbackKey: _providerKey(fb.providerId, fb.model) });
            sendSSE("info", { message: `${is429 ? "⏳ " + llm.providerId + " 限流" : "⚠️ " + llm.providerId + "/" + llm.model + " 不可用"},切換到 ${fb.providerId}/${fb.model}` });
            try {
              response = await callLLM(fb.apiUrl, fb.headers, fb.model, trimmedMessages, toolRegistry.initialized ? toolRegistry.getDefinitions(getToolsForAgent(agentId, [], cwd).map(t => t.function?.name)) : getToolsForAgent(agentId, [], cwd), false, sendSSE, agentId, fb.maxTokens || llm.maxTokens, abortSignal, getAgentReasoning(agentId, cwd));
              usedLlm = fb;
              // Update llm so subsequent turns use fallback directly
              llm = { ...llm, apiUrl: fb.apiUrl, headers: fb.headers, model: fb.model, providerId: fb.providerId, maxTokens: fb.maxTokens || llm.maxTokens, contextWindow: fb.contextWindow || llm.contextWindow };
              break;
          } catch (fbErr) {
            console.log(`[callLLM] fallback ${fb.providerId} also failed:`, fbErr.message);  // nosemgrep: unsafe-formatstring
            continue;
          }
        }
        if (!response) {
          sendSSE("error", { error: `All providers failed: ${err.message}` });
          llmFatalError = true;
          break;
        }
      } else {
        sendSSE("error", { error: err.message });
        llmFatalError = true;
        break;
      }
    }

    const choice = response.choices?.[0];
    if (!choice) { sendSSE("error", { error: "Empty LLM response" }); break; }

    // ── Log stream response ──
    if (response._llmCallId) {
      try {
        const logDir = join(ASSET_LOGS_ROOT, "llm");
        mkdirSync(logDir, { recursive: true });
        const dateStr = new Date().toISOString().slice(0, 10);
        const logPath = join(logDir, `${dateStr}.jsonl`);
        const durationMs = Date.now() - (response._llmCallStart || Date.now());
        appendFileSync(logPath, JSON.stringify({
          id: response._llmCallId,
          ts: new Date().toISOString(),
          phase: "response",
          agentId: agentId || null,
          model: usedLlm.model,
          stream: true,
          durationMs,
          finishReason: choice.finish_reason || null,
          contentLen: (choice.message?.content || "").length,
          contentPreview: (choice.message?.content || "").slice(0, 500),
          toolCalls: (choice.message?.tool_calls || []).map(tc => ({ name: tc.function?.name, argsLen: (tc.function?.arguments || "").length })),
          usage: response.usage || null,
        }) + "\n");
      } catch (_e) {}
    }

    // ── Log LLM result ──
    _llmLog.done({
      model: usedLlm.model,
      finishReason: choice?.finish_reason || null,
      toolCallCount: (choice?.message?.tool_calls || []).length,
      usage: response.usage || null,
    });

    const assistantMsg = choice.message;
    const content = sanitizeContent(assistantMsg.content || "");
    const toolCalls = assistantMsg.tool_calls;

    const historyMsg = { role: "assistant", content };
    if (toolCalls) historyMsg.tool_calls = toolCalls;
    // 2026-10-11：同 runAgentLoop — 不再帶回 reasoning_content（對齊 OpenClaw 的 strip 行為）
    delete historyMsg.reasoning_content;
    messages.push(historyMsg);

    // Final text response - check for empty/whitespace, retry once
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason === "stop") {
      if (!isMeaningfulContent(content)) {
        if (streamEmptyRetryCount < 1) {
          streamEmptyRetryCount++;
          console.warn(`[Agent Loop Streaming] LLM returned empty/whitespace response, retrying... (attempt ${streamEmptyRetryCount})`);
          sendSSE("info", { message: "⚠️ AI 回應為空,重新呼叫中..." });
          messages.pop();
          i--;
          continue;
        }
        sendSSE("content", { content: "[AI 回應為空或僅含隱藏字元,重試後仍失敗]", done: true });
        contentEmitted = true;
        break;
      }
      sendSSE("content", { content, done: true });
      contentEmitted = true;
      break;
    }

    // Intermediate thinking
    let _thinkLog = null;
    if (content) {
      sendSSE("thinking", { content });
      _thinkLog = _logger.thinking(content);
    }

    // Execute tools
    // ── doom_loop 防呆（2026-10-10 補 stream 版 — 與 runAgentLoop 同規格，全 loop 安全係數最高）──
    const _doomSeenS = new Map();
    for (const call of toolCalls) {
      let args;
      try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
      const _sToolName = call.function?.name;
      const _sDoomKey = _sToolName + "::" + (call.function?.arguments || "");
      const _sDoomN = (_doomSeenS.get(_sDoomKey) || 0) + 1;
      _doomSeenS.set(_sDoomKey, _sDoomN);
      if (_sDoomN >= 3) {
        const _sDoomMsg = `🛑 doom_loop 攔截：工具「${_sToolName}」以完全相同的參數重複呼叫第 ${_sDoomN} 次 — 你在原地打轉。停止重試同一個呼叫。改變做法：換參數、換工具、換路徑，或用 ask_user 向使用者說明卡住的原因。`;
        logAuditEvent({ kind: "doom_loop", severity: "block", tool: _sToolName, command: (call.function?.arguments || "").slice(0, 2000), reason: `同參數重複呼叫第 ${_sDoomN} 次`, detail: { repeatCount: _sDoomN, loop: "stream" }, agentId, cwd });
        sendSSE("tool", { name: _sToolName, args: (call.function.arguments || "").slice(0, 120) });
        sendSSE("tool_result", { name: _sToolName, result: _sDoomMsg.slice(0, 2000) });
        messages.push({ role: "tool", tool_call_id: call.id, content: _sDoomMsg });
        continue;
      }
      sendSSE("tool", { name: call.function.name, args });

      const _toolLog = _logger.toolCall({ tool: call.function.name, argsSummary: JSON.stringify(args).slice(0, 200) });
      const _toolName2 = call.function?.name;
      const _ctx2 = {
        cwd, rootDir, agentId,
        // 2026-10-10：registry 路徑也接事件 — 安全通知（白名單/沙箱）不因 registry adapter 而丟失
        onEvent: (ev) => {
          if (ev?.type === "approval_request") sendSSE("approval_request", { id: ev.id, command: ev.command, reason: ev.reason, agentId: ev.agentId || agentId || null }); // 2026-10-13 agentId
          if (ev?.type === "security_notice") sendSSE("security_notice", { kind: ev.kind, domains: ev.domains, message: ev.message });
        },
      };
      // Pre-check if file exists (for new-file tracking)
      let _streamWasNew = false;
      if (_toolName2 === "write_file" && args.path) {
        _streamWasNew = !existsSync(resolve(cwd, args.path));
      }
      // ── 工具執行：逾時 + 中斷競速（2026-10-11 Fleming：browser_click 卡死且無法中斷）──
      const _stTimeoutMs = toolExecTimeoutMs(_toolName2, args, agentCfg);
      let toolResult;
      let _stInterrupted = false;
      let _stTimer = null;
      try {
        const _stExec = toolRegistry.initialized && toolRegistry.has(_toolName2)
          ? toolRegistry.execute(_toolName2, args, _ctx2)
          : executeTool(call, cwd, rootDir, (ev) => {
              // ── 審批卡（2026-10-09）：streaming 路徑的 approval_request 事件直送 SSE ──
              if (ev?.type === "approval_request") sendSSE("approval_request", { id: ev.id, command: ev.command, reason: ev.reason, agentId: ev.agentId || agentId || null }); // 2026-10-13 agentId
              // ── 安全通知（2026-10-10）：白名單阻擋/沙箱拒絕 → 使用者看得到 + 引導去安全 tab ──
              if (ev?.type === "security_notice") sendSSE("security_notice", { kind: ev.kind, domains: ev.domains, message: ev.message });
            }, agentId, featureBoundary);
        toolResult = String(await raceAbortTool(Promise.race([
          Promise.resolve(_stExec),
          new Promise((_, rej) => {
            _stTimer = setTimeout(() => rej(new Error(`Tool '${_toolName2}' timed out after ${Math.round(_stTimeoutMs / 1000)}s`)), _stTimeoutMs);
            if (_stTimer.unref) _stTimer.unref();
          }),
        ]), abortSignal, _toolName2));
      } catch (_stErr) {
        if (_stErr?.name === "AbortError" || abortSignal?.aborted) {
          console.log(`[Agent Loop Stream] ⏹ tool ${_toolName2} interrupted by user`);
          try { _toolLog.done({ resultLen: 0, resultPreview: "(interrupted by user)" }); } catch {}
          _stInterrupted = true;
        } else {
          toolResult = `Error: ${_stErr.message}`;
          console.log(`[Agent Loop Stream] ⚠️ tool ${_toolName2} failed/timed out: ${_stErr.message}`);
        }
      } finally { if (_stTimer) clearTimeout(_stTimer); }
      if (_stInterrupted) break; // 上層 for 頂端會偵測 abortSignal 並送 interrupted 事件
      const _toolDuration = _toolLog.done({ resultLen: toolResult.length, resultPreview: toolResult.slice(0, 200) });
      sendSSE("tool_result", { name: call.function.name, result: toolResult.slice(0, 2000) });

      // Track modified files for post-edit verification + track new files for cleanup
      if (_toolName2 === "write_file" || _toolName2 === "edit_file") {
        try {
          const p = args.path || args.file || "";
          const normP = p.replace(cwd + "/", "").replace(cwd + "\\", "").replace(/^\//, "");
          if (normP) {
            streamModifiedFiles.add(normP);
            if (_streamWasNew) streamCreatedFiles.add(normP);
          }
        } catch {}
      }

      // Refresh system prompt dynamic context after memory changes
      if (call.function.name === "memory_add" || call.function.name === "memory_update") {
        refreshDynamicContext(messages);
      }

      // ── Vision Phase 3(2026-08-30):同 runAgentLoop - tool result 帶圖 → 進 agent message ──
      let _pushToolMsg2 = toolResult;
      let _imageMsg2 = null;
      const { text: _cleanText2, imagePaths: _imgPaths2 } = extractImageMarkers(toolResult);
      if (_imgPaths2.length > 0) {
        if (visionAvailable(llm)) {
          _pushToolMsg2 = _cleanText2;
          _imageMsg2 = buildImageAttachmentMessage(
            _imgPaths2,
            "📸 [系統附圖] 這是 browser_screenshot 拍的目前畫面(系統自動附上,非使用者輸入)- 請基於畫面內容做視覺驗證"
          );
          console.log(`[Agent Loop Stream] 👁 vision attach: ${_imgPaths2.length} image(s) from ${_toolName2}`);
        } else {
          _pushToolMsg2 = _cleanText2 + "\n(圖片已存檔但本 run 無 vision 能力 - 請改用 browser_read 讀取文字內容)";
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: _pushToolMsg2,
      });
      if (_imageMsg2) messages.push(_imageMsg2);
    }

    // ── 安全停止（2026-10-11 Fleming）：被擋後仍重複嘗試 → 停此工作（audit 已於 executeTool 記）──
    try {
      const _sst = runContextALS.getStore();
      if (_sst?.stopReason) {
        const _smsg = `⛔ 已停止此工作：${_sst.stopReason}。已記錄審計，需人工處理（設定 → 🛡 安全）。`;
        sendSSE("assistant", { content: _smsg });
        contentEmitted = true;
        break;
      }
    } catch { /* no ALS */ }

    // End thinking log after all tools in this turn
    if (_thinkLog) _thinkLog.done();
  }

  // If we exhausted maxTurns without a final content response, force one
  // 2026-09-21 fix:使用者中斷時跳過 — 這個強制總結用同一個 abortSignal,必然立刻被殺掉,
  // 只會送出假的 "Final summary failed: Aborted by user interrupt" error(被 stream-state 記錄、
  // 斷線接回 poller 撿到後在 chat 顯示第三則錯誤訊息)。中斷已由 interrupted 事件表達,不需總結。
  // 2026-09-25 fix：llmFatalError 時跳過強制總結 — 同一條 LLM 鏈剛剛才全掛，再打一次只會多送一筆
  // 「Final summary failed: LLM API error: 429...」錯誤訊息（UI 顯示兩筆幾乎相同的錯誤）
  if (!contentEmitted && !llmFatalError && !abortSignal?.aborted) {
    try {
      messages.push({
        role: "user",
        content: "你已經收集了足夠的資訊。現在請根據你看到的內容,直接給出完整的回答。不要使用任何工具。",
      });
      // Vision 路由同主 loop:尾輪含圖 → 換 vision model
      const _finalLlm = resolveVisionLlmConfig(llm, hasImages(messages)) || llm;
      const finalResponse = await callLLM(_finalLlm.apiUrl, _finalLlm.headers, _finalLlm.model, trimMessagesToFit(messages, llm.contextWindow || DEFAULT_CONTEXT_WINDOW), [], false, sendSSE, agentId, _finalLlm.maxTokens, abortSignal, getAgentReasoning(agentId, cwd));
      const finalContent = finalResponse.choices?.[0]?.message?.content || "";
      if (finalContent) {
        sendSSE("content", { content: finalContent, done: true });
      }
    } catch (err) {
      // 使用者中斷不是錯誤 — 不送 error(防 race:abort 檢查後才觸發 abort 的窗口期)
      if (!(abortSignal?.aborted || err.name === "AbortError")) {
        sendSSE("error", { error: `Final summary failed: ${err.message}` });
      }
    }
  }

  // ── P0: Post-edit test verification for stream mode ──
  if (streamModifiedFiles.size > 0) {
    try {
      const changedFiles = [...streamModifiedFiles];
      const affectedTests = getAffectedTests(cwd, changedFiles);
      const testsToRun = affectedTests.length > 0 ? affectedTests : _findConventionTests(cwd, changedFiles);
      if (testsToRun.length > 0) {
        sendSSE("info", { message: `🧪 Auto-verifying ${testsToRun.length} affected test files...` });
        const testCmd = _buildTestCommand(cwd, testsToRun);
        if (testCmd) {
          const testResult = await runShell(testCmd, cwd, 60_000);
          const testPassed = _parseTestResult(testResult);
          if (!testPassed.ok) {
            sendSSE("verify", { ok: false, failed: testPassed.failed, total: testPassed.total, output: testResult.slice(0, 2000) });
          } else {
            sendSSE("verify", { ok: true, total: testPassed.total, output: "All affected tests passed" });
          }
        }
      }
    } catch (verifyErr) {
      sendSSE("verify", { ok: true, error: verifyErr.message });
    }
  }

  // ── Auto-cleanup temp files created during this session ──
  const cleanedFiles = await cleanupTempFiles(cwd, streamCreatedFiles, undefined, startTime);
  if (cleanedFiles > 0) {
    sendSSE("info", { message: `🧹 Cleaned up ${cleanedFiles} temporary file(s)` });
  }

  // ── OOM 治本（2026-09-27）：掃掉本 run bash 殘留的背景 process（同 runAgentLoop）──
  try {
    const _swept = await sweepRunProcesses(_runId, { reason: `run-end ${agentId || "agent"}` });
    if (_swept.length > 0) {
      console.log(`[AgentLoopStream] 🧹 殘留背景程序掃除 ×${_swept.length}（run=${_runId}）：${_swept.map((s) => String(s.command).slice(0, 50)).join(" | ")}`);
      sendSSE("info", { message: `🧹 已清理 ${_swept.length} 個殘留背景程序` });
    }
  } catch (e) { console.error("[AgentLoopStream] proc-ledger sweep error:", e.message); }

  sendSSE("done", { turns, durationMs: Date.now() - startTime });

  // ── Finalize execution log ──
  await _logger.end({
    turns,
    status: abortSignal?.aborted ? "interrupted" : "completed",
  });
}

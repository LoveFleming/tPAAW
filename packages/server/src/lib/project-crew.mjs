/**
 * project-crew.mjs — Per-Project AI Crew Manager
 *
 * Each Code Project gets its own crew copy in {project}/.paaw/agents/.
 * Global crew (data/crews/coding.*.json) is the template.
 * Project crew overrides global, custom agents extend.
 *
 * Directory layout:
 *   {project}/.paaw/agents/
 *     _config.json              ← crew-level config (models, skills, auto dispatch)
 *     coding.architect.json     ← copied from global, can be edited
 *     coding.developer.json
 *     custom.reviewer.json      ← new custom agent
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { DATA_HOME } from "../data-home.mjs";
import { hashObject } from "./stable-hash.mjs"; // 2026-09-05：模板跟版 hash
import { readRuSkillContent, provisionRuSkills } from "./ru-skills.mjs"; // 2026-09-05：Skill Instance Model — skills 是 RU 資產

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

// Resolve global crews directory
// lib/ → src/ → server/ → packages/ → root = 4 levels up
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");
const GLOBAL_CREWS_DIR = join(DATA_HOME, "crews");

// Default crew IDs (the 6 coding agents + EM)
const DEFAULT_CREW_IDS = [
  "coding.architect",
  "coding.developer",
  "coding.tester",
  "coding.doc-writer",
  "coding.qa",
  "coding.helpdesk",
];

// EM is special — included in dispatch list but not in regular crew chat list
const EM_CREW_ID = "coding.em";

// ── Config schema ──

const DEFAULT_CONFIG = {
  version: 1,
  initialized: false,
  initializedAt: null,
  globalCrewIds: [...DEFAULT_CREW_IDS],
  customAgents: [],
  models: {},        // { "coding.architect": { "primary": "", "fallbacks": [], "emModel": "", "autoDispatchModel": "" } }
  skillBindings: {}, // { "coding.architect": ["skill-id-1", "skill-id-2"] }
  contextOverrides: {}, // { "coding.architect": { "injectProjectContext": true, "extraContext": "" } }
};

// ── CU step 預設 skills（2026-09-04 Fleming：CU 預設帶入合適的 PAAW skill）──
// 只在專案「沒設過」該 step 綁定時生效（undefined → 用預設；設 [] = 使用者清空，尊重）
// 對應 data/skills/physical-skill/ 內的方法論 skill
export const DEFAULT_CU_STEP_SKILLS = {
  scan: ["spec-miner"],                  // 掃專案結構 → 從 code 挖 spec/行為
  "feature-map": ["feature-map-master"], // feature → 檔案映射（同方法論）
  // 註：code-intelligence / test-intelligence 是機械步（Tree-sitter 純分析，不跑 LLM）
  // → skill 綁了也不會被用到，不設預設（2026-09-04 實測確認）
};

// ── Helpers ──

function ensureAgentsDir(projectDir) {
  const agentsDir = join(projectDir, ".paaw", "agents");
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true });
  }
  return agentsDir;
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function getConfigPath(projectDir) {
  return join(projectDir, ".paaw", "agents", "_config.json");
}

function getAgentPath(projectDir, agentId) {
  return join(projectDir, ".paaw", "agents", `${agentId}.json`);
}

function readGlobalCrew(crewId) {
  const filePath = join(GLOBAL_CREWS_DIR, `${crewId}.json`);
  return readJson(filePath, null);
}

function listGlobalCrewIds() {
  try {
    const files = readdirSync(GLOBAL_CREWS_DIR);
    return files
      .filter(f => f.endsWith(".json") && !f.startsWith("_"))
      .map(f => f.replace(/\.json$/, ""))
      .filter(id => id.startsWith("coding.") && id !== EM_CREW_ID);
  } catch {
    return [...DEFAULT_CREW_IDS];
  }
}

// ── Public API ──

/**
 * Initialize project crew from global templates.
 * Copies all coding.*.json (except EM) to {project}/.paaw/agents/
 * Creates _config.json with defaults.
 *
 * @param {string} projectDir - absolute path to project root
 * @param {object} opts - { force: boolean }
 * @returns {object} { ok, crewCount, agents: [...] }
 */
export function initProjectCrew(projectDir, opts = {}) {
  const { force = false } = opts;
  const agentsDir = ensureAgentsDir(projectDir);
  const configPath = getConfigPath(projectDir);

  // Check if already initialized
  const existingConfig = readJson(configPath, null);
  if (existingConfig?.initialized && !force) {
    return {
      ok: true,
      alreadyExists: true,
      message: "Project crew already initialized",
      crewCount: existingConfig.globalCrewIds.length + existingConfig.customAgents.length,
    };
  }

  // Copy global crew files
  const globalIds = listGlobalCrewIds();
  const copied = [];
  for (const crewId of globalIds) {
    const globalDef = readGlobalCrew(crewId);
    if (!globalDef) continue;
    // Write a copy (without modifying original)
    const destPath = getAgentPath(projectDir, crewId);
    if (!existsSync(destPath) || force) {
      writeJson(destPath, { ...globalDef, _source: "global", _clonedAt: new Date().toISOString(), _templateHash: hashObject(_cleanDeep(globalDef)) });
    }
    copied.push(crewId);
  }

  // Also copy EM (needed for dispatch, but not in regular crew chat list)
  const emDef = readGlobalCrew(EM_CREW_ID);
  if (emDef) {
    const emPath = getAgentPath(projectDir, EM_CREW_ID);
    if (!existsSync(emPath) || force) {
      writeJson(emPath, { ...emDef, _source: "global", _clonedAt: new Date().toISOString(), _templateHash: hashObject(_cleanDeep(emDef)) });
    }
  }

  // 2026-09-04：預設帶入 skills — 各 crew 模板的 skillIds 自動 seed 到 skillBindings
  // （使用者已自訂過的綁定（含清空 []）不覆蓋；skill 內容由 readProjectSkills 從 data/skills 即時讀）
  const skillBindings = { ...((existingConfig && existingConfig.skillBindings) || {}) };
  for (const crewId of [...copied, EM_CREW_ID]) {
    if (skillBindings[crewId] !== undefined) continue;
    const def = readGlobalCrew(crewId);
    if (Array.isArray(def?.skillIds) && def.skillIds.length > 0) {
      skillBindings[crewId] = [...def.skillIds];
    }
  }

  // Create/update config
  const config = {
    ...DEFAULT_CONFIG,
    initialized: true,
    initializedAt: new Date().toISOString(),
    globalCrewIds: copied,
    skillBindings,
  };
  writeJson(configPath, config);

  // 2026-09-05 Skill Instance Model：綁定的 skills 同時 clone 進 {ru}/.paaw/skills/
  provisionRuSkills(projectDir, Object.values(skillBindings).flat());

  return {
    ok: true,
    alreadyExists: false,
    message: `Initialized crew with ${copied.length} agents`,
    crewCount: copied.length,
    agents: copied,
  };
}

/**
 * Add-only sync — global coding.* crews added after project initialization
 * (e.g. coding.ops / coding.handover / coding.rm) automatically join the
 * project crew. Never removes anything; project overrides & custom agents
 * are untouched. Persists new ids + copies template to project layer once.
 */
function _cleanDeep(obj) {
  if (Array.isArray(obj)) return obj.map(_cleanDeep);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (!k.startsWith("_")) out[k] = _cleanDeep(v);
    return out;
  }
  return obj;
}

/** 2026-09-05：全域模板跟版 — 專案副本未客製化（內容 hash == 種入模板 hash）時自動更新為新版模板。
 *  沒有 _templateHash 的舊種子：與現行全域相同就補 hash 對齊；不同 = 視為客製化，不動。 */
function syncUpdatedGlobalCrews(projectDir, config) {
  try {
    for (const crewId of config.globalCrewIds || []) {
      const projectPath = getAgentPath(projectDir, crewId);
      const globalDef = readGlobalCrew(crewId);
      if (!globalDef || !existsSync(projectPath)) continue;
      const proj = readJson(projectPath, null);
      if (!proj || proj._source !== "global") continue;
      const curHash = _cleanDeep(proj) && hashObject(_cleanDeep(proj));
      const newHash = hashObject(_cleanDeep(globalDef));
      if (!proj._templateHash) {
        if (curHash === newHash) writeJson(projectPath, { ...proj, _templateHash: newHash, _syncedAt: new Date().toISOString() });
        continue;
      }
      if (curHash === proj._templateHash && proj._templateHash !== newHash) {
        writeJson(projectPath, { ...globalDef, _source: "global", _templateHash: newHash, _syncedAt: new Date().toISOString() });
      }
    }
  } catch { /* 模板跟版失敗不擋讀取 */ }
}

function syncNewGlobalCrews(projectDir, config) {
  let globalIds;
  try {
    globalIds = listGlobalCrewIds();
  } catch {
    return config;
  }
  const known = new Set([...(config.globalCrewIds || []), ...(config.customAgents || [])]);
  const missing = globalIds.filter(id => !known.has(id));
  if (missing.length === 0) return config;

  ensureAgentsDir(projectDir);
  const added = [];
  for (const crewId of missing) {
    const globalDef = readGlobalCrew(crewId);
    if (!globalDef) continue;
    const destPath = getAgentPath(projectDir, crewId);
    if (!existsSync(destPath)) {
      writeJson(destPath, { ...globalDef, _source: "global", _syncedAt: new Date().toISOString(), _templateHash: hashObject(_cleanDeep(globalDef)) });
    }
    added.push(crewId);
  }
  if (added.length === 0) return config;

  config.globalCrewIds = [...(config.globalCrewIds || []), ...added];
  config.models = config.models || {};
  for (const crewId of added) {
    if (!config.models[crewId]) {
      config.models[crewId] = { primary: "", fallbacks: [], emModel: "", autoDispatchModel: "" };
    }
  }
  // 2026-09-04：新 sync 進來的 crew 也預設帶入模板 skillIds（使用者已自訂不覆蓋）
  config.skillBindings = config.skillBindings || {};
  for (const crewId of added) {
    if (config.skillBindings[crewId] !== undefined) continue;
    const def = readGlobalCrew(crewId);
    if (Array.isArray(def?.skillIds) && def.skillIds.length > 0) {
      config.skillBindings[crewId] = [...def.skillIds];
    }
  }
  writeJson(getConfigPath(projectDir), config);
  return config;
}

/**
 * Read full project crew — merge global defaults with project overrides.
 * Returns list of agents (excluding EM).
 * New global crews are auto-synced (add-only) so they appear in every
 * already-initialized project.
 *
 * @param {string} projectDir
 * @returns {object} { agents: [...], config: {...}, initialized: boolean }
 */
export function readProjectCrew(projectDir) {
  const configPath = getConfigPath(projectDir);
  let config = readJson(configPath, { ...DEFAULT_CONFIG });

  if (!config.initialized) {
    // Not initialized yet — auto-init from global
    initProjectCrew(projectDir);
    config = readJson(configPath, { ...DEFAULT_CONFIG });
  }

  const updatedConfig = syncNewGlobalCrews(projectDir, config);
  syncUpdatedGlobalCrews(projectDir, updatedConfig); // 2026-09-05：未客製化的專案副本自動跟全域模板新版
  const allIds = [...(updatedConfig.globalCrewIds || []), ...(updatedConfig.customAgents || [])];

  const agents = [];
  for (const agentId of allIds) {
    // Project layer takes priority
    const projectAgent = readJson(getAgentPath(projectDir, agentId), null);
    if (projectAgent) {
      agents.push(stripInternal(projectAgent));
    } else {
      // Fallback to global
      const globalAgent = readGlobalCrew(agentId);
      if (globalAgent) {
        agents.push(stripInternal(globalAgent));
      }
    }
  }

  return {
    agents,
    config: updatedConfig,
    initialized: updatedConfig.initialized || false,
  };
}

/**
 * Read a single agent definition.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @returns {object|null} agent definition or null
 */
export function readProjectAgent(projectDir, agentId) {
  // Project layer first
  const projectAgent = readJson(getAgentPath(projectDir, agentId), null);
  if (projectAgent) return stripInternal(projectAgent);

  // Fallback to global
  const globalAgent = readGlobalCrew(agentId);
  if (globalAgent) return stripInternal(globalAgent);

  return null;
}

/**
 * Update an existing agent (project layer override).
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @param {object} patch — { rolePrompt?, codename?, description?, emoji?, ... }
 * @returns {object} updated agent
 */
export function updateProjectAgent(projectDir, agentId, patch) {
  ensureAgentsDir(projectDir);

  // Read current (project or global)
  const current = readJson(getAgentPath(projectDir, agentId), null) || readGlobalCrew(agentId);
  if (!current) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Merge patch
  const updated = { ...current, ...patch, id: agentId, _source: current._source || "global", _updatedAt: new Date().toISOString() };

  // Write to project layer
  writeJson(getAgentPath(projectDir, agentId), updated);

  return stripInternal(updated);
}

/**
 * Create a new custom agent.
 *
 * @param {string} projectDir
 * @param {object} def — { id, codename, title, emoji, rolePrompt, description, expertise, ... }
 * @returns {object} created agent
 */
export function createCustomAgent(projectDir, def) {
  ensureAgentsDir(projectDir);

  // Validate ID
  const agentId = def.id || def.agentId;
  if (!agentId) throw new Error("Agent ID is required");
  if (!agentId.startsWith("custom.")) {
    throw new Error('Custom agent ID must start with "custom."');
  }

  // Check if already exists
  const existing = readJson(getAgentPath(projectDir, agentId), null);
  if (existing) {
    throw new Error(`Agent already exists: ${agentId}`);
  }

  // Build agent definition
  const agent = {
    id: agentId,
    title: def.title || def.codename || "Custom Agent",
    codename: def.codename || def.title || "Custom Agent",
    emoji: def.emoji || "🤖",
    rolePrompt: def.rolePrompt || `You are ${def.codename || "a custom AI agent"}.`,
    description: def.description || "",
    expertise: def.expertise || "",
    injectProjectContext: def.injectProjectContext ?? true,
    chatConfig: def.chatConfig || { greeting: `Hi! I'm ${def.codename || "a custom agent"} 🤖`, maxTokens: 4096, temperature: 0.4 },
    toolGroups: def.toolGroups || ["core-read", "memory", "project"],
    guardrails: def.guardrails || {},
    _source: "custom",
    _createdAt: new Date().toISOString(),
  };

  if (def.imageUrl) agent.imageUrl = def.imageUrl;

  // Write agent file
  writeJson(getAgentPath(projectDir, agentId), agent);

  // Update config
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });
  if (!config.customAgents.includes(agentId)) {
    config.customAgents.push(agentId);
  }
  // Initialize model entry
  if (!config.models[agentId]) {
    config.models[agentId] = { primary: "", fallbacks: [], emModel: "", autoDispatchModel: "" };
  }
  writeJson(configPath, config);

  return stripInternal(agent);
}

/**
 * Delete a custom agent. Default agents (coding.*) cannot be deleted.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @returns {object} { ok, deletedId }
 */
export function deleteCustomAgent(projectDir, agentId) {
  if (!agentId.startsWith("custom.")) {
    throw new Error("Only custom agents can be deleted");
  }

  const agentPath = getAgentPath(projectDir, agentId);
  if (!existsSync(agentPath)) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  rmSync(agentPath);

  // Update config
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });
  config.customAgents = (config.customAgents || []).filter(id => id !== agentId);
  delete config.models[agentId];
  delete config.skillBindings[agentId];
  delete config.contextOverrides[agentId];
  writeJson(configPath, config);

  return { ok: true, deletedId: agentId };
}

/**
 * Reset an agent to its global default (removes project override).
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @returns {object} reset agent
 */
export function resetProjectAgent(projectDir, agentId) {
  const globalDef = readGlobalCrew(agentId);
  if (!globalDef) {
    throw new Error(`No global definition for: ${agentId}`);
  }

  const agentPath = getAgentPath(projectDir, agentId);
  const reset = { ...globalDef, _source: "global", _resetAt: new Date().toISOString() };
  writeJson(agentPath, reset);

  // Clear model/skill overrides for this agent
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });
  if (config.models[agentId]) {
    config.models[agentId] = { primary: "", fallbacks: [], emModel: "", autoDispatchModel: "" };
  }
  delete config.skillBindings[agentId];
  delete config.contextOverrides[agentId];
  writeJson(configPath, config);

  return stripInternal(reset);
}

/**
 * Update per-agent model configuration.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @param {object} modelConfig — { primary?, fallbacks?, emModel?, autoDispatchModel? }
 * @returns {object} updated model config for this agent
 */
export function updateAgentModel(projectDir, agentId, modelConfig) {
  ensureAgentsDir(projectDir);
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });

  if (!config.models[agentId]) {
    config.models[agentId] = { primary: "", fallbacks: [], emModel: "", autoDispatchModel: "" };
  }

  // Merge patch
  const current = config.models[agentId];
  if (modelConfig.primary !== undefined) current.primary = modelConfig.primary;
  if (modelConfig.fallbacks !== undefined) current.fallbacks = modelConfig.fallbacks;
  if (modelConfig.emModel !== undefined) current.emModel = modelConfig.emModel;
  if (modelConfig.autoDispatchModel !== undefined) current.autoDispatchModel = modelConfig.autoDispatchModel;

  writeJson(configPath, config);

  return current;
}

/**
 * Update per-agent skill bindings.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @param {string[]} skillIds — list of skill IDs to bind
 * @returns {object} { agentId, skills: skillIds }
 */
export function updateAgentSkills(projectDir, agentId, skillIds) {
  ensureAgentsDir(projectDir);
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });

  config.skillBindings[agentId] = skillIds || [];
  writeJson(configPath, config);

  // 2026-09-05：新綁的 skills 同步 clone 進 RU（Skill Instance Model）
  provisionRuSkills(projectDir, skillIds || []);

  return { agentId, skills: skillIds || [] };
}

/**
 * Resolve the model to use for a specific agent in a specific context.
 * Falls back through: per-agent → per-project default → global default.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @param {string} context — "interactive" | "em" | "autoDispatch"
 * @param {string} globalDefault — global default model
 * @returns {string|null} model ID or null (use global default)
 */
export function resolveAgentModel(projectDir, agentId, context = "interactive", globalDefault = "") {
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });
  const agentModels = config.models?.[agentId];

  if (!agentModels) return globalDefault || null;

  if (context === "em") {
    return agentModels.emModel || agentModels.primary || globalDefault || null;
  }
  if (context === "autoDispatch") {
    return agentModels.autoDispatchModel || agentModels.primary || globalDefault || null;
  }
  // interactive
  return agentModels.primary || globalDefault || null;
}

/**
 * Resolve fallback models for a specific agent.
 *
 * @param {string} projectDir
 * @param {string} agentId
 * @param {string[]} globalFallbacks
 * @returns {string[]} fallback model IDs
 */
export function resolveAgentFallbacks(projectDir, agentId, globalFallbacks = []) {
  const configPath = getConfigPath(projectDir);
  const config = readJson(configPath, { ...DEFAULT_CONFIG });
  const agentModels = config.models?.[agentId];
  if (agentModels?.fallbacks && agentModels.fallbacks.length > 0) {
    return agentModels.fallbacks;
  }
  return globalFallbacks;
}

/**
 * Get list of agent IDs available for EM dispatch.
 * Includes all crew agents (no EM itself).
 *
 * @param {string} projectDir
 * @returns {string[]} agent IDs
 */
export function getDispatchableAgents(projectDir) {
  const { agents, config } = readProjectCrew(projectDir);
  let result = agents
    .filter(a => a.id !== EM_CREW_ID)
    .map(a => ({
      id: a.id,
      codename: a.codename,
      title: a.title,
      emoji: a.emoji,
      expertise: a.expertise || a.description || "",
    }));

  // ── Apply EM config constraints (dispatchableAgents / blockedAgents) ──
  try {
    const emConfigPath = join(projectDir, '.paaw', 'em', 'config.json');
    if (existsSync(emConfigPath)) {
      const emConfig = JSON.parse(readFileSync(emConfigPath, 'utf-8'));
      const { dispatchableAgents = [], blockedAgents = [] } = emConfig;
      if (blockedAgents.length > 0) {
        result = result.filter(a => !blockedAgents.includes(a.id));
      }
      if (dispatchableAgents.length > 0) {
        result = result.filter(a => dispatchableAgents.includes(a.id));
      }
    }
  } catch { /* config read error, skip filtering */ }

  return result;
}

/**
 * Get EM agent definition (from project or global).
 *
 * @param {string} projectDir
 * @returns {object|null} EM agent definition
 */
export function readEMAgent(projectDir) {
  const projectEM = readJson(getAgentPath(projectDir, EM_CREW_ID), null);
  if (projectEM) return stripInternal(projectEM);
  return readGlobalCrew(EM_CREW_ID);
}

// ── Internal helpers ──

function stripInternal(agent) {
  const { _source, _clonedAt, _updatedAt, _createdAt, _resetAt, _syncedAt, _templateHash, ...rest } = agent;
  return {
    ...rest,
    _source: _source || "global",
  };
}

/** 2026-09-05：這個 RU 全部會用到的 skill ids — 啓動遷移/狀態 UI 用。
 *  skillBindings（權威）+ CU 步驟預設 + crew 模板自帶 skillIds（未 init 的 RU fallback）。 */
export function allBoundSkillIds(projectDir) {
  const ids = new Set();
  const push = arr => { if (Array.isArray(arr)) for (const id of arr) if (id) ids.add(id); };

  const config = readJson(getConfigPath(projectDir), null);
  if (config?.skillBindings) for (const v of Object.values(config.skillBindings)) push(v);
  for (const v of Object.values(DEFAULT_CU_STEP_SKILLS)) push(v);

  // crew 模板 skillIds（專案未 init 或模板更新加料時的 fallback）
  try {
    for (const crewId of listGlobalCrewIds()) {
      push(readGlobalCrew(crewId)?.skillIds);
    }
    push(readGlobalCrew(EM_CREW_ID)?.skillIds);
  } catch { /* 全域模板讀不到不擋 */ }
  return [...ids];
}

// ── Skill prompt injection ──

/**
 * Read skill prompts for a specific agent from project skillBindings.
 *
 * @param {string} projectDir
 * @param {string} crewId - e.g. "coding.architect"
 * @returns {Array<{id: string, name: string, prompt: string}>}
 */
export function readProjectSkills(projectDir, crewId) {
  const config = readJson(getConfigPath(projectDir), null);

  let skillIds = config?.skillBindings?.[crewId];
  // 2026-09-04：CU step 沒設過綁定 → 套預設 skills（使用者清空 [] 則尊重不回填）
  // 專案尚未 init（無 _config.json）也套預設 — CU 不該因為 crew 還沒初始化就失去方法論
  if (skillIds === undefined && crewId?.startsWith("cu.")) {
    skillIds = DEFAULT_CU_STEP_SKILLS[crewId.slice(3)] || [];
  }
  if (!Array.isArray(skillIds) || skillIds.length === 0) return [];

  const results = [];
  for (const skillId of skillIds) {
    // 2026-09-05：單一解析路徑 — skill 只從 {ru}/.paaw/skills/ 讀（RU 資產）
    const skillData = readRuSkillContent(projectDir, skillId);
    if (skillData) {
      let prompt = skillData.prompt;
      // 附上目錄內其他檔案路徑，agent 需要時用 read_file 讀取
      if (skillData.skillDir) {
        const files = listSkillFiles(skillData.skillDir);
        if (files.length > 0) {
          prompt += `\n\n---\n\n## 技能附件檔案（需要時用 read_file 讀取）\n${files.map(f => `- ${f}`).join("\n")}`;
        }
      }
      results.push({ id: skillId, name: skillData.name, prompt, path: skillData.skillDir || null });
    }
  }
  return results;
}

/** 技能目錄掃描：列出 skill 目錄內所有檔案路徑（供 agent read_file 用）
 *  SKILL.md 本身已展開；其餘檔案列絕對路徑，agent 需要時再讀 */
function listSkillFiles(skillDir) {
  const SKIP_FILES = new Set(["SKILL.md", "_cron_inputs.json", "_paaw.json"]);
  const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|zip|pdf|woff2?|ttf|eot|mp4|mp3|wav)$/i;
  const SKIP_DIRS = new Set([".git", "node_modules"]);
  const files = [];
  (function walk(d, rel) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(p, r);
      } else {
        if (SKIP_FILES.has(e.name) || BINARY_EXT.test(e.name)) continue;
        files.push(p); // 絕對路徑
      }
    }
  })(skillDir, "");
  return files;
}

/**
 * Read a skill's prompt content from data/skills/ directories.
 * Tries physical-skill first (SKILL.md), then input-prompt (inputs.json).
 * SKILL.md 展開 = body + 目錄內所有文字檔案（rules/references/templates）
 */
// 2026-09-05：readSkillContent（全域單例讀取）已移除 — Skill Instance Model 上線後
// 唯一解析路徑是 ru-skills.readRuSkillContent（{ru}/.paaw/skills/），全域 catalog 只是上游模板。

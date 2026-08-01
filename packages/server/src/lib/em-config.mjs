/**
 * em-config.mjs — EM (Engineering Manager) Configuration Manager
 *
 * EM is an orchestrator, not a regular crew agent.
 * This module manages EM-specific dispatch strategy, auto-execute rules,
 * task decomposition settings, and reporting preferences.
 *
 * Config is stored per-project at: {project}/.paaw/em/config.json
 *
 * Base prompt / avatar / greeting still come from coding.em.json (crew format).
 * This layer only controls orchestration behavior.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Default EM Config ──

const DEFAULT_EM_CONFIG = {
  version: 1,

  // Dispatch strategy: how aggressive EM is
  dispatchStrategy: "balanced",
  // conservative = plan only, wait for human approval at every step
  // balanced     = plan → confirm → execute (current default)
  // aggressive   = receive goal → do everything → report when done

  // Auto-execute rules: which categories of work EM can auto-run without asking
  autoExecute: {
    tests: true,           //補測試可以自動跑
    docs: true,            // 寫文件可以自動跑
    refactor: false,       // 重構要問人
    securityFix: false,    // 安全修復要問人
    breakingChange: false, // 破壞性變更一定要問
  },

  // Task decomposition settings
  taskDecomposition: {
    maxSubtasks: 10,        // 一次最多拆幾個子任務
    defaultEffort: "S",    // 子任務預設 effort (XS/S/M/L/XL)
    requireEstimate: true, // 拆完是否要附估時
  },

  // Reporting format
  reporting: {
    format: "summary",         // summary | detailed | executive
    includeCodeChanges: true,  // 報告要不要附 code diff 摘要
    includeActionLog: true,    // 包含 action log 摘要
  },

  // Per-context model overrides (empty = use global default)
  model: {
    planning: "",   // Model for planEMSession (should be smart)
    dispatch: "",   // Model for dispatch calls (can be cheaper)
  },

  // Agent dispatch constraints
  dispatchableAgents: [],  // empty = all available; otherwise restrict to these IDs
  blockedAgents: [],       // never dispatch to these agents

  // Planning scope: what EM considers when planning
  planningScope: {
    gitChanges: true,
    openIssues: true,
    openTasks: true,
    securityFindings: true,
    codeIntelligence: false,  // heavy, off by default
    testCoverage: true,
  },
};

// ── Helpers ──

function getEMConfigPath(projectDir) {
  return join(projectDir, ".paaw", "em", "config.json");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const dir = resolve(filePath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// Deep merge helper
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === "object" && !Array.isArray(source[key])
      && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

// ── Public API ──

/**
 * Read EM config for a project. Returns merged defaults + stored overrides.
 * @param {string} projectDir - absolute path to project root
 * @returns {object} merged EM config
 */
export function readEMConfig(projectDir) {
  const configPath = getEMConfigPath(projectDir);

  // Auto-initialize if not exists
  if (!existsSync(configPath)) {
    const dir = join(projectDir, ".paaw", "em");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeJson(configPath, DEFAULT_EM_CONFIG);
  }

  const stored = readJson(configPath, null);
  if (!stored) return { ...DEFAULT_EM_CONFIG };

  return deepMerge(DEFAULT_EM_CONFIG, stored);
}

/**
 * Update EM config (partial patch, deep merged).
 * @param {string} projectDir
 * @param {object} patch - partial config to merge
 * @returns {object} updated full config
 */
export function updateEMConfig(projectDir, patch) {
  const current = readEMConfig(projectDir);
  const merged = deepMerge(current, patch);
  writeJson(getEMConfigPath(projectDir), merged);
  return merged;
}

/**
 * Reset EM config to defaults.
 * @param {string} projectDir
 * @returns {object} reset config
 */
export function resetEMConfig(projectDir) {
  writeJson(getEMConfigPath(projectDir), DEFAULT_EM_CONFIG);
  return { ...DEFAULT_EM_CONFIG };
}

/**
 * Resolve which model EM should use for a given context.
 * @param {string} projectDir
 * @param {string} context - "planning" | "dispatch" | "interactive"
 * @param {string} globalDefault
 * @returns {string|null}
 */
export function resolveEMModel(projectDir, context = "interactive", globalDefault = "") {
  const config = readEMConfig(projectDir);
  if (context === "planning" && config.model?.planning) {
    return config.model.planning;
  }
  if (context === "dispatch" && config.model?.dispatch) {
    return config.model.dispatch;
  }
  return globalDefault || null;
}

/**
 * Filter dispatchable agents based on EM config constraints.
 * @param {string} projectDir
 * @param {Array<{id: string, ...}>} agents - all available agents
 * @returns {Array} filtered agents
 */
export function filterDispatchableAgents(projectDir, agents) {
  const config = readEMConfig(projectDir);
  const { dispatchableAgents, blockedAgents } = config;

  return agents.filter(a => {
    // Remove blocked agents
    if (blockedAgents.includes(a.id)) return false;
    // If dispatchableAgents is specified, only allow those
    if (dispatchableAgents.length > 0 && !dispatchableAgents.includes(a.id)) return false;
    return true;
  });
}

/**
 * Check if a work category can be auto-executed.
 * @param {string} projectDir
 * @param {string} category - "tests" | "docs" | "refactor" | "securityFix" | "breakingChange"
 * @returns {boolean}
 */
export function canAutoExecute(projectDir, category) {
  const config = readEMConfig(projectDir);
  return config.autoExecute?.[category] ?? false;
}

export { DEFAULT_EM_CONFIG };

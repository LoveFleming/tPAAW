/**
 * Domain Agent Registry — Coding A2A 的核心調度層
 *
 * 每個 domain agent 在這裡註冊：
 *   - crewId（對應 data/crews/*.json）
 *   - agentId（URL path identifier，如 "architect"、"helpdesk"）
 *   - contextProviders（dispatch 時要載入哪些 context）
 *   - tools（agent 可用的工具）
 *   - maxTurns（agent loop 最大輪數）
 *
 * 外部 A2A route 和內部 /api/coding-crew/chat 都透過這裡 dispatch。
 */

import { readFile } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");
const CREWS_DIR = resolve(PAAW_ROOT, "data", "crews");

// ── Crew cache ──
const _crewCache = {};

async function loadCrew(crewId) {
  if (_crewCache[crewId]) return _crewCache[crewId];
  const crewFile = join(CREWS_DIR, `${crewId}.json`);
  if (!existsSync(crewFile)) return null;
  try {
    const crew = JSON.parse(readSync(crewFile, "utf-8"));
    _crewCache[crewId] = crew;
    return crew;
  } catch (err) {
    console.error(`[DomainAgent] Failed to load crew ${crewId}:`, err.message);
    return null;
  }
}

/** Clear crew cache (for hot-reload during dev) */
export function clearCrewCache() {
  for (const k of Object.keys(_crewCache)) delete _crewCache[k];
}

// ── Agent Card Builder ──

export function buildAgentCard(agentId, req) {
  const agent = DOMAIN_AGENTS[agentId];
  if (!agent) return null;

  const host = req.headers.host || `localhost:${process.env.PAAW_PORT || 4097}`;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const baseUrl = `${protocol}://${host}`;

  return {
    protocolVersion: "0.3.0",
    name: agent.name,
    description: agent.description,
    url: `${baseUrl}/a2a/${agentId}`,
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: agent.skills || [],
    authentication: { schemes: ["none"] },
  };
}

// ── Domain Agent Definitions ──

const DOMAIN_AGENTS = {
  architect: {
    agentId: "architect",
    crewId: "coding.architect",
    name: "林曉薇 架構師",
    description: "Architecture/Risk Agent — 分析架構、制定技術決策、規劃模組邊界",
    contextProviders: ["project", "decisions"],
    tools: null, // null = use default agent loop tools (read_file, write_file, etc.)
    maxTurns: 30,
    skills: [
      {
        id: "architect-review",
        name: "架構審查",
        description: "分析現有架構，找出設計缺陷和改進空間",
        tags: ["architecture", "review", "adr"],
      },
      {
        id: "architect-decide",
        name: "技術決策",
        description: "制定技術決策並記錄 ADR",
        tags: ["architecture", "decision", "adr"],
      },
      {
        id: "architect-plan",
        name: "架構規劃",
        description: "規劃模組邊界、依賴關係、分層策略",
        tags: ["architecture", "planning"],
      },
    ],
  },

  helpdesk: {
    agentId: "helpdesk",
    crewId: "coding.helpdesk",
    name: "小春 林 Helpdesk",
    description: "Helpdesk/Support Agent — 解決技術問題、排查 bug、操作指引",
    contextProviders: ["helpdesk"],
    tools: null,
    maxTurns: 20,
    skills: [
      {
        id: "helpdesk-support",
        name: "技術支援",
        description: "解決技術問題、排查錯誤、提供修復建議",
        tags: ["support", "debug", "faq"],
      },
      {
        id: "helpdesk-guide",
        name: "操作指引",
        description: "引導使用者完成系統設定和配置",
        tags: ["support", "guide", "setup"],
      },
    ],
  },

  developer: {
    agentId: "developer",
    crewId: "coding.developer",
    name: "普里亞·夏爾馬 Developer",
    description: "Coding Agent — 實作功能、修 bug、refactor、全端開發",
    contextProviders: ["project", "decisions"],
    tools: null,
    maxTurns: 30,
    skills: [
      {
        id: "dev-implement",
        name: "功能實作",
        description: "根據需求實作新功能、API、UI組件",
        tags: ["coding", "implementation", "feature"],
      },
      {
        id: "dev-fix",
        name: "Bug 修復",
        description: "排查、定位、修復程式 bug",
        tags: ["coding", "bugfix", "debug"],
      },
      {
        id: "dev-refactor",
        name: "重構",
        description: "改善程式碼結構、可讀性、效能",
        tags: ["coding", "refactor", "quality"],
      },
    ],
  },

  tester: {
    agentId: "tester",
    crewId: "coding.tester",
    name: "迪維雅·雷迪 Test Agent",
    description: "Test Agent — 撰寫測試、執行測試、回報結果",
    contextProviders: ["project", "decisions"],
    tools: null,
    maxTurns: 20,
    skills: [
      {
        id: "test-write",
        name: "撰寫測試",
        description: "根據功能邏輯撰寫單元測試、整合測試、E2E 測試",
        tags: ["test", "unit", "integration", "e2e"],
      },
      {
        id: "test-run",
        name: "執行測試",
        description: "跑測試套件、分析覆蓋率、回報失敗",
        tags: ["test", "run", "coverage"],
      },
    ],
  },

  doc_writer: {
    agentId: "doc-writer",
    crewId: "coding.doc-writer",
    name: "梅根·布魯克斯 Document Agent",
    description: "Document Agent — 撰寫 README、API docs、changelog、架構文件",
    contextProviders: ["project", "decisions"],
    tools: null,
    maxTurns: 20,
    skills: [
      {
        id: "doc-readme",
        name: "撰寫 README",
        description: "撰寫和更新專案 README",
        tags: ["doc", "readme"],
      },
      {
        id: "doc-changelog",
        name: "更新 Changelog",
        description: "根據 git log 和 action log 更新 changelog",
        tags: ["doc", "changelog"],
      },
    ],
  },

  qa: {
    agentId: "qa",
    crewId: "coding.qa",
    name: "武大安 QA Agent",
    description: "QA Agent — Code Review、測試覆蓋率、規格驗證、品質閘門",
    contextProviders: ["project", "decisions"],
    tools: null,
    maxTurns: 25,
    skills: [
      {
        id: "qa-review",
        name: "Code Review",
        description: "審查程式碼品質、找出潛在問題",
        tags: ["qa", "review", "quality"],
      },
      {
        id: "qa-coverage",
        name: "覆蓋率分析",
        description: "分析測試覆蓋率、找出未覆蓋的路徑",
        tags: ["qa", "coverage", "test"],
      },
    ],
  },
};

// ── Public API ──

/** Get agent definition by agentId */
export function getAgent(agentId) {
  return DOMAIN_AGENTS[agentId] || null;
}

/** List all registered agents */
export function listAgents() {
  return Object.values(DOMAIN_AGENTS);
}

/** Resolve agentId from crewId (for internal dispatch) */
export function getAgentByCrewId(crewId) {
  for (const agent of Object.values(DOMAIN_AGENTS)) {
    if (agent.crewId === crewId) return agent;
  }
  return null;
}

/** Load crew data (rolePrompt, chatConfig, etc.) */
export async function getCrewData(crewId) {
  return loadCrew(crewId);
}

/**
 * Build system prompt for an agent — crew rolePrompt + context providers
 * @param {string} agentId
 * @param {Object} opts - { cwd, clientContext }
 * @returns {Promise<string>}
 */
export async function buildSystemPrompt(agentId, opts = {}) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Unknown agent: ${agentId}`);

  const crew = await loadCrew(agent.crewId);
  if (!crew) throw new Error(`Crew not found: ${agent.crewId}`);

  const parts = [];

  // 1. Crew rolePrompt
  if (crew.rolePrompt) parts.push(crew.rolePrompt);

  // 2. Context from providers
  const { contextProviders = {} } = await import("./context-providers.mjs");
  for (const providerName of agent.contextProviders) {
    const provider = contextProviders[providerName];
    if (!provider) continue;
    try {
      const ctx = await provider(opts);
      if (ctx) {
        for (const [key, value] of Object.entries(ctx)) {
          if (value) parts.push(`\n## ${key}\n${value}`);
        }
      }
    } catch (err) {
      console.error(`[DomainAgent] Context provider "${providerName}" error:`, err.message);
    }
  }

  // 3. Client context (from UI — active file, selected text)
  if (opts.clientContext?.activeFile) {
    parts.push(`\n## 目前開啟的檔案\n${opts.clientContext.activeFile}`);
    if (opts.clientContext.activeFileContent) {
      parts.push(`\n\`\`\`\n${opts.clientContext.activeFileContent.slice(0, 3000)}\n\`\`\``);
    }
  }

  return parts.join("\n\n");
}

export { DOMAIN_AGENTS };

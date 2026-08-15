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
import { SECURITY_RULES } from "./security-rules.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");
const CREWS_DIR = resolve(PAAW_ROOT, "data", "crews");

// ── Crew cache (keyed by crewId only; project overrides merged at call time) ──
const _crewCache = {};

async function loadCrew(crewId, projectDir = null) {
  // Always read from cache or global file first
  let crew = _crewCache[crewId];
  if (!crew) {
    const crewFile = join(CREWS_DIR, `${crewId}.json`);
    if (!existsSync(crewFile)) return null;
    try {
      crew = JSON.parse(readSync(crewFile, "utf-8"));
      _crewCache[crewId] = crew;
    } catch (err) {
      console.error(`[DomainAgent] Failed to load crew ${crewId}:`, err.message);
      return null;
    }
  }
  if (!crew) return null;

  // If projectDir provided, check for project-level overrides
  if (projectDir) {
    const projectAgentPath = join(projectDir, ".paaw", "agents", `${crewId}.json`);
    if (existsSync(projectAgentPath)) {
      try {
        const projectOverride = JSON.parse(readSync(projectAgentPath, "utf-8"));
        // Deep merge: project fields override global fields
        return { ...crew, ...projectOverride, id: crewId };
      } catch {}
    }
  }

  return crew;
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
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null, // null = use default agent loop tools (read_file, write_file, etc.)

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
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,

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
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,

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

  "doc-writer": {
    agentId: "doc-writer",
    crewId: "coding.doc-writer",
    name: "梅根·布魯克斯 Document Agent",
    description: "Document Agent — 撰寫 README、API docs、changelog、架構文件",
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,

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
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,

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

  em: {
    agentId: "em",
    crewId: "coding.em",
    name: "陳哲宇 EM 大總管",
    description: "Engineering Manager — 工作規劃、團隊調度、品質把關、夜間自動調度",
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,
    maxTurns: 20,

    skills: [
      {
        id: "em-dispatch",
        name: "自動調度",
        description: "分析現況，規劃工作清單，派工給團隊",
        tags: ["em", "planning", "dispatch"],
      },
      {
        id: "em-report",
        name: "狀態報告",
        description: "讀取 action log 和 git status，報告專案現況",
        tags: ["em", "report", "status"],
      },
    ],
  },
  rm: {
    agentId: "rm",
    crewId: "coding.rm",
    name: "Release Manager 負責人",
    description: "Release Manager — 審證據不審碼，評估風險，批准/退回上線",
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,
    maxTurns: 15,
    skills: [
      {
        id: "rm-review",
        name: "證據審查",
        description: "讀取 release 證據包，評估是否可安全上線",
        tags: ["rm", "evidence", "risk"],
      },
      {
        id: "rm-risk",
        name: "風險評估",
        description: "分析變更的影響面與回滾方案",
        tags: ["rm", "risk", "rollback"],
      },
    ],
  },
  handover: {
    agentId: "handover",
    crewId: "coding.handover",
    name: "交接導覽員",
    description: "Handover Specialist — 讓新工程師或新 AI agent 快速接手 release unit",
    contextProviders: ["project", "decisions", "codeIntelligence"],
    tools: null,
    maxTurns: 15,
    skills: [
      {
        id: "handover-brief",
        name: "交接簡報",
        description: "產出專案全貌：做什麼、為什麼、現况、怎麼接手",
        tags: ["handover", "onboarding"],
      },
    ],
  },
  ops: {
    agentId: "ops",
    crewId: "coding.ops",
    name: "維運值班工程師",
    description: "Operations/Troubleshooting — runbook 維護、線上診斷、修復指引",
    contextProviders: ["project", "decisions"],
    tools: null,
    maxTurns: 15,
    skills: [
      {
        id: "ops-diagnose",
        name: "事故診斷",
        description: "讀 log 和 runbook，定位問題，給修復步驟",
        tags: ["ops", "diagnose", "runbook"],
      },
      {
        id: "ops-runbook",
        name: "Runbook 生成",
        description: "為常見事故生成可執行的排障指南",
        tags: ["ops", "runbook"],
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

  const projDir = opts.cwd ? resolve(opts.cwd) : null;
  const crew = await loadCrew(agent.crewId, projDir);
  if (!crew) throw new Error(`Crew not found: ${agent.crewId}`);

  const parts = [];

  // 0. Current date/time — so agents know what day it is
  const _now = new Date();
  const _dateStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
  const _weekday = ["日", "一", "二", "三", "四", "五", "六"][_now.getDay()];
  const _timeStr = `${String(_now.getHours()).padStart(2, "0")}:${String(_now.getMinutes()).padStart(2, "0")}`;
  parts.push(`=== 當前日期時間 ===\n今天是 ${_dateStr}（星期${_weekday}），時間 ${_timeStr}，時區 Asia/Taipei (UTC+8)`);

  // 0. If ai-settings/{agentId}/system-prompt.md exists, use it as base prompt
  const aiSettingsPromptPath = resolve(PAAW_ROOT, "data", "ai-settings", agentId, "system-prompt.md");
  if (existsSync(aiSettingsPromptPath)) {
    try {
      const promptText = readSync(aiSettingsPromptPath, "utf-8").trim();
      if (promptText) parts.push(promptText);
    } catch {}
  }

  // 1. Crew rolePrompt (fallback if no ai-settings prompt)
  if (crew.rolePrompt) parts.push(crew.rolePrompt);

  // 1b. Expertise & Guardrails (if defined separately on crew JSON)
  if (crew.expertise && crew.expertise.trim()) {
    parts.push(`\n## 專業範圍\n${crew.expertise.trim()}`);
  }
  if (crew.guardrails) {
    const g = crew.guardrails;
    const lines = [];
    if (g.redirectRules && g.redirectRules.trim()) {
      lines.push("\n### 轉介規則");
      lines.push(g.redirectRules.trim());
    }
    if (g.refuseTopics && g.refuseTopics.trim()) {
      lines.push("\n### 拒絕主題");
      lines.push(g.refuseTopics.trim());
    }
    if (lines.length > 0) {
      parts.push(`\n## 護欄\n${lines.join("\n")}`);
    }
  }

  // 1c. Security rules (injected into every agent)
  parts.push(SECURITY_RULES);

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

  // 4. Inject skill prompts from project crew skillBindings
  if (projDir) {
    try {
      const { readProjectSkills } = await import("./project-crew.mjs");
      const skillPrompts = readProjectSkills(projDir, agent.crewId);
      if (skillPrompts && skillPrompts.length > 0) {
        const skillSection = skillPrompts.map(s =>
          `### Skill: ${s.name}\n${s.prompt}`
        ).join("\n\n");
        parts.push(`\n## 已掛載技能 (Skills)\n以下是綁定到此 Agent 的技能定義，請在對話中遵循這些規則：\n\n${skillSection}`);
      }
    } catch (err) {
      console.error(`[DomainAgent] Skill injection error for ${agent.crewId}:`, err.message);
    }
  }

  // 5. Inject knowledge + workspace reference paths (so agents know what's available)
  try {
    const refPaths = [];

    // Knowledge: just the directory path, don't expand contents
    const knowledgeDir = resolve(PAAW_ROOT, "data/knowledge");
    if (existsSync(knowledgeDir)) {
      refPaths.push(`📖 Knowledge (data/knowledge/) — 使用 reference_read(action="list|read|search", source="knowledge") 存取（唯讀）`);
    }

    // Workspace: external dirs from workspaces.json (just the paths, don't expand contents)
    try {
      const ws = JSON.parse(readSync(resolve(PAAW_ROOT, "data/workspaces.json"), "utf-8"));
      if (ws.directories?.length) {
        refPaths.push(`📂 Workspace 目錄（使用 reference_read(action="list|read|search", source="workspace", path="...") 存取）：\n${ws.directories.map(d => "  - " + d).join("\n")}`);
      }
    } catch {}

    if (refPaths.length > 0) {
      parts.push(`\n=== \u53c3\u8003\u8cc7\u6599\u8def\u5f91 ===\n${refPaths.join("\n\n")}\n\n\u4f7f\u7528 reference_read tool \u700f\u89bd\u548c\u641c\u5c0b\u4ee5\u4e0a\u8cc7\u6599\u3002\u958b\u767c\u76f8\u4f3c\u529f\u80fd\u6642\uff0c\u5148\u7528 reference_read(action="search", source="knowledge", path="\u95dc\u9375\u5b57") \u641c\u5c0b\u73fe\u6709\u7bc4\u4f8b\u3002`);
    }
  } catch {}

  return parts.join("\n\n");
}

export { DOMAIN_AGENTS };

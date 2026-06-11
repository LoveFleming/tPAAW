/**
 * PAAW Context Engine — 統一的 context 組裝器
 *
 * 所有介面（chat、skill-exec、workflow、crew）都透過這裡拿 context。
 * 一處定義，到處使用。
 *
 * 用法：
 *   const ctx = await contextEngine.build({ target: "chat" });
 *   const ctx = await contextEngine.build({ target: "skill-exec", appId, skillId, input });
 *   const ctx = await contextEngine.build({ target: "crew", crewId });
 *
 * 回傳：{ systemPrompt, prompt?, provider?, meta? }
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Paths ──
const PAAW_ROOT = resolve(__dirname, "../../../");
const DATA_DIR = resolve(PAAW_ROOT, "data");
const CONFIG_DIR = resolve(DATA_DIR, "config");
const SYSTEM_DIR = resolve(DATA_DIR, "system");
const APPS_DIR = resolve(DATA_DIR, "apps");
const CHAT_DIR = resolve(DATA_DIR, "chats");
const SKILL_POOL_DIR = resolve(DATA_DIR, "skills/physical-skill");

// ── Helpers ──
function safeRead(filePath) {
  try { return readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function safeReadJSON(filePath, fallback) {
  try { return JSON.parse(readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

// ══════════════════════════════════════════════════════════
// Context Sources — 每個來源獨立函數，方便維護
// ══════════════════════════════════════════════════════════

/** 使用者 profile */
function loadUserProfile() {
  return safeReadJSON(resolve(CONFIG_DIR, "user.json"), {
    name: "使用者",
    intro: "",
    style: "casual",
    assistantName: "林語晴",
  });
}

/** MEMORY.md 長期記憶 */
function loadMemory() {
  return safeRead(resolve(CONFIG_DIR, "MEMORY.md")) || safeRead(resolve(DATA_DIR, "MEMORY.md"));
}

/** System prompt（通用） */
function loadSystemPrompt() {
  return safeRead(resolve(SYSTEM_DIR, "system-prompt.md"));
}

/** Guardrails */
function loadGuardrails() {
  return safeRead(resolve(SYSTEM_DIR, "guardrails.md"));
}

/** App 建構規則 */
function loadAppBuilderRules() {
  return safeRead(resolve(CONFIG_DIR, "app-builder-rules.md"));
}

/** Workspaces */
function loadWorkspaces() {
  const ws = safeReadJSON(resolve(CONFIG_DIR, "workspaces.json"), { directories: [] });
  return ws.directories || [];
}

/** App 清單 + instructions */
function loadAppInstructions() {
  if (!existsSync(APPS_DIR)) return "";
  const apps = [];
  try {
    const dirs = readdirSync(APPS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const appId of dirs) {
      const meta = safeReadJSON(resolve(APPS_DIR, appId, "app.json"), null);
      if (meta) {
        const desc = meta.description ? ` — ${meta.description}` : "";
        const triggers = meta.triggerKeywords?.length ? ` [觸發：${meta.triggerKeywords.join(", ")}]` : "";
        apps.push(`- **${meta.name || appId}** (${appId})${desc}${triggers}`);
      }
    }
  } catch {}
  return apps.length > 0 ? `以下是已安裝的 App：\n${apps.join("\n")}` : "";
}

/** 最近對話摘要 */
function loadRecentChatSummary(maxChats) {
  if (!existsSync(CHAT_DIR)) return "";
  const summaries = [];
  try {
    const files = readdirSync(CHAT_DIR)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, maxChats || 3);
    for (const f of files) {
      try {
        const chat = JSON.parse(readFileSync(resolve(CHAT_DIR, f), "utf-8"));
        if (chat.messages?.length > 0) {
          const lastMsgs = chat.messages.slice(-4);
          const summary = lastMsgs
            .map(m => `${m.role === "user" ? "👤" : "🤖"} ${String(m.content).slice(0, 100)}`)
            .join("\n");
          summaries.push(`### ${chat.title || "對話"}\n${summary}`);
        }
      } catch {}
    }
  } catch {}
  if (summaries.length === 0) return "";
  return `以下是你和使用者最近的對話，幫助你延續記憶。不要重複提及，除非使用者問起。\n\n${summaries.join("\n\n")}`;
}

/** Provider config */
function loadProviderConfig() {
  const config = safeReadJSON(resolve(CONFIG_DIR, "providers.json"), { active: "zai", providers: {} });
  const providers = config.providers || {};
  const activeId = config.active || Object.keys(providers)[0] || "";
  const provider = providers[activeId] || {};
  const model = config.defaultModel || provider.models?.[0]?.id || "glm-5.1";
  return { providerId: activeId, provider, model };
}

/** Skill frontmatter parsing */
function parseSkillFrontmatter(content) {
  const meta = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { meta, body: content.trim() };
  const body = content.slice(fmMatch[0].length).trim();
  for (const line of fmMatch[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body };
}

/** API Tool Registry — 已啟用的系統工具 */
function loadApiTools() {
  const registryDir = resolve(DATA_DIR, "api-registry");
  try {
    const files = readdirSync(registryDir).filter(f => f.endsWith(".json") && !f.startsWith("_"));
    const tools = [];
    for (const f of files) {
      try {
        const contract = JSON.parse(readFileSync(resolve(registryDir, f), "utf-8"));
        if (contract.enabled && contract.autoTool) {
          tools.push({
            routeId: contract.routeId,
            name: contract.name,
            route: contract.route,
            description: contract.description,
            category: contract.category,
          });
        }
      } catch {}
    }
    return tools;
  } catch {
    return [];
  }
}

/** 已產生的 Skill Tools */
function loadGeneratedSkills() {
  const toolsDir = resolve(DATA_DIR, "skills/tools");
  try {
    const dirs = readdirSync(toolsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    const skills = [];
    for (const id of dirs) {
      try {
        const meta = JSON.parse(readFileSync(resolve(toolsDir, id, "meta.json"), "utf-8"));
        skills.push(meta);
      } catch {
        skills.push({ routeId: id, name: id });
      }
    }
    return skills;
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════
// Context Engine API
// ══════════════════════════════════════════════════════════

export const contextEngine = {
  /**
   * Main entry point — 根據 target 組裝 context
   */
  async build(params) {
    switch (params.target) {
      case "chat":       return this._buildChat(params);
      case "skill-exec": return this._buildSkillExec(params);
      case "workflow":   return this._buildWorkflow(params);
      case "crew":       return this._buildCrew(params);
      default:           return { systemPrompt: "" };
    }
  },

  // ── Chat: 完整 context ────────────────────────────────
  // Profile + Memory + Apps + Guardrails + Recent Chats
  _buildChat(params) {
    const user = loadUserProfile();
    const memory = loadMemory();
    const systemBase = loadSystemPrompt();
    const guardrails = loadGuardrails();
    const apps = loadAppInstructions();
    const workspaces = loadWorkspaces();
    const recentChats = loadRecentChatSummary(3);
    const appRules = loadAppBuilderRules();
    const providerConfig = loadProviderConfig();
    const assistantName = user.assistantName || "林語晴";

    const workspaceInfo = workspaces.length > 0
      ? `\n\n使用者的 Workspace 目錄：\n${workspaces.map(d => `- ${d}`).join("\n")}`
      : "";

    const parts = [];

    // 1. Identity
    parts.push(`你是${assistantName}，一個友善、聰明的個人 AI 助理。大家都叫你 Sunny。你不只能聊天，還能幫使用者做事。你有工具可以操作各種 App。當使用者提出需要操作的請求時，使用對應的工具來完成。\n\n回答時使用繁體中文，技術術語保留英文。語氣親切專業，像一位值得信賴的同事。`);

    // 2. User profile
    parts.push(`=== 使用者資訊 ===\n- 名字：${user.name || "未知"}\n- 介紹：${user.intro || ""}\n- 偏好風格：${user.style || "casual"}${workspaceInfo}`);

    // 3. Memory
    parts.push(`=== 你的長期記憶 (MEMORY.md) ===\n每次對話都會載入這份記憶。如果使用者說「記住」「幫我記」，使用 memory_add 工具更新。\n${memory || "(記憶是空白的)"}`);

    // 4. Apps
    if (apps) parts.push(`=== 可用的 App ===\n${apps}`);

    // 5. App builder rules
    if (appRules) parts.push(`=== App 建構規則 ===\n當使用者想建新 App 或修改 App 時，遵循以下規則：\n${appRules}`);

    // 6. System base + guardrails
    if (systemBase) parts.push(systemBase);
    if (guardrails) parts.push(guardrails);

    // 7. Reply rules
    parts.push(`=== 回覆規則 ===
- 用中文回覆，風格自然友善
- 使用者問「我有什麼 App」→ 用 app_list 工具查詢，不要猜
- 使用者要求做事時，先檢查有沒有對應的 App 或 System Tool，用對應的工具完成
- 如果使用者的話包含某個 App 的觸發關鍵字，直接呼叫該 App 的工具
- 主動運用記憶中的資訊（偏好、過去的決策、人際關係）
- 如果學到新東西，主動用 memory_add 記下來
- 不確定的事情就用工具查，不要用猜的
- 使用 Markdown 格式`);

    // 7.5 API Tools — 系統工具列表
    const apiTools = loadApiTools();
    const generatedSkills = loadGeneratedSkills();
    if (apiTools.length > 0 || generatedSkills.length > 0) {
      const toolLines = [];
      if (apiTools.length > 0) {
        toolLines.push("=== 可用的系統工具 (System Tools) ===");
        toolLines.push("你可以使用以下工具來完成任務。每個工具對應一個 API endpoint：");
        toolLines.push("");
        for (const t of apiTools) {
          toolLines.push(`[${t.routeId}] ${t.route} — ${t.description || t.name}`);
        }
      }
      if (generatedSkills.length > 0) {
        toolLines.push("");
        toolLines.push("=== 已產生的 Skill Tools ===");
        for (const s of generatedSkills) {
          toolLines.push(`[${s.routeId}] ${s.name} — ${s.route || ""}`);
        }
      }
      toolLines.push("");
      toolLines.push("使用規則：");
      toolLines.push("- 當使用者要求操作檔案、Git、API 測試、Cron 等工作時，優先使用對應的系統工具");
      toolLines.push("- 呼叫工具時，組裝正確的 API 請求並執行");
      toolLines.push("- 如果沒有對應工具，告訴使用者可以透過 Settings > Tools 產生新工具");
      parts.push(toolLines.join("\n"));
    }

    // 8. Recent chats
    if (recentChats) parts.push(`=== 最近對話摘要 ===\n${recentChats}`);

    return {
      systemPrompt: parts.join("\n\n"),
      provider: providerConfig,
    };
  },

  // ── Skill Exec: 最小 context ──────────────────────────
  // Skill 定義 + 輸入 → CLI 執行
  async _buildSkillExec(params) {
    const { appId, skillId, skillPath, input } = params;

    // Load SKILL.md
    let raw = "";
    const tryPaths = [
      skillPath,
      appId ? resolve(APPS_DIR, appId, "skills", skillId || "", "SKILL.md") : null,
      skillId ? resolve(SKILL_POOL_DIR, skillId, "SKILL.md") : null,
    ].filter(Boolean);

    for (const p of tryPaths) {
      raw = safeRead(p);
      if (raw) break;
    }

    if (!raw) return { systemPrompt: "", meta: { error: "Skill not found" } };

    const { meta, body } = parseSkillFrontmatter(raw);

    // Replace {{key}} with input values
    let prompt = body || "";
    if (input && typeof input === "object") {
      for (const [k, v] of Object.entries(input)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
      }
    }

    // Load app SYSTEM.md
    const appSystem = appId ? safeRead(resolve(APPS_DIR, appId, "SYSTEM.md")) : "";

    const systemPrompt = appSystem
      ? `${appSystem}\n\n你是「${appId}」App 的 Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。`
      : "你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。";

    return { systemPrompt, prompt, meta: { skillMeta: meta } };
  },

  // ── Workflow: 中度 context ─────────────────────────────
  async _buildWorkflow(params) {
    const skillCtx = await this._buildSkillExec(params);
    const workflowPrompt = skillCtx.prompt
      ? `${skillCtx.systemPrompt}\n\n---\n\n${skillCtx.prompt}`
      : skillCtx.systemPrompt;

    return {
      systemPrompt: "你是 PAAW Workflow 執行引擎。按照 Skill 定義逐步處理，確保每個步驟的輸出正確。",
      prompt: workflowPrompt,
      meta: skillCtx.meta,
    };
  },

  // ── Crew: 角色版 context ───────────────────────────────
  async _buildCrew(params) {
    const { crewId } = params;
    if (!crewId) return { systemPrompt: "" };

    const crewData = safeReadJSON(resolve(DATA_DIR, "crews", `${crewId}.json`), null);
    if (!crewData) return { systemPrompt: "" };

    const user = loadUserProfile();
    const memory = loadMemory();
    const apps = loadAppInstructions();

    const parts = [];
    if (crewData.rolePrompt) parts.push(crewData.rolePrompt);
    parts.push(`\n=== 使用者 ===\n- 名字：${user.name || "未知"}`);
    if (memory) parts.push(`\n=== 長期記憶 ===\n${memory}`);
    if (apps) parts.push(`\n=== 可用的 App ===\n${apps}`);

    return { systemPrompt: parts.join("\n"), meta: { crew: crewData } };
  },
};

export default contextEngine;

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
const APPS_DIR = resolve(DATA_DIR, "apps");
const CHAT_DIR = resolve(DATA_DIR, "chats");
const SKILL_POOL_DIR = resolve(DATA_DIR, "skills/physical-skill");
const AI_SETTINGS_DIR = resolve(DATA_DIR, "ai-settings");
const BASE_SETTINGS_DIR = resolve(AI_SETTINGS_DIR, "_base");

// ── Helpers ──
function safeRead(filePath) {
  try { return readFileSync(filePath, "utf-8"); } catch { return ""; }
}

/** Replace {{PAAW_ROOT}} placeholder with absolute path */
function resolvePaths(text) {
  if (!text) return text;
  return text.replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT);
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
  return safeRead(resolve(AI_SETTINGS_DIR, "chat/system-prompt.md"));
}

/** Base context — 每個 AI request 都帶 */
function loadBaseContext() {
  const parts = [];
  const paawCtx = safeRead(resolve(BASE_SETTINGS_DIR, "paaw-context.md"));
  if (paawCtx) parts.push(resolvePaths(paawCtx));
  const coreRules = safeRead(resolve(BASE_SETTINGS_DIR, "core-rules.md"));
  if (coreRules) parts.push(resolvePaths(coreRules));
  return parts.join("\n\n");
}

/** Guardrails */
function loadGuardrails() {
  return safeRead(resolve(AI_SETTINGS_DIR, "chat/guardrails.md"));
}

/** App 建構規則 */
function loadAppBuilderRules() {
  return safeRead(resolve(AI_SETTINGS_DIR, "app-builder/app-builder-rules.md"));
}

/** Skill Builder 格式定義 */
function loadSkillFormat() {
  return safeRead(resolve(AI_SETTINGS_DIR, "skill-builder/skill-format.md"));
}

/** Skill Builder 產出規則 */
function loadSkillBuilderRules() {
  return safeRead(resolve(AI_SETTINGS_DIR, "skill-builder/builder-rules.md"));
}

/** Reply Rules */
function loadReplyRules() {
  return safeRead(resolve(AI_SETTINGS_DIR, "chat/reply-rules.md"));
}

/** Workspaces */
function loadWorkspaces() {
  const ws = safeReadJSON(resolve(DATA_DIR, "workspaces.json"), { directories: [] });
  return ws.directories || [];
}

/** Knowledge directory (fixed path) */
function loadKnowledgeDirs() {
  return [resolve(DATA_DIR, "knowledge")];
}

/** Knowledge files listing */
function loadKnowledgeFiles() {
  const files = [];
  const knowledgeDirs = loadKnowledgeDirs();
  for (const knowledgeDir of knowledgeDirs) {
    const label = knowledgeDirs.length > 1 ? `[${knowledgeDir.split("/").pop()}] ` : "";
    try {
      const entries = readdirSync(knowledgeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".txt") || entry.name.endsWith(".json"))) {
          files.push(`${label}${entry.name}`);
        } else if (entry.isDirectory()) {
          try {
            const sub = readdirSync(resolve(knowledgeDir, entry.name), { withFileTypes: true });
            for (const s of sub) {
              if (s.isFile()) files.push(`${label}${entry.name}/${s.name}`);
            }
          } catch {}
        }
      }
    } catch {}
  }
  return files;
}

/** Check if a field is required in the app schema */
function checkFieldRequired(schema, fieldName) {
  if (!schema) return false;
  if (Array.isArray(schema.required) && schema.required.includes(fieldName)) return true;
  if (Array.isArray(schema.oneOf)) {
    for (const variant of schema.oneOf) {
      if (Array.isArray(variant.required) && variant.required.includes(fieldName)) return true;
    }
  }
  return false;
}

/** App 清單 + instructions */
function loadAppInstructions() {
  if (!existsSync(APPS_DIR)) return "";
  const apps = [];
  try {
    const entries = readdirSync(APPS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = safeReadJSON(resolve(APPS_DIR, entry.name, "app.json"), null);
      if (meta) {
        const appId = meta.id || entry.name;
        const desc = meta.description ? ` — ${meta.description}` : "";
        const triggers = meta.triggers?.length ? ` [觸發：${meta.triggers.join(", ")}]` : "";
        const hint = meta.aiPrompt ? `
  > ${meta.aiPrompt}` : "";
        let tools = "";
        // Build field descriptions for data tools
        let fieldInfo = "";
        if (meta.schema) {
          const allProps = { ...(meta.schema.properties || {}) };
          if (Array.isArray(meta.schema.oneOf)) {
            for (const v of meta.schema.oneOf) {
              if (v.properties) {
                for (const [k, val] of Object.entries(v.properties)) {
                  if (!(k in (meta.schema.properties || {}))) allProps[k] = val;
                }
              }
            }
          }
          const entries = Object.entries(allProps);
          if (entries.length > 0) {
            const parts = [];
            for (const [name, def] of entries) {
              const label = def.label || name;
              const req = checkFieldRequired(meta.schema, name) ? " (必填)" : "";
              const typeLabel = def.type || (def.const ? "fixed" : "string");
              const opts = def.enum ? ` [${def.enum.join("|")}]` : def.const ? ` [=${def.const}]` : "";
              parts.push(`${label}${req}${opts ? opts : ""}`);
            }
            fieldInfo = ` \n    可用欄位：${parts.join(", ")}`;
          }
        }
        if (meta.type === "skill-based") {
          tools = `\n  - 工具：${appId}_exec（執行 Skill + CLI）`;
        } else if (meta.dataShape === "object") {
          tools = `\n  - 工具：${appId}_get（讀取）, ${appId}_set（寫入）${fieldInfo}`;
        } else {
          tools = `\n  - 工具：${appId}_add（新增）, ${appId}_list（列表/搜尋）, ${appId}_get（單筆）, ${appId}_update（更新）, ${appId}_delete（刪除）${fieldInfo}`;
        }
        apps.push(`- **${meta.name || appId}** (${appId})${desc}${triggers}${hint}${tools}`);
      }
    }
    apps.unshift("- **App List** (app_list) — 列出所有可用的 App");
    apps.unshift("📦 **App 系統**：使用 app_list 工具查詢所有 App。新增 App 用 app_create。編輯用 app_edit。");
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
      case "chat":          return this._buildChat(params);
      case "skill-exec":    return this._buildSkillExec(params);
      case "workflow":      return this._buildWorkflow(params);
      case "crew":          return this._buildCrew(params);
      case "skill-builder": return this._buildSkillBuilder(params);
      default:              return { systemPrompt: "" };
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

    // Tell AI where config files are — it reads them itself to discover directories
    // PAAW_ROOT is already injected into paaw-context.md via {{PAAW_ROOT}} placeholder
    const knowledgeInfo = `\n\n📚 Knowledge 目錄：${PAAW_ROOT}/data/knowledge\n使用 file_list({ path: "${PAAW_ROOT}/data/knowledge", workspace: "knowledge" }) 列出目錄內容，用 file_read({ path: "${PAAW_ROOT}/data/knowledge/檔名" }) 讀取檔案。`;

    const parts = [];

    // 0. Base context — PAAW runtime info + core rules (always first)
    const baseCtx = loadBaseContext();
    if (baseCtx) parts.push(baseCtx);

    // 1. Identity（從檔案讀取，支援模板變數）
    const identityTpl = safeRead(resolve(AI_SETTINGS_DIR, "chat/identity.md"));
    const nickname = assistantName === '林語晴' ? 'Sunny' : assistantName;
    if (identityTpl) {
      parts.push(identityTpl.replace(/\{\{assistantName\}\}/g, assistantName).replace(/\{\{nickname\}\}/g, nickname));
    } else {
      parts.push(`你是${assistantName}，一個友善、聰明的個人 AI 助理。大家都叫你 Sunny。你不只能聊天，還能幫使用者做事。你有工具可以操作各種 App。當使用者提出需要操作的請求時，使用對應的工具來完成。\n\n回答時使用繁體中文，技術術語保留英文。語氣親切專業，像一位值得信賴的同事。`);
    }

    // 2. User profile
    parts.push(`=== 使用者資訊 ===\n- 名字：${user.name || "未知"}\n- 介紹：${user.intro || ""}\n- 偏好風格：${user.style || "casual"}${workspaceInfo}${knowledgeInfo}`);

    // 3. Memory
    parts.push(`=== 你的長期記憶 (MEMORY.md) ===\n每次對話都會載入這份記憶。如果使用者說「記住」「幫我記」，使用 memory_add 工具更新。\n${memory || "(記憶是空白的)"}`);

    // 4. Apps
    if (apps) parts.push(`=== 可用的 App ===\n${apps}`);

    // 4.5 Tool 使用規則（從檔案讀取，方便透過 API 編輯）
    const toolRules = safeRead(resolve(AI_SETTINGS_DIR, "chat/tool-rules.md"));
    if (toolRules) {
      parts.push(resolvePaths(toolRules));
    } else {
      parts.push(`=== Tool 使用規則 ===\n- 必須使用 tool call 來完成操作，絕對不要用文字模擬結果\n- 工具回傳的資料就是真實資料，不要自己創造\n- 只能使用已定義的工具，不要嘗試不存在的工具（例如 fs_tree、fs_browse）\n- Knowledge 目錄是固定的：file_read({ path: "檔名", workspace: "knowledge" })\n- Workspace 是外掛目錄：file_read({ path: "相對路徑", workspace: "目錄名" })\n- 列出檔案：file_list({ workspace: "knowledge" }) 或 file_list({ workspace: "目錄名" })`);
    }

    // 4.6 Skill 執行規則（從 crew 分類讀取）
    const skillRules = safeRead(resolve(AI_SETTINGS_DIR, "crew/skill-rules.md"));
    if (skillRules) parts.push(resolvePaths(skillRules));

    // 5. App builder rules
    if (appRules) parts.push(resolvePaths(`=== App 建構規則 ===\n當使用者想建新 App 或修改 App 時，遵循以下規則：\n${appRules}`));

    // 6. System base + guardrails
    if (systemBase) parts.push(resolvePaths(systemBase));
    if (guardrails) parts.push(resolvePaths(guardrails));

    // 7. Reply rules
    const replyRules = loadReplyRules();
    if (replyRules) parts.push(resolvePaths(replyRules));

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

    // Replace {{PAAW_ROOT}} with absolute path, then replace {{key}} with input values
    let prompt = resolvePaths(body || "");
    if (input && typeof input === "object") {
      for (const [k, v] of Object.entries(input)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
      }
    }

    // Load base context + app SYSTEM.md
    const baseCtx = loadBaseContext();
    const appSystem = appId ? safeRead(resolve(APPS_DIR, appId, "SYSTEM.md")) : "";

    const baseParts = [];
    if (baseCtx) baseParts.push(baseCtx);
    if (appSystem) baseParts.push(appSystem);
    baseParts.push("你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。");
    const systemPrompt = appId
      ? `${baseParts.join("\n\n")}（App: ${appId}）`
      : baseParts.join("\n\n");

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

    // Crew 簡潔模式：只帶 base context + rolePrompt
    // 執行 skill 時由 _buildSkillExec 處理，只帶 SKILL.md + user inputs
    const parts = [];

    const baseCtx = loadBaseContext();
    if (baseCtx) parts.push(baseCtx);

    if (crewData.rolePrompt) parts.push(crewData.rolePrompt);

    return { systemPrompt: parts.join("\n"), meta: { crew: crewData } };
  },

  // ── Skill Builder: AI 設定 context ──────────────────────
  // 供 SkillBuilder CLI 用：格式規範 + 產出規則
  _buildSkillBuilder(params) {
    const { skillDef = "" } = params;
    const parts = [];

    // 0. Base context — PAAW runtime info + core rules (always first)
    const baseCtx = loadBaseContext();
    if (baseCtx) parts.push(baseCtx);

    const skillFormat = loadSkillFormat();
    if (skillFormat) parts.push(`### Skill Format\n${resolvePaths(skillFormat)}`);

    const builderRules = loadSkillBuilderRules();
    if (builderRules) parts.push(`### Builder Rules\n${resolvePaths(builderRules)}`);

    const contextSection = parts.join("\n\n");
    const systemPrompt = "你是 PAAW Skill 建構專家。根據使用者提供的資訊和規則，產出完整的 SKILL.md。";
    const prompt = contextSection
      ? `${contextSection}\n\n---\n\n請根據以上規則建立以下 Skill 的完整 SKILL.md：\n\n${skillDef}`
      : skillDef;

    return { systemPrompt, prompt };
  },
};

export default contextEngine;

/**
 * PAAW Context Engine — 統一的 context 組裝器
 *
 * 架構：
 *   [Hardcoded Base]  只有 Knowledge + Workspace 路徑（不可編輯）
 *   [Category Rules]  各 AI 功能從自己的 category 目錄讀 .md 檔
 *   [Dynamic Data]    User Profile + MEMORY.md + Apps（runtime 載入）
 *   [Runtime Tools]   API Tools + Generated Skills（有才加）
 *
 * 用法：
 *   const ctx = await contextEngine.build({ target: "chat" });
 *   const ctx = await contextEngine.build({ target: "crew", crewId });
 *   const ctx = await contextEngine.build({ target: "skill-exec", skillPath, input });
 *
 * 回傳：{ systemPrompt, prompt?, provider?, meta? }
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
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

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════

function safeRead(filePath) {
  try { return readFileSync(filePath, "utf-8"); } catch { return ""; }
}

function safeReadJSON(filePath, fallback) {
  try { return JSON.parse(readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

function resolvePaths(text) {
  if (!text) return text;
  return text.replace(/\{\{PAAW_ROOT\}\}/g, PAAW_ROOT);
}

// ══════════════════════════════════════════════════════════
// Layer 0: Hardcoded Base — 不可編輯，只有路徑
// ══════════════════════════════════════════════════════════

function buildBaseContext() {
  const workspaces = loadWorkspaces();

  const lines = [
    `=== 檔案路徑 ===`,
    `📖 Knowledge：使用 file_list({ workspace: "knowledge" }) 和 file_read({ workspace: "knowledge", path: "檔名" }) 透過 API 存取。`,
  ];

  if (workspaces.length > 0) {
    lines.push("", "使用者的 Workspace 目錄（可讀寫）：");
    for (const d of workspaces) lines.push(`- ${d}`);
  }

  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════
// Layer 1: Category Rules — 讀取 category 目錄下所有 .md 檔
// ══════════════════════════════════════════════════════════

/** 讀取指定 category 目錄下所有 .md 檔，按檔名排序，回傳字串陣列 */
function readCategoryFiles(categoryName) {
  const dir = resolve(AI_SETTINGS_DIR, categoryName);
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".md"))
      .sort();
    return files
      .map(f => {
        const content = safeRead(resolve(dir, f));
        return content ? resolvePaths(content) : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════
// Layer 2: Dynamic Data — runtime 載入，不是 rule
// ══════════════════════════════════════════════════════════

function loadUserProfile() {
  return safeReadJSON(resolve(CONFIG_DIR, "user.json"), {
    name: "使用者", intro: "", style: "casual", assistantName: "林語晴",
  });
}

function loadMemory() {
  return safeRead(resolve(CONFIG_DIR, "MEMORY.md")) || safeRead(resolve(DATA_DIR, "MEMORY.md"));
}

function loadWorkspaces() {
  const ws = safeReadJSON(resolve(DATA_DIR, "workspaces.json"), { directories: [] });
  return ws.directories || [];
}

function loadProviderConfig() {
  const config = safeReadJSON(resolve(CONFIG_DIR, "providers.json"), { active: "zai", providers: {} });
  const providers = config.providers || {};
  const activeId = config.active || Object.keys(providers)[0] || "";
  const provider = providers[activeId] || {};
  const model = config.defaultModel || provider.models?.[0]?.id || "glm-5.1";
  return { providerId: activeId, provider, model };
}

/** 動態資料：使用者資訊 + 記憶 + Apps */
function buildDynamicContext() {
  const user = loadUserProfile();
  const memory = loadMemory();
  const apps = loadAppInstructions();
  const assistantName = user.assistantName || "林語晴";

  const parts = [];

  // 使用者資訊
  parts.push(`=== 使用者資訊 ===\n- 名字：${user.name || "未知"}\n- 介紹：${user.intro || ""}\n- 偏好風格：${user.style || "casual"}`);

  // 記憶
  parts.push(`=== 長期記憶 (MEMORY.md) ===\n${memory || "(記憶是空白的)"}`);

  // Apps
  if (apps) parts.push(`=== 可用的 App ===\n${apps}`);

  return parts.join("\n\n");
}

// ══════════════════════════════════════════════════════════
// Layer 3: Runtime Tools — API Tools + Generated Skills
// ══════════════════════════════════════════════════════════

function loadApiTools() {
  const registryDir = resolve(DATA_DIR, "api-registry");
  try {
    const files = readdirSync(registryDir).filter(f => f.endsWith(".json") && !f.startsWith("_"));
    const tools = [];
    for (const f of files) {
      try {
        const contract = JSON.parse(readFileSync(resolve(registryDir, f), "utf-8"));
        if (contract.enabled && contract.autoTool) {
          tools.push({ routeId: contract.routeId, name: contract.name, route: contract.route, description: contract.description });
        }
      } catch {}
    }
    return tools;
  } catch { return []; }
}

function loadGeneratedSkills() {
  const toolsDir = resolve(DATA_DIR, "skills/tools");
  try {
    return readdirSync(toolsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        try { return JSON.parse(readFileSync(resolve(toolsDir, d.name, "meta.json"), "utf-8")); }
        catch { return { routeId: d.name, name: d.name }; }
      });
  } catch { return []; }
}

function buildRuntimeTools() {
  const apiTools = loadApiTools();
  const generatedSkills = loadGeneratedSkills();
  if (apiTools.length === 0 && generatedSkills.length === 0) return "";

  const lines = [];
  if (apiTools.length > 0) {
    lines.push("=== 可用的系統工具 (System Tools) ===");
    for (const t of apiTools) lines.push(`[${t.routeId}] ${t.route} — ${t.description || t.name}`);
  }
  if (generatedSkills.length > 0) {
    lines.push("", "=== 已產生的 Skill Tools ===");
    for (const s of generatedSkills) lines.push(`[${s.routeId}] ${s.name} — ${s.route || ""}`);
  }
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════
// Shared Loaders — Apps, Recent Chats, Skill parsing
// ══════════════════════════════════════════════════════════

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
        let tools = "";
        let fieldInfo = "";
        if (meta.schema) {
          const allProps = { ...(meta.schema.properties || {}) };
          if (Array.isArray(meta.schema.oneOf)) {
            for (const v of meta.schema.oneOf) {
              if (v.properties) for (const [k, val] of Object.entries(v.properties)) if (!(k in (meta.schema.properties || {}))) allProps[k] = val;
            }
          }
          const fieldEntries = Object.entries(allProps);
          if (fieldEntries.length > 0) {
            const parts = [];
            for (const [name, def] of fieldEntries) {
              const label = def.label || name;
              const req = checkFieldRequired(meta.schema, name) ? " (必填)" : "";
              const opts = def.enum ? ` [${def.enum.join("|")}]` : def.const ? ` [=${def.const}]` : "";
              parts.push(`${label}${req}${opts}`);
            }
            fieldInfo = ` \n    可用欄位：${parts.join(", ")}`;
          }
        }
        if (meta.type === "skill-based") tools = `\n  - 工具：${appId}_exec（執行 Skill + CLI）`;
        else if (meta.dataShape === "object") tools = `\n  - 工具：${appId}_get（讀取）, ${appId}_set（寫入）${fieldInfo}`;
        else tools = `\n  - 工具：${appId}_add（新增）, ${appId}_list（列表/搜尋）, ${appId}_get（單筆）, ${appId}_update（更新）, ${appId}_delete（刪除）${fieldInfo}`;
        apps.push(`- **${meta.name || appId}** (${appId})${desc}${triggers}${tools}`);
      }
    }
    apps.unshift("- **App List** (app_list) — 列出所有可用的 App");
  } catch {}
  return apps.length > 0 ? `以下是已安裝的 App：\n${apps.join("\n")}` : "";
}

function loadRecentChatSummary(maxChats) {
  if (!existsSync(CHAT_DIR)) return "";
  const summaries = [];
  try {
    const files = readdirSync(CHAT_DIR).filter(f => f.endsWith(".json")).sort().reverse().slice(0, maxChats || 3);
    for (const f of files) {
      try {
        const chat = JSON.parse(readFileSync(resolve(CHAT_DIR, f), "utf-8"));
        if (chat.messages?.length > 0) {
          const lastMsgs = chat.messages.slice(-4);
          const summary = lastMsgs.map(m => `${m.role === "user" ? "👤" : "🤖"} ${String(m.content).slice(0, 100)}`).join("\n");
          summaries.push(`### ${chat.title || "對話"}\n${summary}`);
        }
      } catch {}
    }
  } catch {}
  return summaries.length > 0 ? `以下是你和使用者最近的對話：\n\n${summaries.join("\n\n")}` : "";
}

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

// ══════════════════════════════════════════════════════════
// Context Engine API
// ══════════════════════════════════════════════════════════

export const contextEngine = {
  async build(params) {
    switch (params.target) {
      case "chat":          return this._buildChat(params);
      case "skill-exec":    return this._buildSkillExec(params);
      case "workflow":      return this._buildWorkflow(params);
      case "crew":          return this._buildCrew(params);
      case "skill-builder": return this._buildSkillBuilder(params);
      case "mindmap":       return this._buildMindmap(params);
      case "notes":         return this._buildNotes(params);
      case "project":       return this._buildProject(params);
      case "distill":       return this._buildDistill(params);
      case "app-exec":     return this._buildAppExec(params);
      case "app-builder":   return this._buildAppBuilder(params);
      case "coding":        return this._buildCoding(params);
      default:              return { systemPrompt: "" };
    }
  },

  // ── Chat：base + dynamic + chat/ rules + runtime tools + recent chats ──
  _buildChat() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      buildDynamicContext(),
      ...readCategoryFiles("chat"),
    ];
    const tools = buildRuntimeTools();
    if (tools) parts.push(tools);

    const recent = loadRecentChatSummary(3);
    if (recent) parts.push(recent);

    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── Crew / Employee：
  //   [1] Base（knowledge path + workspace dirs，from config）
  //   [2] crew/ rules（skill-rules 等）
  //   [3] crew JSON rolePrompt
  //   [4] SKILL.md + user input（前端附加）
  _buildCrew(params) {
    const { crewId } = params;
    const provider = loadProviderConfig();

    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("crew"),
      "你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。",
    ];

    // crew-specific rolePrompt
    const crewData = crewId ? safeReadJSON(resolve(DATA_DIR, "crews", `${crewId}.json`), null) : null;
    if (crewData?.rolePrompt) parts.push(crewData.rolePrompt);

    return { systemPrompt: parts.join("\n\n"), provider, meta: { crew: crewData } };
  },

  // ── Skill Exec：
  //   [1] Base（from config）
  //   [2] crew/ rules
  //   [3] app SYSTEM.md（如果有）
  //   [4] SKILL.md body（with {{placeholders}} replaced）
  async _buildSkillExec(params) {
    const { appId, skillId, skillPath, input } = params;
    const provider = loadProviderConfig();

    // Load SKILL.md
    let raw = "";
    const tryPaths = [
      skillPath,
      appId ? resolve(APPS_DIR, appId, "skills", skillId || "", "SKILL.md") : null,
      skillId ? resolve(SKILL_POOL_DIR, skillId, "SKILL.md") : null,
    ].filter(Boolean);
    for (const p of tryPaths) { raw = safeRead(p); if (raw) break; }
    if (!raw) return { systemPrompt: "", meta: { error: "Skill not found" } };

    const { meta, body } = parseSkillFrontmatter(raw);

    // Replace placeholders in SKILL.md body
    let prompt = resolvePaths(body || "");
    if (input && typeof input === "object") {
      for (const [k, v] of Object.entries(input)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
      }
    }

    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("crew"),
      "你是 PAAW Skill 執行引擎。嚴格按照 Skill 定義處理，只輸出結果，不加解釋。",
    ];
    const appSystem = appId ? safeRead(resolve(APPS_DIR, appId, "SYSTEM.md")) : "";
    if (appSystem) parts.push(resolvePaths(appSystem));
    if (appId) parts.push(`（App: ${appId}）`);

    return { systemPrompt: parts.join("\n\n"), prompt, provider, meta: { skillMeta: meta } };
  },

  // ── Workflow：跟 Skill Exec 一樣 + workflow engine label
  async _buildWorkflow(params) {
    const { appId, skillId, skillPath, input } = params;
    const provider = loadProviderConfig();

    // Load SKILL.md
    let raw = "";
    const tryPaths = [
      skillPath,
      appId ? resolve(APPS_DIR, appId, "skills", skillId || "", "SKILL.md") : null,
      skillId ? resolve(SKILL_POOL_DIR, skillId, "SKILL.md") : null,
    ].filter(Boolean);
    for (const p of tryPaths) { raw = safeRead(p); if (raw) break; }

    let prompt = "";
    let skillMeta = {};
    if (raw) {
      const parsed = parseSkillFrontmatter(raw);
      skillMeta = parsed.meta;
      prompt = resolvePaths(parsed.body || "");
      if (input && typeof input === "object") {
        for (const [k, v] of Object.entries(input)) {
          prompt = prompt.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), typeof v === "string" ? v : JSON.stringify(v));
        }
      }
    }

    const parts = [
      buildBaseContext(),
      buildDynamicContext(),
      ...readCategoryFiles("crew"),
      ...readCategoryFiles("workflow"),
      "你是 PAAW Workflow 執行引擎。按照 Skill 定義逐步處理，確保每個步驟的輸出正確。",
    ];

    return { systemPrompt: parts.join("\n\n"), prompt, provider, meta: { skillMeta } };
  },

  // ── Skill Builder：base + dynamic + skill-builder/{phase} rules ──
  // Phase: "build" (default) or "test" — loads different prompt sets
  _buildSkillBuilder(params) {
    const { skillDef = "", phase = "build" } = params;
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      // No buildDynamicContext() — skill-builder is a tool, not a chat assistant
      ...readCategoryFiles(`skill-builder/${phase}`),
    ];
    // prompt = rules from ai-settings + the actual skill-source.md input
    const prompt = `${skillDef}`;
    return { systemPrompt: parts.join("\n\n"), prompt, provider };
  },

  // ── App Builder：base + dynamic + app-builder/ rules + chat identity ──
  _buildAppBuilder() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("app-builder"),
    ];
    const tools = buildRuntimeTools();
    if (tools) parts.push(tools);
    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── App Exec：base + dynamic + app-exec/ rules + skill contents ──
  _buildAppExec(params) {
    const { appName = "", skillsSection = "", inputSection = "" } = params;
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("app-exec"),
    ];
    // Inject app-specific runtime data
    const appContext = `## App: ${appName}\n\n${skillsSection}\n\n## === 輸入參數 ===\n${inputSection}`;
    parts.push(appContext);
    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── Coding IDE：base + dynamic + chat/ rules + runtime tools ──
  _buildCoding() {
    // Coding IDE 跟 Chat 用一樣的 context（需要 identity, tool-rules 等）
    return this._buildChat();
  },

  // ── Mindmap：base + dynamic + mindmap/ rules ──
  _buildMindmap() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("mindmap"),
    ];
    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── Notes：base + notes/ rules ──
  _buildNotes() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("notes"),
    ];
    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── Project：base + project/ rules ──
  _buildProject() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("project"),
    ];
    return { systemPrompt: parts.join("\n\n"), provider };
  },

  // ── Distill：base + distill/ rules ──
  _buildDistill() {
    const provider = loadProviderConfig();
    const parts = [
      buildBaseContext(),
      ...readCategoryFiles("distill"),
    ];
    return { systemPrompt: parts.join("\n\n"), provider };
  },
};

export default contextEngine;

/**
 * AI Settings routes — unified management for all AI context files.
 *
 * Categories are fixed (chat, skill-builder, app-builder).
 * Files within each category are fully dynamic (CRUD).
 *
 * API:
 *   GET    /api/ai-settings                              — list categories (with live file list)
 *   GET    /api/ai-settings/:category                    — list files in a category
 *   GET    /api/ai-settings/:category/:file              — get file content
 *   POST   /api/ai-settings/:category                    — create new file { file, content }
 *   PUT    /api/ai-settings/:category/:file              — update file content
 *   DELETE /api/ai-settings/:category/:file              — delete file
 *   POST   /api/ai-settings/skill-builder/build          — assembled context for CLI
 */
import { readdir, readFile, writeFile, mkdir, rm } from "fs/promises";
import { join, resolve, dirname } from "path";
import { existsSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { readBody, json, urlPath } from "./context.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AI_SETTINGS_ROOT = resolve(__dirname, "../../../../data/ai-settings");

// Category metadata — fixed set, but files are dynamic
const CATEGORIES = [
  { id: "_base",          label: "Base",          icon: "🏛️", desc: "PAAW 基本資訊 — 每個 AI request 都會帶上，放最前面" },
  { id: "chat",          label: "Chat",          icon: "💬", desc: "聊天助理的 AI 設定 — 身份、系統提示、防護規則" },
  { id: "crew",           label: "Crew",          icon: "👤", desc: "AI Crew 的設定 — Skill 執行規則、角色上下文" },
  { id: "skill-builder", label: "Skill Builder", icon: "🔨", desc: "Skill 建構器的 AI 設定 — 格式規範、產出規則" },
  { id: "app-builder",   label: "App Builder",   icon: "📦", desc: "App 建構器的 AI 設定 — App 產出規則" },
  { id: "notes",         label: "Notes",         icon: "📝", desc: "AI 筆記助手的 AI 設定 — 筆記整理規則、格式規範" },
  { id: "mindmap",       label: "Mind Map",      icon: "🧠", desc: "AI 心智圖產生器的 AI 設定 — 分支策略、節點規則" },
  { id: "project",       label: "Project",      icon: "📋", desc: "專案管理的 AI 設定 — 建專案、分析專案狀態、建議任務" },
];

// Default icon for unknown file types
const DEFAULT_FILE_ICON = "📄";

function categoryDir(categoryId) {
  return join(AI_SETTINGS_ROOT, categoryId);
}

function isValidCategory(categoryId) {
  return CATEGORIES.some(c => c.id === categoryId);
}

/** Dynamically scan a category directory for .md files */
async function scanCategoryFiles(categoryId) {
  const dir = categoryDir(categoryId);
  try {
    const entries = await readdir(dir);
    return entries
      .filter(f => f.endsWith(".md"))
      .sort()
      .map(f => ({
        file: f,
        label: f.replace(/\.md$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        icon: DEFAULT_FILE_ICON,
      }));
  } catch {
    return [];
  }
}

export default async function aiSettingsRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/ai-settings/agent-config — single source of truth for agent runtime
  if (req.method === "GET" && path === "/api/ai-settings/agent-config") {
    const { loadAgentConfig } = await import("./context.mjs");
    json(res, await loadAgentConfig());
    return true;
  }

  // PUT /api/ai-settings/agent-config — update agent config
  if (req.method === "PUT" && path === "/api/ai-settings/agent-config") {
    try {
      const body = JSON.parse(await readBody(req));
      const { resolve, dirname } = await import("path");
      const { mkdir, writeFile } = await import("fs/promises");
      const configPath = resolve(AI_SETTINGS_ROOT, "agent-config.json");
      await writeFile(configPath, JSON.stringify(body, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/ai-settings/providers — read provider config
  if (req.method === "GET" && path === "/api/ai-settings/providers") {
    try {
      const { resolve } = await import("path");
      const { readFile: rf } = await import("fs/promises");
      const configPath = resolve(AI_SETTINGS_ROOT, "../config/providers.json");
      const raw = await rf(configPath, "utf-8");
      json(res, JSON.parse(raw));
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // PUT /api/ai-settings/providers — update provider config
  if (req.method === "PUT" && path === "/api/ai-settings/providers") {
    try {
      const body = JSON.parse(await readBody(req));
      const { resolve } = await import("path");
      const { writeFile: wf } = await import("fs/promises");
      const configPath = resolve(AI_SETTINGS_ROOT, "../config/providers.json");
      await wf(configPath, JSON.stringify(body, null, 2), "utf-8");
      json(res, { ok: true });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/context/:target — get full system context for any AI target
  // Targets: chat, skill-exec, workflow, crew, skill-builder, crew-chat, vibe-coding, app-builder
  const ctxTargetMatch = req.method === "GET" && path.match(/^\/api\/context\/([\w-]+)$/);
  if (ctxTargetMatch) {
    try {
      const target = ctxTargetMatch[1];
      const { contextEngine } = await import("../context-engine.mjs");
      // Map frontend target names to context-engine targets
      const targetMap = {
        "chat": "chat",
        "skill-exec": "skill-exec",
        "workflow": "workflow",
        "crew": "crew",
        "skill-builder": "skill-builder",
        "crew-chat": "crew",
        "vibe-coding": "chat",  // vibe-coding uses chat context
        "app-builder": "chat",  // app-builder uses chat context
        "employee": "crew",     // employee uses crew context
        "mindmap": "chat",
        "notes": "chat",
      };
      const engineTarget = targetMap[target] || "chat";
      const ctx = await contextEngine.build({ target: engineTarget });
      json(res, { systemPrompt: ctx.systemPrompt || "", prompt: ctx.prompt || "", provider: ctx.provider });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // GET /api/user/preferences — read user preferences (model overrides per feature)
  if (req.method === "GET" && path === "/api/user/preferences") {
    try {
      const { resolve } = await import("path");
      const { readFile: rf } = await import("fs/promises");
      const userPath = resolve(AI_SETTINGS_ROOT, "../config/user.json");
      const raw = await rf(userPath, "utf-8");
      const user = JSON.parse(raw);
      json(res, user.preferences || {});
    } catch { json(res, {}); }
    return true;
  }

  // PUT /api/user/preferences — update user preferences
  if (req.method === "PUT" && path === "/api/user/preferences") {
    try {
      const body = JSON.parse(await readBody(req));
      const { resolve } = await import("path");
      const { readFile: rf, writeFile: wf } = await import("fs/promises");
      const userPath = resolve(AI_SETTINGS_ROOT, "../config/user.json");
      let user = {};
      try { user = JSON.parse(await rf(userPath, "utf-8")); } catch {}
      user.preferences = { ...(user.preferences || {}), ...body };
      await wf(userPath, JSON.stringify(user, null, 2), "utf-8");
      json(res, { ok: true, preferences: user.preferences });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // GET /api/ai-settings — list categories with live file list
  if (req.method === "GET" && path === "/api/ai-settings") {
    const cats = [];
    for (const cat of CATEGORIES) {
      const files = await scanCategoryFiles(cat.id);
      cats.push({ ...cat, files });
    }
    json(res, { categories: cats });
    return true;
  }

  // GET /api/ai-settings/:category — list files with content
  const catListMatch = req.method === "GET" && path.match(/^\/api\/ai-settings\/([\w-]+)$/);
  if (catListMatch) {
    const categoryId = catListMatch[1];
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    const cat = CATEGORIES.find(c => c.id === categoryId);
    const dir = categoryDir(categoryId);
    const fileEntries = await scanCategoryFiles(categoryId);
    const files = [];
    for (const f of fileEntries) {
      try {
        const content = await readFile(join(dir, f.file), "utf-8");
        files.push({ ...f, content, exists: true });
      } catch {
        files.push({ ...f, content: "", exists: false });
      }
    }
    json(res, { category: cat, files });
    return true;
  }

  // GET /api/ai-settings/:category/:file — get file content
  const fileGetMatch = req.method === "GET" && path.match(/^\/api\/ai-settings\/([\w-]+)\/([\w.-]+\.md)$/);
  if (fileGetMatch) {
    const [, categoryId, fileName] = fileGetMatch;
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    try {
      const content = await readFile(join(categoryDir(categoryId), fileName), "utf-8");
      json(res, { content });
    } catch {
      json(res, { content: "" }, 404);
    }
    return true;
  }

  // POST /api/ai-settings/:category — create new file
  const createMatch = req.method === "POST" && path.match(/^\/api\/ai-settings\/([\w-]+)$/);
  if (createMatch) {
    const categoryId = createMatch[1];
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    try {
      const { file, content = "" } = JSON.parse(await readBody(req));
      if (!file || !file.endsWith(".md")) {
        json(res, { error: "file must end with .md" }, 400);
        return true;
      }
      // Prevent path traversal
      if (file.includes("..") || file.includes("/")) {
        json(res, { error: "Invalid filename" }, 400);
        return true;
      }
      const dir = categoryDir(categoryId);
      const filePath = join(dir, file);
      // Check if already exists
      try {
        await readFile(filePath, "utf-8");
        json(res, { error: `File already exists: ${file}` }, 409);
        return true;
      } catch { /* not exists, good */ }
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      json(res, { ok: true, category: categoryId, file });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // PUT /api/ai-settings/:category/:file — update file content
  const filePutMatch = req.method === "PUT" && path.match(/^\/api\/ai-settings\/([\w-]+)\/([\w.-]+\.md)$/);
  if (filePutMatch) {
    const [, categoryId, fileName] = filePutMatch;
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    try {
      const { content } = JSON.parse(await readBody(req));
      if (content === undefined) {
        json(res, { error: "Missing content" }, 400);
        return true;
      }
      const dir = categoryDir(categoryId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, fileName), content, "utf-8");
      json(res, { ok: true, category: categoryId, file: fileName });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // DELETE /api/ai-settings/:category/:file — delete file
  const fileDeleteMatch = req.method === "DELETE" && path.match(/^\/api\/ai-settings\/([\w-]+)\/([\w.-]+\.md)$/);
  if (fileDeleteMatch) {
    const [, categoryId, fileName] = fileDeleteMatch;
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    try {
      await rm(join(categoryDir(categoryId), fileName));
      json(res, { ok: true, category: categoryId, file: fileName });
    } catch (err) {
      json(res, { error: err.message }, 404);
    }
    return true;
  }

  // POST /api/ai-settings/skill-builder/build — get assembled context for CLI
  const buildMatch = req.method === "POST" && path === "/api/ai-settings/skill-builder/build";
  if (buildMatch) {
    try {
      const { skillDef = "" } = JSON.parse(await readBody(req));
      const { contextEngine } = await import("../context-engine.mjs");
      const ctx = await contextEngine.build({ target: "skill-builder", skillDef });
      json(res, ctx);
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // ── Workspaces API ──
  // GET /api/workspaces — list workspace directories (AI can access/modify)
  if (req.method === "GET" && path === "/api/workspaces") {
    const DATA_DIR = resolve(AI_SETTINGS_ROOT, ".."); // data/
    const wsFile = resolve(DATA_DIR, "config/workspaces.json");
    let dirs = [];
    try {
      const ws = JSON.parse(await readFile(wsFile, "utf-8"));
      dirs = ws.directories || [];
    } catch {}
    // Also include default PAAW paths that AI can always access
    const defaultDirs = [
      resolve(DATA_DIR, "apps"),
      resolve(DATA_DIR, "skills"),
      resolve(DATA_DIR, "knowledge"),
      resolve(DATA_DIR, "ai-settings"),
      resolve(DATA_DIR, "distill/knowledge"),
      resolve(DATA_DIR, "config/distilled-memory"),
    ].filter(d => existsSync(d));
    const allDirs = [...new Set([...dirs, ...defaultDirs])];
    json(res, { directories: allDirs });
    return true;
  }

  // POST /api/workspaces — add workspace directory
  const wsAddMatch = req.method === "POST" && path === "/api/workspaces";
  if (wsAddMatch) {
    try {
      const { directory } = JSON.parse(await readBody(req));
      if (!directory) { json(res, { error: "Missing directory" }, 400); return true; }
      const DATA_DIR = resolve(AI_SETTINGS_ROOT, "..");
      const wsFile = resolve(DATA_DIR, "config/workspaces.json");
      let ws = { directories: [] };
      try { ws = JSON.parse(await readFile(wsFile, "utf-8")); } catch {}
      if (!ws.directories.includes(directory)) {
        ws.directories.push(directory);
        await writeFile(wsFile, JSON.stringify(ws, null, 2), "utf-8");
      }
      json(res, { ok: true, directories: ws.directories });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  // DELETE /api/workspaces — remove workspace directory
  const wsDelMatch = req.method === "DELETE" && path.match(/^\/api\/workspaces$/);
  if (wsDelMatch) {
    try {
      const { directory } = JSON.parse(await readBody(req));
      const DATA_DIR = resolve(AI_SETTINGS_ROOT, "..");
      const wsFile = resolve(DATA_DIR, "config/workspaces.json");
      let ws = { directories: [] };
      try { ws = JSON.parse(await readFile(wsFile, "utf-8")); } catch {}
      ws.directories = ws.directories.filter(d => d !== directory);
      await writeFile(wsFile, JSON.stringify(ws, null, 2), "utf-8");
      json(res, { ok: true, directories: ws.directories });
    } catch (err) { json(res, { error: err.message }, 500); }
    return true;
  }

  return false;
}

// Export for runtime use by other modules
export { AI_SETTINGS_ROOT, CATEGORIES };

/**
 * Runtime helper: read all AI settings files for a given category.
 * Dynamically scans directory — picks up user-created files too.
 */
export async function getAISettings(categoryId) {
  if (!isValidCategory(categoryId)) return {};
  const dir = categoryDir(categoryId);
  const files = await scanCategoryFiles(categoryId);
  const result = {};
  for (const f of files) {
    try {
      result[f.file.replace(/\.md$/, "")] = await readFile(join(dir, f.file), "utf-8");
    } catch {
      result[f.file.replace(/\.md$/, "")] = "";
    }
  }
  return result;
}

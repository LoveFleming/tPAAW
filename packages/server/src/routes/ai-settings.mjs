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
import { join, resolve } from "path";
import { readBody, json, urlPath } from "./context.mjs";

const AI_SETTINGS_ROOT = resolve(
  import.meta.dirname
    ? join(import.meta.dirname, "../../../../data/ai-settings")
    : join(process.cwd(), "data/ai-settings")
);

// Category metadata — fixed set, but files are dynamic
const CATEGORIES = [
  { id: "chat",          label: "Chat",          icon: "💬", desc: "聊天助理的 AI 設定 — 身份、系統提示、防護規則" },
  { id: "skill-builder", label: "Skill Builder", icon: "🔨", desc: "Skill 建構器的 AI 設定 — 格式規範、產出規則" },
  { id: "app-builder",   label: "App Builder",   icon: "📦", desc: "App 建構器的 AI 設定 — App 產出規則" },
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

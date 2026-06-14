/**
 * AI Settings routes — unified management for all AI context files.
 *
 * Categories:
 *   chat          → data/ai-settings/chat/        (identity, system-prompt, guardrails, tool-rules, reply-rules)
 *   skill-builder → data/ai-settings/skill-builder/ (skill-format, builder-rules)
 *   app-builder   → data/ai-settings/app-builder/   (app-builder-rules)
 *
 * API:
 *   GET  /api/ai-settings                     — list all categories + files
 *   GET  /api/ai-settings/:category           — list files in a category
 *   GET  /api/ai-settings/:category/:file     — get file content
 *   PUT  /api/ai-settings/:category/:file     — update file content
 */
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { readBody, json, urlPath } from "./context.mjs";

const AI_SETTINGS_ROOT = resolve(
  import.meta.dirname
    ? join(import.meta.dirname, "../../../data/ai-settings")
    : join(process.cwd(), "data/ai-settings")
);

// Category metadata — order matters for UI display
const CATEGORIES = [
  {
    id: "chat",
    label: "Chat",
    icon: "💬",
    desc: "聊天助理的 AI 設定 — 身份、系統提示、防護規則",
    files: [
      { file: "identity.md", icon: "🤖", label: "Identity & Style", desc: "AI 助理名稱、個性、語氣" },
      { file: "system-prompt.md", icon: "📋", label: "System Prompt", desc: "主要系統提示詞" },
      { file: "guardrails.md", icon: "🛡️", label: "Guardrails", desc: "安全邊界與限制" },
      { file: "tool-rules.md", icon: "🔧", label: "Tool Rules", desc: "AI 使用工具的規則" },
      { file: "reply-rules.md", icon: "💬", label: "Reply Rules", desc: "回覆格式與風格規則" },
    ],
  },
  {
    id: "skill-builder",
    label: "Skill Builder",
    icon: "🔨",
    desc: "Skill 建構器的 AI 設定 — 格式規範、產出規則",
    files: [
      { file: "skill-format.md", icon: "📐", label: "Skill Format", desc: "SKILL.md 的標準格式定義" },
      { file: "builder-rules.md", icon: "📏", label: "Builder Rules", desc: "AI 產出 SKILL.md 的規則" },
    ],
  },
  {
    id: "app-builder",
    label: "App Builder",
    icon: "📦",
    desc: "App 建構器的 AI 設定 — App 產出規則",
    files: [
      { file: "app-builder-rules.md", icon: "🏗️", label: "App Builder Rules", desc: "AI 建構 App 的規則" },
    ],
  },
];

function categoryDir(categoryId) {
  return join(AI_SETTINGS_ROOT, categoryId);
}

function isValidCategory(categoryId) {
  return CATEGORIES.some(c => c.id === categoryId);
}

function isValidFile(categoryId, fileName) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  return cat?.files.some(f => f.file === fileName);
}

export default async function aiSettingsRoutes(req, res) {
  const path = urlPath(req);

  // GET /api/ai-settings — list all categories + file metadata
  if (req.method === "GET" && path === "/api/ai-settings") {
    json(res, { categories: CATEGORIES });
    return true;
  }

  // GET /api/ai-settings/:category — list files with content preview
  const catListMatch = req.method === "GET" && path.match(/^\/api\/ai-settings\/([\w-]+)$/);
  if (catListMatch) {
    const categoryId = catListMatch[1];
    if (!isValidCategory(categoryId)) {
      json(res, { error: `Unknown category: ${categoryId}` }, 404);
      return true;
    }
    const cat = CATEGORIES.find(c => c.id === categoryId);
    const dir = categoryDir(categoryId);
    const files = [];
    for (const f of cat.files) {
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
      if (!content && content !== "") {
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

  return false;
}

// Export for runtime use by other modules
export { AI_SETTINGS_ROOT, CATEGORIES };

/**
 * Runtime helper: read AI settings for a given category.
 * Used by context-engine, chat route, skill-builder, etc.
 */
export async function getAISettings(categoryId) {
  const cat = CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return {};

  const dir = categoryDir(categoryId);
  const result = {};
  for (const f of cat.files) {
    try {
      result[f.file.replace(/\.md$/, "")] = await readFile(join(dir, f.file), "utf-8");
    } catch {
      result[f.file.replace(/\.md$/, "")] = "";
    }
  }
  return result;
}

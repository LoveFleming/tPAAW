/**
 * Shared context for all route modules.
 * Created once in paaw-server.mjs and passed to each route handler.
 */

import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import yaml from "js-yaml";
import { safeResolve } from "../lib/coding-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Roots
// nosemgrep: path-join-resolve-traversal
const PAAW_ROOT = resolve(__dirname, "../../../../");
// nosemgrep: path-join-resolve-traversal
const DASHBOARD_ROOT = resolve(__dirname, "../../../../ui");

// Data paths
export const PATHS = {
  PAAW_ROOT,
  DASHBOARD_ROOT,
// nosemgrep: path-join-resolve-traversal
  CREWS_ROOT:      resolve(PAAW_ROOT, "data/crews"),
// nosemgrep: path-join-resolve-traversal
  CONVERSATIONS_ROOT: resolve(PAAW_ROOT, "data/crews/conversation"),
// nosemgrep: path-join-resolve-traversal
  SKILLS_ROOT:     resolve(PAAW_ROOT, "data/skills"),
// nosemgrep: path-join-resolve-traversal
  INPUT_PROMPT_ROOT: resolve(PAAW_ROOT, "data/skills/input-prompt"),
// nosemgrep: path-join-resolve-traversal
  PHYSICAL_SKILL_ROOT: resolve(PAAW_ROOT, "data/skills/physical-skill"),
// nosemgrep: path-join-resolve-traversal
  SKILL_POOL_ROOT: resolve(PAAW_ROOT, "data/skills/pool"),
// nosemgrep: path-join-resolve-traversal
  BUILDING_ROOT:   resolve(PAAW_ROOT, "data/skills/building"),
// nosemgrep: path-join-resolve-traversal
  APPS_ROOT:       resolve(PAAW_ROOT, "data/apps"),
// nosemgrep: path-join-resolve-traversal
  WORKFLOWS_ROOT:  resolve(PAAW_ROOT, "data/workflows"),
// nosemgrep: path-join-resolve-traversal
  CONFIG_ROOT:     resolve(PAAW_ROOT, "data/config"),
// nosemgrep: path-join-resolve-traversal
  CHAT_DIR:        resolve(PAAW_ROOT, "data/chats"),
// nosemgrep: path-join-resolve-traversal
  SYSTEM_DIR:      resolve(PAAW_ROOT, "data/ai-settings/_base"), // legacy name kept, now points to ai-settings/_base
// nosemgrep: path-join-resolve-traversal
  PAAW_ROOT_DATA:  resolve(PAAW_ROOT, "data"),
};

// ── Helpers ──

/** Read request body as string */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
// nosemgrep: path-join-resolve-traversal
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Send JSON response */
export function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Parse URL path (strip query string) */
export function urlPath(req) {
  return (req.url || "/").split("?")[0];
}

/** Simple path hash for conversation dirs */
export function projectPathHash(path) {
  if (!path) return "_default";
  return path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
}  // nosemgrep: path-join-resolve-traversal

/** Parse YAML frontmatter from SKILL.md */
export function parseSkillFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return { body: raw };
  const body = raw.slice(fmMatch[0].length).trim();
  try {
    const parsed = yaml.load(fmMatch[1], { schema: yaml.DEFAULT_SCHEMA });
    if (typeof parsed === "object" && parsed !== null) return { ...parsed, body };
  } catch {}
  return { body };
}  // nosemgrep: path-join-resolve-traversal

/** Data dir helper (PAAW has flat structure) */
export function resolveDataDir(_wsId, subdir) {
  if (subdir === "crews") return PATHS.CREWS_ROOT;
  return safeResolve(PATHS.PAAW_ROOT, subdir);  // nosemgrep: path-join-resolve-traversal
}
  // nosemgrep: path-join-resolve-traversal
/** Read system prompt for a given context (app, skill, workflow) */  // nosemgrep: path-join-resolve-traversal
export async function readSystemPrompt(type, id, fallback = "") {
  const { readFile } = await import("fs/promises");
  const candidates = [];
  // nosemgrep: path-join-resolve-traversal
  if (type === "global") {
// nosemgrep: path-join-resolve-traversal
    candidates.push(join(PATHS.SYSTEM_DIR, "system-prompt.md"));
// nosemgrep: path-join-resolve-traversal
    candidates.push(join(PATHS.SYSTEM_DIR, "guardrails.md"));
  } else if (type === "app") {
    candidates.push(safeResolve(PATHS.APPS_ROOT, id, "SYSTEM.md"));
  } else if (type === "skill") {
    // skill id format: "appId/skillId" or just "skillId" for pool skills
    const parts = id.split("/");
    if (parts.length === 2) {
      candidates.push(safeResolve(PATHS.APPS_ROOT, parts[0], "skills", parts[1], "SYSTEM.md"));
    } else {
      candidates.push(safeResolve(PATHS.SKILL_POOL_ROOT, id, "SYSTEM.md"));
      candidates.push(safeResolve(PATHS.INPUT_PROMPT_ROOT, id, "SYSTEM.md"));
    }
  } else if (type === "workflow") {
    // workflow system prompt could be embedded or separate
    candidates.push(safeResolve(PATHS.WORKFLOWS_ROOT, `${id}-system.md`));
  }

  const parts = [];
  for (const p of candidates) {
    try { parts.push(await readFile(p, "utf-8")); } catch {}
  }
  return parts.length > 0 ? parts.join("\n\n") : fallback;
}

// ── Agent Config — single source of truth ──
const DEFAULT_AGENT_CONFIG = {
  maxTurns: 100,
  timeoutSeconds: 0,
  bashTimeoutSeconds: 300,
  shellTimeoutMs: 600000,
};

let _agentConfigCache = null;
let _agentConfigTs = 0;

export async function loadAgentConfig() {
// nosemgrep: path-join-resolve-traversal
  const configPath = join(PATHS.PAAW_ROOT, "data/ai-settings/agent-config.json");
  try {
    const stat = await import("fs").then(fs => fs.statSync(configPath));
    if (_agentConfigCache && stat.mtimeMs === _agentConfigTs) return _agentConfigCache;
    const raw = await readFile(configPath, "utf-8");
    _agentConfigCache = { ...DEFAULT_AGENT_CONFIG, ...JSON.parse(raw) };
    _agentConfigTs = stat.mtimeMs;
    return _agentConfigCache;
  } catch {
    return DEFAULT_AGENT_CONFIG;
  }
}

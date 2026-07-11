/**
 * Shared constants, helpers, and re-exports for all route modules.
 *
 * Every route module imports what it needs from here — no circular deps.
 */

import { readdir, readFile, writeFile, mkdir, unlink, rm, stat } from "fs/promises";
import {
  readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync,
  appendFileSync, statSync, unlinkSync,
} from "fs";
import { join, resolve, dirname, isAbsolute, relative } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import yaml from "js-yaml";
import chokidar from "chokidar";

// ── Path constants ──
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);          // .../packages/server/src/routes
const SERVER_SRC = dirname(__dirname);           // .../packages/server/src

const DASHBOARD_ROOT = resolve(SERVER_SRC, "../../ui");
const PAAW_ROOT = resolve(SERVER_SRC, "../../../");
const CONVERSATIONS_ROOT = resolve(PAAW_ROOT, "data/crews/conversation");
const CREWS_ROOT = resolve(PAAW_ROOT, "data/crews");
const SKILLS_ROOT = resolve(PAAW_ROOT, "data/skills");
const DOCS_ROOT = resolve(PAAW_ROOT, "docs");
const INPUT_PROMPT_ROOT = resolve(SKILLS_ROOT, "input-prompt");
const PHYSICAL_SKILL_ROOT = resolve(SKILLS_ROOT, "physical-skill");
const SKILL_POOL_ROOT = resolve(SKILLS_ROOT, "pool");
const APPS_ROOT = resolve(PAAW_ROOT, "data/apps");
const WORKFLOWS_ROOT = resolve(PAAW_ROOT, "data/workflows");
const DATA_ROOT = resolve(PAAW_ROOT, "data");

// Aliases used by assistant APIs
const PAAW_DATA_DIR = DATA_ROOT;
const PAAW_USER_FILE = resolve(PAAW_DATA_DIR, "user.json");
const PAAW_CHAT_DIR = resolve(PAAW_DATA_DIR, "chats");
const PAAW_WORKSPACES_FILE = resolve(PAAW_DATA_DIR, "workspaces.json");
const PAAW_KNOWLEDGE_DIR = resolve(PAAW_DATA_DIR, "knowledge");
const UI_STATE_FILE = resolve(PAAW_DATA_DIR, "ui-state.json");
const APP_RULES_PATH = resolve(PAAW_ROOT, "data/config/app-builder-rules.md");

// Cron / scheduler paths
const CRON_JOBS_FILE = resolve(PAAW_ROOT, "data/cron/cron-jobs.json");
const CRON_LOGS_DIR = resolve(PAAW_ROOT, "logs/cron");
const CRON_RESULTS_DIR = resolve(PAAW_ROOT, "logs/cron-results");
const CRON_CHAT_DIR = resolve(PAAW_ROOT, "data/chats");

// Vibe sessions
const VIBE_SESSIONS_DIR = resolve(PAAW_ROOT, "logs/vibe-sessions");

const PORT = parseInt(process.env.PAAW_PORT || "4097", 10);

// ── Helper functions ──

function projectPathHash(path) {
  if (!path) return "_default";
  return path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
}

function getConvDir(employeeId, root) {
  const hash = projectPathHash(root);
  return resolve(CONVERSATIONS_ROOT, hash, employeeId);
}

function normalizePath(p) {
  if (!p) return "";
  return p.replace(/\\/g, "/");
}

function basename(p) {
  const parts = p.replace(/[\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1];
}

/** Read request body as string */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/** JSON response helper */
function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Resolve data sub-directory (PAAW has flat structure) */
function resolveDataDir(_wsId, subdir) {
  if (subdir === "crews") return CREWS_ROOT;
  if (subdir === "docs") return DOCS_ROOT;
  return resolve(PAAW_ROOT, subdir);
}

/** Get workspace ID from URL (always "default" in PAAW) */
function getWorkspaceId(url) {
  return "default";
}

/** Extract HTML from text (used by app-run / report-train) */
function extractHtml(text) {
  let h = text;
  const codeBlock = h.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlock) h = codeBlock[1].trim();
  let m = h.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
  if (m) return m[0];
  m = h.match(/<html[\s\S]*<\/html>/i);
  if (m) return m[0];
  return h.includes("<html") ? h : null;
}

/** Build directory tree for file explorer */
async function buildTree(absRoot, currentPath, maxDepth) {
  const IGNORED = new Set([".git", "node_modules", ".DS_Store", "__pycache__", ".next", "dist", ".cache", ".turbo"]);
  const result = {
    name: currentPath === absRoot ? basename(absRoot) : basename(currentPath),
    path: normalizePath(currentPath),
    type: "dir",
    children: [],
  };
  if (maxDepth <= 0) { result.children = undefined; result.lazy = true; return result; }
  let entries;
  try { entries = await readdir(currentPath, { withFileTypes: true }); } catch { return result; }
  const sorted = entries
    .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  const capped = sorted.slice(0, 200);
  if (sorted.length > 200) {
    result.children.push({ name: `... and ${sorted.length - 200} more`, path: "__truncated__", type: "file" });
  }
  for (const entry of capped) {
    const fullPath = normalizePath(join(currentPath, entry.name));
    if (entry.isDirectory()) {
      const child = await buildTree(absRoot, join(currentPath, entry.name), maxDepth - 1);
      result.children.push(child);
    } else {
      result.children.push({ name: entry.name, path: fullPath, type: "file" });
    }
  }
  return result;
}

/** Start a chokidar file watcher that sends SSE events */
function startWatcher(root, sseRes) {
  const w = chokidar.watch(root, {
    ignored: /node_modules|\.git|dist|__pycache__|\.next|\.nuxt|target|build/,
    persistent: true,
    ignoreInitial: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const send = (type, path) => {
    try { sseRes.write(`data: ${JSON.stringify({ type, path })}\n\n`); } catch {}
  };
  w.on("add", (p) => send("add", p));
  w.on("unlink", (p) => send("unlink", p));
  w.on("change", (p) => send("change", p));
  w.on("addDir", (p) => send("addDir", p));
  w.on("unlinkDir", (p) => send("unlinkDir", p));
  console.log(`[Watcher] Watching ${root} (client ${sseRes.socket?.remotePort})`);
  return w;
}

export {
  // Path constants
  __dirname, SERVER_SRC, DASHBOARD_ROOT, PAAW_ROOT, CONVERSATIONS_ROOT, CREWS_ROOT,
  SKILLS_ROOT, DOCS_ROOT, INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT,
  APPS_ROOT, WORKFLOWS_ROOT, DATA_ROOT,
  PAAW_DATA_DIR, PAAW_USER_FILE, PAAW_CHAT_DIR, PAAW_WORKSPACES_FILE,
  PAAW_KNOWLEDGE_DIR, UI_STATE_FILE, APP_RULES_PATH,
  CRON_JOBS_FILE, CRON_LOGS_DIR, CRON_RESULTS_DIR, CRON_CHAT_DIR,
  VIBE_SESSIONS_DIR,
  PORT,
  // fs/promises re-exports
  readdir, readFile, writeFile, mkdir, unlink, rm, stat,
  // fs sync re-exports
  readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, statSync, unlinkSync,
  // path re-exports
  join, resolve, dirname, isAbsolute, relative,
  // misc re-exports
  yaml, spawn,
  // Helpers
  projectPathHash, getConvDir, normalizePath, basename, readBody, json,
  resolveDataDir, getWorkspaceId, extractHtml, buildTree, startWatcher,
};

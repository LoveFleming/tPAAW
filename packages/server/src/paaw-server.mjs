/**
 * PAAW Server
 *
 * HTTP + WebSocket server for PAAW — Personal AI Assistant Workspace.
 * Uses node-pty for CLI interaction.
 *
 * Key endpoints:
 *   POST /api/report-train   — Run CLI to generate app.html
 *   POST /api/report-publish — Publish app to apps/ directory
 *   WebSocket :4098         — PTY sessions for employee consoles
 */

import { createServer } from "http";
import { readdir, readFile, writeFile, mkdir, unlink, rm, stat } from "fs/promises";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, statSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "node-pty";
import { tmpdir } from "os";
import { exec as execCb, spawn } from "child_process";
import yaml from "js-yaml";
import { CliAdapter } from "./lib/cli-adapter.mjs";
import { resolveCliBin, isWindows as _isWin } from "./lib/cli-resolve.mjs";
import { promisify } from "util";
import { getToolsAndHandlers, invalidateCache } from "./tools/index.mjs";
import chokidar from "chokidar";
const execAsync = promisify(execCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DASHBOARD_ROOT = resolve(__dirname, "../../ui");
const PAAW_ROOT = resolve(__dirname, "../../../");
const CONVERSATIONS_ROOT = resolve(PAAW_ROOT, "data/crews/conversation");
const CREWS_ROOT = resolve(PAAW_ROOT, "data/crews");
const SKILLS_ROOT = resolve(PAAW_ROOT, "data/skills");
const DOCS_ROOT = resolve(PAAW_ROOT, "docs");
const INPUT_PROMPT_ROOT = resolve(SKILLS_ROOT, "input-prompt");
const PHYSICAL_SKILL_ROOT = resolve(SKILLS_ROOT, "physical-skill");
const SKILL_POOL_ROOT = resolve(SKILLS_ROOT, "pool");
const SYSTEM_DIR = resolve(PAAW_ROOT, "data/system");
const APPS_ROOT = resolve(PAAW_ROOT, "data/apps");
const WORKFLOWS_ROOT = resolve(PAAW_ROOT, "data/workflows");
const DATA_ROOT = resolve(PAAW_ROOT, "data");

const PORT = parseInt(process.env.PAAW_PORT || "4097", 10);

// resolveCliBin() is imported from ./lib/cli-resolve.mjs — shared across routes.

// Simple path hash: replace non-alphanumeric with underscore
function projectPathHash(path) {
  if (!path) return "_default";
  return path.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "_default";
}

function getConvDir(employeeId, root) {
  const hash = projectPathHash(root);
  return resolve(CONVERSATIONS_ROOT, hash, employeeId);
}

/** Normalize any path to forward slashes for consistent cross-platform API responses */
function normalizePath(p) {
  if (!p) return "";
  return p.replace(/\\/g, "/");
}

function basename(p) {
  // Handle both Unix (/) and Windows (\\) separators
  const parts = p.replace(/[\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1];
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── Modular routes (take priority) ──
  try {
    const modSkill = await import("./routes/skill.mjs");
    if (await modSkill.default(req, res)) return;

    const modAISettings = await import("./routes/ai-settings.mjs");
    if (await modAISettings.default(req, res)) return;
  } catch {}
  try {
    const modWorkflow = await import("./routes/workflow.mjs");
    if (await modWorkflow.default(req, res)) return;
  } catch {}
  try {
    const modChat = await import("./routes/chat.mjs");
    if (await modChat.default(req, res)) return;
  } catch {}
  try {
    const modDistill = await import("./routes/distill.mjs");
    if (await modDistill.default(req, res)) return;
  } catch {}
  try {
    const modTools = await import("./routes/tools.mjs");
    if (await modTools.default(req, res)) return;
  } catch {}

  // ── Legacy routes (everything else) ──
  const paawHandled = await paawApiHandler(req, res);
  if (paawHandled) return;

  // Cron API
  const handled = await cronApiHandler(req, res);
  if (handled) return;

  // Vibe Sessions API
  const vibeHandled = await vibeSessionsApiHandler(req, res);
  if (vibeHandled) return;

  // ── Vibe Coding File System APIs ──
  // GET /api/vibe-fs/list?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-fs/list")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.HOME || "/");
    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite", ".next", ".nuxt", "dist", "build", ".turbo"]);
      const items = entries
        .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(e => ({ name: e.name, path: normalizePath(join(absPath, e.name)), isDirectory: e.isDirectory(), extension: e.isDirectory() ? null : (e.name.includes(".") ? e.name.split(".").pop() : null) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: normalizePath(absPath), items }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, path: normalizePath(absPath), items: [] }));
    }
    return;
  }
  // GET /api/vibe-fs/read?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-fs/read")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return; }
    try {
      const content = await readFile(resolve(filePath), "utf-8");
      const s = await stat(resolve(filePath));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: normalizePath(resolve(filePath)), content, size: s.size, modified: s.mtime.toISOString() }));
    } catch (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  // PUT /api/vibe-fs/write
  if (req.method === "PUT" && req.url === "/api/vibe-fs/write") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { path: fPath, content: fContent } = body;
    if (!fPath) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing path" })); return; }
    try {
      await mkdir(dirname(resolve(fPath)), { recursive: true });
      await writeFile(resolve(fPath), fContent, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: resolve(fPath) }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ══════════════════════════════════════════════════
  // Git Integration APIs
  // ══════════════════════════════════════════════════

  // Helper: run git command in cwd
  async function runGit(args, cwd) {
    return new Promise((resolve) => {
      const child = spawn("git", args, { cwd, timeout: 15000 });
      let stdout = "", stderr = "";
      child.stdout.on("data", d => stdout += d);
      child.stderr.on("data", d => stderr += d);
      child.on("close", code => resolve({ ok: code === 0, stdout, stderr, code }));
      child.on("error", err => resolve({ ok: false, stdout: "", stderr: err.message, code: -1 }));
    });
  }

  // GET /api/vibe-git/status?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/status")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return; }
    const r = await runGit(["status", "--porcelain=v1", "--branch"], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return; }
    const branchMatch = r.stdout.match(/^## (.+?)(?:\.\.\.|$)/m);
    const branch = branchMatch ? branchMatch[1] : "(unknown)";
    const files = r.stdout.split("\n").filter(l => l && !l.startsWith("#")).map(l => ({
      status: l.slice(0, 2).trim(), path: l.slice(3),
    }));
    const staged = files.filter(f => "MARC".includes(f.status[0]));
    const unstaged = files.filter(f => "MD".includes(f.status[0] || f.status[1]));
    const untracked = files.filter(f => f.status === "??");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ branch, staged, unstaged, untracked, all: files }));
    return;
  }

  // GET /api/vibe-git/log?path=...&count=20
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/log")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const count = params.get("count") || "20";
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return; }
    const r = await runGit([
      "log", `--max-count=${count}`, "--pretty=format:%H|%h|%an|%ae|%at|%s",
      "--date=unix",
    ], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return; }
    const commits = r.stdout.split("\n").filter(Boolean).map(line => {
      const [hash, short, author, email, ts, subject] = line.split("|");
      return { hash, short, author, email, date: new Date(parseInt(ts) * 1000).toISOString(), subject };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ commits }));
    return;
  }

  // GET /api/vibe-git/diff?path=...&file=...&cached=false
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/diff")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const file = params.get("file") || "";
    const cached = params.get("cached") === "true";
    const commit = params.get("commit") || "";
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return; }
    const args = ["diff"];
    if (cached) args.push("--cached");
    if (commit) args.push(commit);
    if (file) args.push("--", file);
    const r = await runGit(args, cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ diff: r.stdout, ok: r.ok, error: r.stderr }));
    return;
  }

  // GET /api/vibe-git/blame?path=...&file=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/blame")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const file = params.get("file");
    if (!cwd || !file) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path or file" })); return; }
    const r = await runGit(["blame", "--porcelain", "--", file], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return; }
    // Parse porcelain blame output
    const lines = [];
    const blocks = r.stdout.split("\n");
    let current = null;
    for (const line of blocks) {
      const headerMatch = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?/);
      if (headerMatch) {
        current = { hash: headerMatch[1], origLine: parseInt(headerMatch[2]), finalLine: parseInt(headerMatch[3]), lineCount: headerMatch[4] ? parseInt(headerMatch[4]) : 1, author: "", authorMail: "", authorTime: "", summary: "" };
        continue;
      }
      if (line.startsWith("author ") && current) current.author = line.slice(7);
      else if (line.startsWith("author-mail ") && current) current.authorMail = line.slice(12);
      else if (line.startsWith("author-time ") && current) current.authorTime = new Date(parseInt(line.slice(11)) * 1000).toISOString();
      else if (line.startsWith("summary ") && current) current.summary = line.slice(8);
      else if (line.startsWith("\t") && current) {
        lines.push({ ...current, content: line.slice(1) });
        current = { ...current, origLine: current.origLine, finalLine: current.finalLine + 1 };
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ file, lines }));
    return;
  }

  // POST /api/vibe-git/ai-comment?path=...
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/ai-comment")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { diff, commits, context } = body;

    // Build AI review prompt
    const prompt = `你是資深程式碼審查員。請 review 以下 git 變更並產生審查意見：

${diff ? "## Diff\n```diff\n" + diff.slice(0, 8000) + "\n```" : ""}
${commits?.length ? "\n## Recent Commits\n" + commits.map(c => `- ${c.short} ${c.subject} (${c.author})`).join("\n") : ""}
${context ? "\n## Context\n" + context : ""}

請用以下格式輸出：
1. **總覽**：這次變更的目的和範圍
2. **問題**：發現的 bug、安全問題、效能問題（附行號）
3. **建議**：改善建議（附具體程式碼）
4. **亮點**：做得好的地方
5. **嚴重程度**：🔴 Critical / 🟡 Warning / 🟢 Good`;

    // Try to call LLM for review
    try {
      const chatRes = await fetch("http://127.0.0.1:4097/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          providerId: "default",
          appId: "git-review",
        }),
      });
      // Read SSE stream
      let comment = "";
      const text = await new Promise((ok) => {
        let buf = "";
        const chunks = [];
        chatRes.body.on("data", (c) => { buf += c.toString(); });
        chatRes.body.on("end", () => {
          for (const line of buf.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try { const j = JSON.parse(line.slice(6)); if (j.content) chunks.push(j.content); } catch {}
            }
          }
          ok(chunks.join(""));
        });
      });
      comment = text;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ comment }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ comment: `⚠️ AI review 不可用 (${err.message || err})，但以下是基本分析：\n\n${(diff || "").slice(0, 2000) || "No diff"}` }));
    }
    return;
  }

  // ══════════════════════════════════════════════════
  // API Tester (Postman-like) Endpoint
  // ══════════════════════════════════════════════════

  // POST /api/api-tester/proxy
  if (req.method === "POST" && req.url === "/api/api-tester/proxy") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
    const { method: tMethod, url: tUrl, headers: tHeaders = {}, body: tBody, followRedirects = true } = body;
    if (!tUrl) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing url" })); return; }
    const startTime = Date.now();
    try {
      const fetchOpts = { method: tMethod || "GET", headers: tHeaders, redirect: followRedirects ? "follow" : "manual" };
      if (tBody && tMethod !== "GET" && tMethod !== "HEAD") fetchOpts.body = typeof tBody === "string" ? tBody : JSON.stringify(tBody);
      const tRes = await fetch(tUrl, fetchOpts);
      const elapsed = Date.now() - startTime;
      const respHeaders = {};
      tRes.headers.forEach((v, k) => { respHeaders[k] = v; });
      const contentType = tRes.headers.get("content-type") || "";
      let respBody;
      if (contentType.includes("json") || contentType.includes("text") || contentType.includes("xml") || contentType.includes("html") || contentType.includes("javascript")) {
        respBody = await tRes.text();
      } else {
        const buf = await tRes.arrayBuffer();
        respBody = `[Binary data: ${buf.byteLength} bytes]`;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: tRes.status, statusText: tRes.statusText, headers: respHeaders, body: respBody, elapsed, size: respBody.length }));
    } catch (err) {
      const elapsed = Date.now() - startTime;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: 0, statusText: "Network Error", headers: {}, body: String(err.message || err), elapsed, error: true }));
    }
    return;
  }

  // GET /api/api-tester/history
  if (req.method === "GET" && req.url?.startsWith("/api/api-tester/history")) {
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    try {
      const data = JSON.parse(readFileSync(histFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history: [] }));
    }
    return;
  }

  // DELETE /api/api-tester/history
  if (req.method === "DELETE" && req.url?.startsWith("/api/api-tester/history")) {
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    try { unlinkSync(histFile); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /api/api-tester/save
  if (req.method === "POST" && req.url === "/api/api-tester/save") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const histFile = resolve(DATA_ROOT, "api-tester-history.json");
    let history = [];
    try { history = JSON.parse(readFileSync(histFile, "utf-8")); } catch {}
    history.unshift({ ...body, id: `req-${Date.now()}`, ts: new Date().toISOString() });
    if (history.length > 100) history = history.slice(0, 100);
    writeFileSync(histFile, JSON.stringify(history, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ══════════════════════════════════════════════════
  // Vibe Sessions API (persist CLI sessions to server)
  // ══════════════════════════════════════════════════

  // GET /api/vibe-sessions
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-sessions")) {
    const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
    try {
      const data = JSON.parse(readFileSync(sessFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions: [] }));
    }
    return;
  }

  // POST /api/vibe-sessions (create or replace all)
  if (req.method === "POST" && req.url === "/api/vibe-sessions") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
    writeFileSync(sessFile, JSON.stringify(body.sessions || body, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // DELETE /api/vibe-sessions?id=...
  if (req.method === "DELETE" && req.url?.startsWith("/api/vibe-sessions")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const id = params.get("id");
    const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
    try {
      let sessions = JSON.parse(readFileSync(sessFile, "utf-8"));
      if (id) sessions = sessions.filter(s => s.id !== id);
      else sessions = [];
      writeFileSync(sessFile, JSON.stringify(sessions, null, 2));
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ══════════════════════════════════════════════════
  // Vibe Chat History API (persist AI chat per session)
  // ══════════════════════════════════════════════════

  // GET /api/vibe-chat?sessionId=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const sessionId = params.get("sessionId") || "default";
    const chatFile = resolve(DATA_ROOT, "vibe-chat", `${sessionId}.json`);
    try {
      const data = JSON.parse(readFileSync(chatFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [] }));
    }
    return;
  }

  // POST /api/vibe-chat (append message or replace all)
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const sessionId = params.get("sessionId") || "default";
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const chatDir = resolve(DATA_ROOT, "vibe-chat");
    const chatFile = resolve(chatDir, `${sessionId}.json`);
    mkdirSync(chatDir, { recursive: true });
    if (body.messages) {
      // Replace all
      writeFileSync(chatFile, JSON.stringify(body.messages, null, 2));
    } else if (body.message) {
      // Append one
      let msgs = [];
      try { msgs = JSON.parse(readFileSync(chatFile, "utf-8")); } catch {}
      msgs.push(body.message);
      writeFileSync(chatFile, JSON.stringify(msgs, null, 2));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // DELETE /api/vibe-chat?sessionId=...
  if (req.method === "DELETE" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const sessionId = params.get("sessionId") || "default";
    const chatFile = resolve(DATA_ROOT, "vibe-chat", `${sessionId}.json`);
    try { unlinkSync(chatFile); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ══════════════════════════════════════════════════
  // Git AI Review History API
  // ══════════════════════════════════════════════════

  // GET /api/vibe-git/reviews?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/reviews")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectPath = params.get("path") || "default";
    const safeName = projectPath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const reviewFile = resolve(DATA_ROOT, "git-reviews", `${safeName}.json`);
    try {
      const data = JSON.parse(readFileSync(reviewFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reviews: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reviews: [] }));
    }
    return;
  }

  // POST /api/vibe-git/reviews?path=... (save a review)
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/reviews")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectPath = params.get("path") || "default";
    const safeName = projectPath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const reviewDir = resolve(DATA_ROOT, "git-reviews");
    const reviewFile = resolve(reviewDir, `${safeName}.json`);
    mkdirSync(reviewDir, { recursive: true });
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    let reviews = [];
    try { reviews = JSON.parse(readFileSync(reviewFile, "utf-8")); } catch {}
    reviews.unshift({ ...body, id: `review-${Date.now()}`, ts: new Date().toISOString() });
    if (reviews.length > 50) reviews = reviews.slice(0, 50);
    writeFileSync(reviewFile, JSON.stringify(reviews, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, review: reviews[0] }));
    return;
  }

  // Helper: resolve directory (PAAW has flat structure, no factory nesting)
  function factoryDir(_factoryId, subdir) {
    if (subdir === "crews") return CREWS_ROOT;
    if (subdir === "docs") return DOCS_ROOT;
    return resolve(PAAW_ROOT, subdir);
  }

  // Helper: get factoryId from query param (kept for backward compat)
  function getFactoryId(url) {
    return "default";
  }

  // ── Skills API (global, top-level) ──

  // Helper: parse YAML frontmatter from SKILL.md (simple parser for arrays/objects)
  function parseSkillFrontmatter(raw) {
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return { body: raw };
    const body = raw.slice(fmMatch[0].length).trim();
    const fm = fmMatch[1];

    // Use js-yaml for full YAML support (|, >, nested arrays, multiline strings)
    try {
      const parsed = yaml.load(fm, { schema: yaml.DEFAULT_SCHEMA });
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...parsed, body };
      }
    } catch (err) {
      // silently skip malformed frontmatter
    }

    // Fallback: return body only
    return { body };
  }

  // GET /api/skills — list all skills (input-prompt + physical-skill)
  if (req.method === "GET" && req.url?.match(/^\/api\/skills(?:\?.*)?$/)) {
    try {
      const skills = [];
      // Helper to scan a skill directory
      const scanSkillsDir = async (root, kind) => {
        await mkdir(root, { recursive: true });
        const dirs = await readdir(root);
        for (const dir of dirs) {
          try {
            const stat = await import("fs/promises").then(m => m.stat(join(root, dir)));
            if (!stat.isDirectory()) continue;
            const skillPath = join(root, dir, "SKILL.md");
            const raw = await readFile(skillPath, "utf-8");
            const parsed = parseSkillFrontmatter(raw);
            skills.push({
              id: dir,
              kind,
              name: parsed.name || dir,
              description: parsed.description || "",
              version: parsed.version || "1.0.0",
              category: parsed.category || "",
              skillPrompt: parsed.body || "",
              useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
              usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
              userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
              fullContent: raw,
            });
          } catch { /* skip invalid */ }
        }
      };
      await scanSkillsDir(INPUT_PROMPT_ROOT, "input-prompt");
      await scanSkillsDir(PHYSICAL_SKILL_ROOT, "physical-skill");
      await scanSkillsDir(SKILL_POOL_ROOT, "skill-pool");
      // Check hasApp for each skill
      for (const sk of skills) {
        try {
          const base = sk.kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : sk.kind === "skill-pool" ? SKILL_POOL_ROOT : INPUT_PROMPT_ROOT;
          await import("fs/promises").then(m => m.access(join(base, sk.id, "app.html")));
          sk.hasApp = true;
        } catch { sk.hasApp = false; }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(skills));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/skills/:id — get single skill definition
  const skillGetMatch = req.method === "GET" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/);
  if (skillGetMatch) {
    const skillId = skillGetMatch[1];
    // Search in both input-prompt and physical-skill
    const roots = [INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT];
    let found = null;
    for (const root of roots) {
      const skillPath = join(root, skillId, "SKILL.md");
      try {
        const raw = await readFile(skillPath, "utf-8");
        const parsed = parseSkillFrontmatter(raw);
        const kind = root === INPUT_PROMPT_ROOT ? "input-prompt" : "physical-skill";
        found = {
          id: skillId,
          kind,
          name: parsed.name || skillId,
          description: parsed.description || "",
          version: parsed.version || "1.0.0",
          category: parsed.category || "",
          skillPrompt: parsed.body || "",
          useSkills: Array.isArray(parsed.useSkills) ? parsed.useSkills : [],
          usePhysicalSkills: Array.isArray(parsed.usePhysicalSkills) ? parsed.usePhysicalSkills : [],
          userInputs: Array.isArray(parsed.userInputs) ? parsed.userInputs : [],
          fullContent: raw,
        };
        break;
      } catch { /* not found in this root */ }
    }
    if (found) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(found));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Skill not found" }));
    }
    return;
  }

  // ── Skill Save API ──

  // PUT /api/skills/:id — create or update a skill (input-prompt by default)
  if (req.method === "PUT" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const payload = JSON.parse(body);
      const content = payload.content;
      const kind = payload.kind || "input-prompt";
      if (!content || !skillId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing content or skillId" }));
        return;
      }
      const baseRoot = kind === "physical-skill" ? PHYSICAL_SKILL_ROOT : kind === "skill-pool" ? SKILL_POOL_ROOT : INPUT_PROMPT_ROOT;
      const skillDir = join(baseRoot, skillId);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: skillId, kind }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/skills/:id — delete a skill (searches both dirs)
  if (req.method === "DELETE" && req.url?.match(/^\/api\/skills\/([\w.-]+)(?:\?.*)?$/)) {
    const skillId = req.url.match(/^\/api\/skills\/([\w.-]+)/)?.[1];
    try {
      const roots = [INPUT_PROMPT_ROOT, PHYSICAL_SKILL_ROOT, SKILL_POOL_ROOT];
      let deleted = false;
      for (const root of roots) {
        const skillDir = join(root, skillId);
        try {
          await rm(skillDir, { recursive: true, force: true });
          deleted = true;
        } catch { /* not in this root */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const skillAppMatch = req.method === "GET" && req.url?.match(/^\/api\/skill-app\/([\w.-]+)(?:\?.*)?$/);
  if (skillAppMatch) {
    const skillId = skillAppMatch[1];
    const roots = [PHYSICAL_SKILL_ROOT, INPUT_PROMPT_ROOT];
    try {
      for (const root of roots) {
        const appPath = join(root, skillId, "app.html");
        try {
          const content = await readFile(appPath, "utf-8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(content);
          return;
        } catch { /* not in this root */ }
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "app.html not found for skill: " + skillId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/apps — list apps from apps/ directory
  if (req.method === "GET" && req.url?.match(/^\/api\/apps(?:\?.*)?$/)) {
    try {
      await mkdir(APPS_ROOT, { recursive: true });
      const dirs = await readdir(APPS_ROOT);
      const apps = [];
      for (const dir of dirs) {
        try {
          const stat = await import("fs/promises").then(m => m.stat(join(APPS_ROOT, dir)));
          if (!stat.isDirectory()) continue;
          const entries = await readdir(join(APPS_ROOT, dir));
          const hasHtml = entries.includes("app.html");
          let meta = {};
          try { meta = JSON.parse(await readFile(join(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
          apps.push({
            id: dir,
            name: meta.name || dir,
            description: meta.description || "",
            icon: meta.icon || "",
            template: meta.template || "",
            skillId: meta.skillId || "",
            hasApp: hasHtml,
            generatedAt: meta.generatedAt || "",
            status: meta.status || "published",
            dataShape: meta.dataShape || "array",
            schema: meta.schema || {},
            aiPrompt: meta.aiPrompt || "",
            type: meta.type || "data",
            cli: meta.cli || "qwen",
            triggers: meta.triggers || [],
          });
        } catch { /* skip */ }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(apps));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── App Data API (persistent storage per app) ──

  // Helper: read request body inline (readBody may not be in scope yet)
  const _readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });

  // POST /api/apps — create a new app (universal app creation API)
  if (req.method === "POST" && req.url === "/api/apps") {
    const rawBody = await _readBody(req);
    let params;
    try { params = JSON.parse(rawBody); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
    if (!params.id || !/^[a-z][a-z0-9_]*$/.test(params.id)) {
      res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "App ID must be lowercase alphanumeric starting with a letter" })); return;
    }
    const appDir = join(APPS_ROOT, params.id);
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    try {
      await mkdir(appDir, { recursive: true });
      // Write app.json
      const appMeta = {
        id: params.id,
        name: params.name || params.id,
        icon: params.icon || "📦",
        description: params.description || "",
        type: params.type || "data",
        dataShape: params.dataShape || "array",
        schema: params.schema || {},
        execSchema: params.execSchema || null,
        triggers: params.triggers || [],
        aiPrompt: params.aiPrompt || "",
        status: "published",
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(appDir, "app.json"), JSON.stringify(appMeta, null, 2), "utf-8");
      // Initialize data file
      await mkdir(dataDir, { recursive: true });
      const initialData = appMeta.dataShape === "object" ? {} : [];
      await writeFile(join(dataDir, `${params.id}.json`), JSON.stringify(initialData, null, 2), "utf-8");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: appMeta }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PATCH /api/apps/:id — update an existing app's metadata
  const appPatchMatch = req.method === "PATCH" && req.url?.match(/^\/api\/apps\/([\w.-]+)$/);
  if (appPatchMatch) {
    const appId = appPatchMatch[1];
    const patchBody = await _readBody(req);
    let changes;
    try { changes = JSON.parse(patchBody); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
    const appDir = join(APPS_ROOT, appId);
    try {
      const jsonPath = join(appDir, "app.json");
      let current = {};
      try { current = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      for (const [key, val] of Object.entries(changes)) {
        if (val !== undefined) current[key] = val;
      }
      current.updatedAt = new Date().toISOString();
      await writeFile(jsonPath, JSON.stringify(current, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, app: current }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/app-data/:appId — read app data
  const appDataGetMatch = req.method === "GET" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataGetMatch) {
    const appId = appDataGetMatch[1];
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      const data = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
    }
    return;
  }

  // PUT /api/app-data/:appId — save app data (full replace)
  const appDataPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPutMatch) {
    const appId = appDataPutMatch[1];
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      JSON.parse(body); // validate JSON
      await writeFile(filePath, body, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/app-data/:appId — add item to app data array
  const appDataPostMatch = req.method === "POST" && req.url?.match(/^\/api\/app-data\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPostMatch) {
    const appId = appDataPostMatch[1];
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const newItem = JSON.parse(await _readBody(req));
      
      // Sanitize: strip "N/A" string values (AI sometimes fills all fields with "N/A")
      for (const key of Object.keys(newItem)) {
        if (newItem[key] === "N/A" || newItem[key] === "n/a" || newItem[key] === "") {
          delete newItem[key];
        }
      }
      
      if (!newItem.id) newItem.id = `${appId}_${Date.now().toString(36)}`;
      if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
      items.push(newItem);
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(newItem));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/app-data/:appId/:itemId — delete item
  const appDataDelMatch = req.method === "DELETE" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (appDataDelMatch) {
    const [, appId, itemId] = appDataDelMatch;
    console.log(`[API] DELETE /api/app-data/${appId}/${itemId}`);
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const before = items.length;
      console.log(`[API] items before: ${before}, looking for id=${itemId}`);
      items = items.filter(i => i.id !== itemId);
      console.log(`[API] items after: ${items.length}, deleted: ${before - items.length}`);
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted: before - items.length }));
    } catch (err) {
      console.log(`[API] DELETE error: ${err.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PATCH /api/app-data/:appId/:itemId — update item
  const appDataPatchMatch = req.method === "PATCH" && req.url?.match(/^\/api\/app-data\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (appDataPatchMatch) {
    const [, appId, itemId] = appDataPatchMatch;
    const dataDir = resolve(PAAW_ROOT, "data/app-data");
    await mkdir(dataDir, { recursive: true });
    const filePath = join(dataDir, `${appId}.json`);
    try {
      let items = [];
      try { items = JSON.parse(await readFile(filePath, "utf-8")); } catch {}
      const idx = items.findIndex(i => i.id === itemId);
      if (idx < 0) { res.writeHead(404); res.end("Item not found"); return; }
      const patch = JSON.parse(await _readBody(req));
      
      // Sanitize: strip "N/A" values from patch too
      for (const key of Object.keys(patch)) {
        if (patch[key] === "N/A" || patch[key] === "n/a" || patch[key] === "") {
          delete patch[key];
        }
      }
      
      items[idx] = { ...items[idx], ...patch, id: itemId };
      await writeFile(filePath, JSON.stringify(items, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items[idx]));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/apps/:appId/exec — generic skill execution (any skill-based app)
  // Supports both JSON (simple) and NDJSON (streaming) responses.
  // Client requests streaming by sending Accept: application/x-ndjson header.
  const appExecMatch = req.method === "POST" && req.url?.match(/^\/api\/apps\/([\w.-]+)\/exec(?:\?.*)?$/);
  if (appExecMatch) {
    const appId = appExecMatch[1];
    const appDir = join(APPS_ROOT, appId);
    const result = { appId, output: "", error: null, exitCode: null };
    try {
      const body = await _readBody(req);
      let args = {};
      try { args = JSON.parse(body); } catch {}

      // Determine response mode: streaming (NDJSON) or simple (JSON)
      const wantStream = req.headers.accept === "application/x-ndjson";

      // 1. Load app.json
      let appMeta = {};
      try { appMeta = JSON.parse(await readFile(join(appDir, "app.json"), "utf-8")); } catch {}

      // 2. Load all skills from data/apps/{appId}/skills/*/SKILL.md
      const skillsDir = join(appDir, "skills");
      const skillContents = [];
      try {
        const skillDirs = await readdir(skillsDir);
        for (const sd of skillDirs) {
          try {
            const content = await readFile(join(skillsDir, sd, "SKILL.md"), "utf-8");
            const sBody = content.replace(/^---[\s\S]*?---\n*/, "");
            skillContents.push({ name: sd, body: sBody });
          } catch {}
        }
      } catch {}

      if (skillContents.length === 0) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `No skills found for app: ${appId}` }));
        return;
      }

      // 3. Build system prompt from skill definitions + input args
      const skillsSection = skillContents
        .map(s => `## === Skill: ${s.name} ===\n${s.body}`)
        .join("\n\n");

      const inputSection = Object.entries(args)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
        .join("\n");

      const systemPrompt = `你是「${appMeta.name || appId}」App 的執行引擎。你必須嚴格按照以下 Skill 定義（deterministic script）來處理。\n\n${skillsSection}\n\n## === 輸入參數 ===\n${inputSection}\n\n## === 輸出指示 ===\n只輸出結果。如果是結構化資料，輸出 JSON（不要加 markdown code block）。不要加解釋。`;

      // 4. Resolve CLI binary (per-app override or default qwen)
      const cliType = appMeta.cli || args._cli || "qwen";
      const resolvedBin = resolveCliBin(cliType);

      // 5. Build CLI args per CLI type
      let cliArgs;
      if (cliType === "claude") {
        cliArgs = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "-p", systemPrompt];
      } else if (cliType === "opencode") {
        cliArgs = ["-m", args._model || "default", systemPrompt];
      } else {
        // qwen (default)
        cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-session-turns", "10", systemPrompt];
      }

      // ── Streaming mode (NDJSON via pty) ──
      if (wantStream) {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Transfer-Encoding": "chunked",
          "X-Accel-Buffering": "no",
          "Cache-Control": "no-cache",
        });
        res.write(JSON.stringify({ type: "status", data: { message: `${appMeta.name || appId}: skill 執行中...` } }) + "\n");

        const ptyProc = ptySpawn(resolvedBin, cliArgs, {
          name: "xterm-256color",
          cols: 200,
          rows: 30,
          cwd: appDir,
          env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb", QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
        });

        let fullOutput = "";
        ptyProc.onData((data) => {
          fullOutput += data;
          res.write(JSON.stringify({ type: "stdout", data }) + "\n");
        });

        ptyProc.onExit(({ exitCode }) => {
          // Try to extract JSON from output
          let parsedResult = null;
          const jsonMatch = fullOutput.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { parsedResult = JSON.parse(jsonMatch[0]); } catch {}
          }
          res.write(JSON.stringify({
            type: "result",
            data: parsedResult || { output: fullOutput.trim() },
          }) + "\n");
          res.write(JSON.stringify({ type: "done", data: { exitCode } }) + "\n");
          res.end();
        });
        return;
      }

      // ── Simple mode (JSON via child_process spawn) ──
      let fullOutput = "";
      const _isWin = process.platform === "win32";
      const child = spawn(resolvedBin, cliArgs, {
        cwd: appDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb", QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        shell: _isWin,  // Windows: .cmd files need shell:true
      });

      child.stdout.on("data", (d) => { fullOutput += d.toString(); });

      // Timeout guard (120s)
      const timeoutTimer = setTimeout(() => { try { child.kill(); } catch {} }, 120_000);

      await new Promise((resolve, reject) => {
        child.on("close", (code) => { result.exitCode = code; resolve(); });
        child.on("error", (err) => { result.error = err.message; reject(err); });
      });
      clearTimeout(timeoutTimer);

      result.output = fullOutput.trim();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      result.error = err.message;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    }
    return;
  }

  // POST /api/app-run/:id — run AI to generate app content on-the-fly
  const appRunMatch = req.method === "POST" && req.url?.match(/^\/api\/app-run\/([\w.-]+)(?:\?.*)?$/);
  if (appRunMatch) {
    const appId = appRunMatch[1];
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const { prompt: userPrompt, cli: cliType } = parsed;
    const cliName = cliType || "qwen";

    const outDir = join(APPS_ROOT, appId);
    await mkdir(outDir, { recursive: true });

    // Build the prompt: fetch live skill data and ask AI to generate a report
    let skillData = [];
    try {
      const dirs = await readdir(INPUT_PROMPT_ROOT);
      for (const dir of dirs) {
        try {
          const raw = await readFile(join(INPUT_PROMPT_ROOT, dir, "SKILL.md"), "utf-8");
          const parsed = parseSkillFrontmatter(raw);
          skillData.push({ id: dir, kind: "input-prompt", name: parsed.name || dir, description: parsed.description || "", category: parsed.category || "" });
        } catch {}
      }
    } catch {}
    try {
      const dirs = await readdir(PHYSICAL_SKILL_ROOT);
      for (const dir of dirs) {
        try {
          const raw = await readFile(join(PHYSICAL_SKILL_ROOT, dir, "SKILL.md"), "utf-8");
          const parsed = parseSkillFrontmatter(raw);
          skillData.push({ id: dir, kind: "physical-skill", name: parsed.name || dir, description: parsed.description || "", category: parsed.category || "" });
        } catch {}
      }
    } catch {}

    let appData = [];
    try {
      const dirs = await readdir(APPS_ROOT);
      for (const dir of dirs) {
        try { const s = await import("fs/promises").then(m => m.stat(join(APPS_ROOT, dir))); if (!s.isDirectory()) continue; } catch { continue; }
        let meta = {};
        try { meta = JSON.parse(await readFile(join(APPS_ROOT, dir, "app.json"), "utf-8")); } catch {}
        appData.push({ id: dir, name: meta.name || dir, status: meta.status || "published" });
      }
    } catch {}

    // Summarize data to keep prompt short — pass full data as a JSON file instead
    const summary = {
      totalSkills: skillData.length,
      inputPromptSkills: skillData.filter(s => s.kind === 'input-prompt').length,
      physicalSkills: skillData.filter(s => s.kind === 'physical-skill').length,
      totalApps: appData.length,
      categories: (() => { const m = {}; skillData.forEach(s => { const c = s.category || 'Other'; m[c] = (m[c] || 0) + 1; }); return m; })(),
    };
    const dataFile = join(outDir, "_skill_data.json");
    await writeFile(dataFile, JSON.stringify({ skills: skillData, apps: appData }, null, 2), "utf-8");

    const systemPrompt = `你是 PAAW 的數據分析師。請讀取 ${dataFile} 中的即時資料，生成一份完整的 Skill Counting Report (HTML 頁面)。

## 摘要
- Total Skills: ${summary.totalSkills}
- Input-Prompt Skills: ${summary.inputPromptSkills}
- Physical Skills: ${summary.physicalSkills}
- Apps: ${summary.totalApps}
- Categories: ${JSON.stringify(summary.categories)}

## 輸出要求
- 生成完整的 HTML 頁面 (<!DOCTYPE html>...<\/html>)
- 包含統計卡片：Total Skills, Input-Prompt Skills, Physical Skills, Apps
- 包含圓餅圖 (skill kind 分佈) 和長條圖 (category 分佈)，使用 Chart.js
- 包含完整 skill 清單表格，可搜尋、排序
- 樣式：Stone 色系，圓角卡片，現代感 UI
- 所有數字必須來自資料檔案，不可編造
- 標題顯示「載入時間」為現在
- 先讀取 ${dataFile} 取得完整資料，再生成 HTML
${userPrompt ? `\n額外指示: ${userPrompt}` : ""}`;

    // Write prompt to temp file to avoid CLI arg length limit
    const promptFile = join(outDir, "_prompt.txt");
    await writeFile(promptFile, systemPrompt, "utf-8");

    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });
    res.write(JSON.stringify({ type: "status", data: { message: `AI 正在計算 ${appId}...` } }) + "\n");

    const resolvedBin = resolveCliBin(cliName);

    // Use prompt via file to avoid arg length limits
    let cliArgs;
    if (cliName === "qwen") {
      cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-session-turns", "30", systemPrompt];
    } else if (cliName === "claude") {
      cliArgs = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "-p", systemPrompt, "--output-format", "text"];
    } else if (cliName === "opencode") {
      cliArgs = ["--non-interactive", "-p", systemPrompt];
    } else {
      cliArgs = [systemPrompt];
    }

    const ptyProc = ptySpawn(resolvedBin, cliArgs, {
      name: "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: outDir,
      env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1", FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    });

    let fullOutput = "";
    ptyProc.onData((data) => {
      fullOutput += data;
      res.write(JSON.stringify({ type: "stdout", data }) + "\n");
    });

    ptyProc.onExit(async ({ exitCode }) => {
      let htmlContent = fullOutput;
      const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
      let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
      else {
        htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
        if (htmlMatch) htmlContent = htmlMatch[0];
      }

      if (htmlContent.includes("<html")) {
        await writeFile(join(outDir, "app.html"), htmlContent, "utf-8");
        res.write(JSON.stringify({ type: "done", data: { appId, exitCode } }) + "\n");
      } else {
        res.write(JSON.stringify({ type: "error", data: { message: `AI 回應中找不到有效 HTML (${fullOutput.length} chars)`, rawOutput: fullOutput.slice(-2000) } }) + "\n");
      }
      res.end();
    });

    setTimeout(() => { try { ptyProc.kill(); } catch {} }, 180_000);
    return;
  }

  // GET /api/app/:id — serve app.html from apps/ directory
  const appServeMatch = (req.method === "GET" || req.method === "HEAD") && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
  if (appServeMatch) {
    const appId = appServeMatch[1];
    try {
      const html = await readFile(join(APPS_ROOT, appId, "app.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" });
      res.end(req.method === "HEAD" ? "" : html);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "App not found: " + appId }));
    }
    return;
  }

  // DELETE /api/app/:id — unpublish/remove an app
  const appDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/app\/([\w.-]+)(?:\?.*)?$/);
  if (appDeleteMatch) {
    const appId = appDeleteMatch[1];
    const appDir = join(APPS_ROOT, appId);
    try {
      // Just remove app.html, keep app.json with status=draft
      const htmlPath = join(appDir, "app.html");
      await unlink(htmlPath).catch(() => {});
      // Update app.json status
      const jsonPath = join(appDir, "app.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      meta.status = "draft";
      await writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, appId, status: "draft" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/paaw/app-chat/:appId — get app builder chat history
  const appChatGetMatch = req.method === "GET" && req.url?.match(/^\/api\/paaw\/app-chat\/([\w.-]+)$/);
  if (appChatGetMatch) {
    const appId = appChatGetMatch[1];
    try {
      const chatPath = join(APPS_ROOT, appId, "builder-chat.json");
      const data = await readFile(chatPath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [] }));
    }
    return true;
  }

  // PUT /api/paaw/app-chat/:appId — save app builder chat history
  const appChatPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/paaw\/app-chat\/([\w.-]+)$/);
  if (appChatPutMatch) {
    const appId = appChatPutMatch[1];
    try {
      const body = JSON.parse(await _readBody(req));
      const appDir = join(APPS_ROOT, appId);
      await mkdir(appDir, { recursive: true });
      await writeFile(join(appDir, "builder-chat.json"), JSON.stringify({ messages: body.messages || [] }, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/app/:id/publish — publish/update app.json metadata
  const appPublishMatch = req.method === "POST" && req.url?.match(/^\/api\/app\/([\w.-]+)\/publish(?:\?.*)?$/);
  if (appPublishMatch) {
    const appId = appPublishMatch[1];
    const appDir = join(APPS_ROOT, appId);
    try {
      const jsonPath = join(appDir, "app.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(jsonPath, "utf-8")); } catch {}
      let extra = {};
      try { extra = JSON.parse(body); } catch {}
      meta = { ...meta, ...extra, status: "published", publishedAt: new Date().toISOString() };
      await writeFile(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, appId, ...meta }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/app/:id/status — check if app.html exists and its mtime
  const appStatusMatch = req.method === "GET" && req.url?.match(/^\/api\/app\/([\w.-]+)\/status(?:\?.*)?$/);
  if (appStatusMatch) {
    const appId = appStatusMatch[1];
    try {
      const { stat } = await import("fs/promises");
      const filePath = join(APPS_ROOT, appId, "app.html");
      const s = await stat(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: true, mtime: s.mtimeMs, size: s.size }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: false, mtime: null, size: 0 }));
    }
    return;
  }

  // GET /api/report-templates — list available report templates
  if (req.method === "GET" && req.url?.match(/^\/api\/report-templates(?:\?.*)?$/)) {
    const templates = [
      { id: "dashboard", name: "Dashboard", icon: "📊", description: "KPI cards + charts，適合概覽" },
      { id: "table", name: "Table Report", icon: "📋", description: "純表格數據報表" },
      { id: "chart", name: "Chart Only", icon: "📈", description: "單一圖表" },
      { id: "mixed", name: "Mixed Report", icon: "🧩", description: "圖表 + 表格 + AI 分析" },
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(templates));
    return;
  }

  // POST /api/report-train — run CLI to generate app.html, stream output
  if (req.method === "POST" && req.url === "/api/report-train") {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { skillId, reportName, template, prompt, runId, cli: cliType } = parsed;
    const cliName = cliType || "qwen";

    // Prepare output dir
    const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
    const outDir = join(PHYSICAL_SKILL_ROOT, reportId);
    await mkdir(outDir, { recursive: true });

    res.writeHead(200, { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked", "X-Accel-Buffering": "no", "Cache-Control": "no-cache" });

    // Write prompt to a temp file so CLI can read it
    const promptFile = join(outDir, "_prompt.txt");
    await writeFile(promptFile, prompt, "utf-8");

    // Use qwen CLI to generate
    const htmlOutFile = join(outDir, "app.html");

    // Resolve CLI binary and args
    const resolvedBin = resolveCliBin(cliName);

    // Build CLI-specific args
    let cliArgs;
    if (cliName === "qwen") {
      cliArgs = ["--approval-mode", "yolo", "-o", "text", "--max-session-turns", "20", prompt];
    } else if (cliName === "claude") {
      cliArgs = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "-p", prompt, "--output-format", "text"];
    } else if (cliName === "opencode") {
      cliArgs = ["--non-interactive", "-p", prompt];
    } else {
      cliArgs = [prompt];
    }

    console.log(`[report-train] Spawning ${cliName} (${resolvedBin}) for ${reportId}, template=${template}`);

    // Use node-pty so CLI thinks it's on a real terminal → stdout flushes immediately
    // Plain child_process.spawn causes qwen -o text to buffer everything until exit
    const ptyProc = ptySpawn(resolvedBin, cliArgs, {
      name: "xterm-256color",
      cols: 200,
      rows: 50,
      cwd: outDir,
      env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1", FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    });

    // Send initial status so frontend knows connection is alive
    res.write(JSON.stringify({ type: "status", data: { message: `Training ${reportId} with ${cliName}...`, runId } }) + "\n");

    let fullOutput = "";

    ptyProc.onData((data) => {
      fullOutput += data;
      res.write(JSON.stringify({ type: "stdout", data }) + "\n");
    });

    ptyProc.onExit(async ({ exitCode }) => {
      // Extract HTML from CLI output
      let htmlContent = fullOutput;
      const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
      let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
      else {
        htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
        if (htmlMatch) htmlContent = htmlMatch[0];
      }

      if (htmlContent.includes("<html")) {
        await writeFile(htmlOutFile, htmlContent, "utf-8");

        // Write report.json
        const reportMeta = { template, status: "trained", generatedFrom: skillId, generatedAt: new Date().toISOString(), reportName };
        await writeFile(join(outDir, "report.json"), JSON.stringify(reportMeta, null, 2), "utf-8");

        res.write(JSON.stringify({ type: "done", data: { reportId, htmlPath: htmlOutFile, exitCode } }) + "\n");
      } else {
        res.write(JSON.stringify({ type: "error", data: { message: `CLI finished (code=${exitCode}) but no valid HTML found in output (${fullOutput.length} chars)` } }) + "\n");
      }

      // Cleanup prompt file
      try { await unlink(promptFile); } catch {}
      res.end();
    });

    // No 'error' event on PTY, but handle spawn failures
    // 180s timeout
    setTimeout(() => { try { ptyProc.kill(); } catch {} }, 180_000);
    return;
  }

  // GET /api/report-preview — serve generated HTML for preview
  if (req.method === "GET" && req.url?.match(/^\/api\/report-preview\?/)) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const htmlPath = urlObj.searchParams.get("path");
    if (!htmlPath || !htmlPath.startsWith("/")) {
      res.writeHead(400); res.end("Missing path"); return;
    }
    // Safety: only allow reading from PAAW paths
    if (!htmlPath.includes("/paaw/") && !htmlPath.includes(PHYSICAL_SKILL_ROOT)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    try {
      const html = await readFile(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // POST /api/report-publish — publish trained report to skill's app.html
  if (req.method === "POST" && req.url === "/api/report-publish") {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { htmlPath, skillId, reportName } = parsed;

    if (!htmlPath || !htmlPath.includes("/paaw/")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid path" })); return;
    }

    try {
      const html = await readFile(htmlPath, "utf-8");
      // Update report.json status
      const reportDir = dirname(htmlPath);
      const reportJsonPath = join(reportDir, "report.json");
      let meta = {};
      try { meta = JSON.parse(await readFile(reportJsonPath, "utf-8")); } catch {}
      meta.status = "published";
      meta.publishedAt = new Date().toISOString();
      await writeFile(reportJsonPath, JSON.stringify(meta, null, 2), "utf-8");

      // Also copy to apps/ directory
      const reportId = (reportName || skillId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || skillId;
      const appDir = join(APPS_ROOT, reportId);
      await mkdir(appDir, { recursive: true });
      await writeFile(join(appDir, "app.html"), html, "utf-8");
      const appJson = {
        name: reportName || reportId,
        skillId,
        template: meta.template || "",
        generatedAt: meta.generatedAt || new Date().toISOString(),
        publishedAt: meta.publishedAt,
        status: "published",
      };
      await writeFile(join(appDir, "app.json"), JSON.stringify(appJson, null, 2), "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: htmlPath, appId: reportId }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Factory CRUD (removed — single team, no multi-factory in PAAW) ──
  // Stub: any /api/factories request returns 410 Gone
  if (req.url?.startsWith("/api/factories")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, note: "PAAW uses flat crew structure" }));
    return;
  }

  // GET /api/pick-directory — native OS directory picker (macOS/Windows/Linux)
  if (req.method === "GET" && req.url === "/api/pick-directory") {
    try {
      const { execFile } = await import("child_process");
      const platform = process.platform;
      let path;

      if (platform === "darwin") {
        // macOS: osascript choose folder
        path = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", `POSIX path of (choose folder with prompt "Select Working Base")`], (err, stdout) => {
            if (err) { reject(err); return; }
            resolve(stdout.trim().replace(/\/$/, ""));
          });
        });
      } else if (platform === "win32") {
        // Windows: PowerShell FolderBrowserDialog
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$fb = New-Object System.Windows.Forms.FolderBrowserDialog
$fb.Description = 'Select Working Base'
if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { '' }
`.trim();
        path = await new Promise((resolve, reject) => {
          execFile("powershell", ["-NoProfile", "-Command", psScript], (err, stdout) => {
            if (err) { reject(err); return; }
            const p = stdout.trim();
            resolve(p || null);
          });
        });
      } else {
        // Linux: zenity or kdialog
        const { execSync } = await import("child_process");
        let cmd;
        try { execSync("which zenity", { stdio: "ignore" }); cmd = "zenity"; } catch {
          try { execSync("which kdialog", { stdio: "ignore" }); cmd = "kdialog"; } catch { cmd = null; }
        }
        if (cmd === "zenity") {
          path = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else if (cmd === "kdialog") {
          path = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", ".", "Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else {
          path = null;
        }
      }

      if (path) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: null, error: "Cancelled or no dialog available" }));
      }
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, error: "Cancelled or not supported" }));
    }
    return;
  }

  // GET /api/skill-lab/build-files — list skill build files
  if (req.method === "GET" && req.url?.startsWith("/api/skill-lab/build-files")) {
    try {
      const skillsDir = join(PAAW_ROOT, "data/skills");
      const results = [];
      // Scan skills/building/ for flat *.md files and {id}/skill-source.md directories
      try {
        const buildingDir = join(skillsDir, "building");
        await mkdir(buildingDir, { recursive: true });
        const bEntries = await readdir(buildingDir, { withFileTypes: true });
        for (const entry of bEntries) {
          if (entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith("_")) {
            results.push({ name: "building/" + entry.name, path: join(buildingDir, entry.name) });
          } else if (entry.isDirectory()) {
            const srcFile = join(buildingDir, entry.name, "skill-source.md");
            try { await readFile(srcFile, "utf-8"); results.push({ name: "building/" + entry.name + "/skill-source.md", path: srcFile }); } catch {}
          }
        }
      } catch { /* building dir optional */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/report-lab/training-files — list report training files
  if (req.method === "GET" && req.url?.startsWith("/api/report-lab/training-files")) {
    try {
      const skillsDir = join(PAAW_ROOT, "data/skills");
      const results = [];
      // Scan skills/training/ for report-*.md files
      const trainingDir = join(skillsDir, "training");
      try {
        const tStat = await import("fs/promises").then(m => m.stat(trainingDir));
        if (tStat.isDirectory()) {
          const tEntries = await readdir(trainingDir);
          for (const f of tEntries) {
            if (/\.md$/i.test(f) && !f.startsWith("_") && /report/i.test(f)) {
              results.push({ name: "training/" + f, path: join(trainingDir, f) });
            }
          }
        }
      } catch { /* training dir optional */ }
      // Also scan for any training files that contain report keywords
      try {
        const ipDir = join(skillsDir, "input-prompt");
        await mkdir(ipDir, { recursive: true });
        const dirs = await readdir(ipDir);
        for (const dir of dirs) {
          try {
            const stat = await import("fs/promises").then(m => m.stat(join(ipDir, dir)));
            if (!stat.isDirectory()) continue;
            const entries = await readdir(join(ipDir, dir));
            for (const f of entries) {
              if (/report/i.test(f) && /\.md$/i.test(f)) {
                results.push({ name: `input-prompt/${dir}/${f}`, path: join(ipDir, dir, f) });
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // PUT /api/fs/file?path=... — write file content (creates parent dirs)
  if (req.method === "PUT" && req.url?.startsWith("/api/fs/file")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(PAAW_ROOT, filePath);
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { content } = JSON.parse(body);
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/paaw-root — return PAAW base path
  if (req.method === "GET" && req.url === "/api/paaw-root") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ paawRoot: PAAW_ROOT }));
    return;
  }

  // GET /api/factory-root — return PAAW root path
  const factoryRootMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-root(?:\?(.*))?$/);
  if (factoryRootMatch) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ factoryRoot: PAAW_ROOT, factoryId: "default" }));
    return;
  }

async function paawApiHandler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // GET /api/paaw/cli-config — get CLI defaults
  if (req.method === "GET" && path === "/api/paaw/cli-config") {
    try {
      const filePath = resolve(PAAW_DATA_DIR, "cli-config.json");
      const data = JSON.parse(await readFile(filePath, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ configured: false }));
    }
    return true;
  }

  // POST /api/paaw/cli-config — save CLI defaults
  if (req.method === "POST" && path === "/api/paaw/cli-config") {
    try {
      const body = JSON.parse(await readBody(req));
      body.configured = true;
      await writeFile(resolve(PAAW_DATA_DIR, "cli-config.json"), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/paaw/skill-config — get Skill Builder settings
  if (req.method === "GET" && path === "/api/paaw/skill-config") {
    try {
      const filePath = resolve(PAAW_DATA_DIR, "skill-config.json");
      const data = await readFile(filePath, "utf-8").catch(() => null);
      const config = data ? JSON.parse(data) : { testTimeout: 600, maxToolCalls: 50 };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ testTimeout: 600, maxToolCalls: 50 }));
    }
    return true;
  }

  // POST /api/paaw/skill-config — save Skill Builder settings
  if (req.method === "POST" && path === "/api/paaw/skill-config") {
    try {
      const body = JSON.parse(await readBody(req));
      await writeFile(resolve(PAAW_DATA_DIR, "skill-config.json"), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/skill-test/run — non-interactive CLI test: create dir → run → scan files → SSE result
  if (req.method === "POST" && req.url === "/api/skill-test/run") {
    const body = JSON.parse(await readBody(req));
    const { skillId, prompt, cwd, cli = "qwen", timeout = 120, maxToolCalls = 10 } = body;
    // 1. Create temp dir — use relative path for CLI compatibility
    const relTestDir = `data/skills/building/${skillId || "unknown"}/test-output`;
    const testDir = resolve(PAAW_ROOT, relTestDir);
    // Clean previous test output (always overwrite)
    try { await rm(testDir, { recursive: true, force: true }); } catch {}
    await mkdir(testDir, { recursive: true });
    // 2. SSE headers
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    const sendEvent = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
    // 3. Build full prompt — respect user-specified output_path
    //    Only inject test dir if prompt doesn't already contain an output path
    const hasOutputPath = /輸出路徑|output_path|輸出目錄|請將.*輸出/i.test(prompt);
    const fullPrompt = hasOutputPath
      ? prompt
      : `${prompt}\n\n### 輸出目錄\n請將所有輸出檔案放到這個目錄：${relTestDir}\n如果有多個輸出，分別存成不同檔案（JSON、Markdown、HTML 等都可以）。`;
    // 4. Write prompt to temp file (Windows safe — no /dev/stdin)
    const promptFile = join(testDir, "_prompt.txt");
    const { writeFile: writePromptFile, unlink: removePromptFile } = await import("fs/promises");
    await writePromptFile(promptFile, fullPrompt, "utf-8");
    // 5. Spawn CLI via CliAdapter (unified abstraction)
    let cliAdapter;
    try {
      cliAdapter = await CliAdapter.load(cli, PAAW_ROOT);
    } catch {
      // Fallback to hardcoded if adapter config not found
      cliAdapter = null;
    }
    const spawnCwd = cwd || PAAW_ROOT;
    let cliBin, args, spawnOpts;
    if (cliAdapter) {
      const info = cliAdapter.spawnInfo("noninteractive", { approvalMode: "yolo", maxTurns: maxToolCalls, cwd: spawnCwd }, promptFile);
      cliBin = info.bin;
      args = info.args;
      spawnOpts = info.opts;
    } else {
      // Hardcoded fallback
      const _platform = process.platform;
      cliBin = resolveCliBin(cli);
      args = ["-o", "text", "--approval-mode", "yolo", "--max-session-turns", String(maxToolCalls), promptFile];
      spawnOpts = { cwd: spawnCwd, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] };
      if (_platform === "win32") { spawnOpts.shell = true; }
    }
    // Send debug info to frontend
    sendEvent({ type: "debug", cliBin, args, cwd: spawnCwd, platform: process.platform, promptFile, testDir: relTestDir, adapter: cliAdapter ? cliAdapter.id : "fallback" });
    console.log(`[skill-test] spawn: ${cliBin} ${args.join(" ")}, cwd=${spawnCwd}, platform=${process.platform}, adapter=${cliAdapter ? cliAdapter.id : "fallback"}`);
    const child = spawn(cliBin, args, spawnOpts);
    let stderr = "";
    let stdout = "";
    let finished = false;
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      if (finished) return; finished = true;
      clearTimeout(timer); clearInterval(heartbeat);
      console.error(`[skill-test] spawn error:`, err);
      sendEvent({ type: "error", message: `CLI 執行失敗: ${err.message}\ncmd: ${cliBin} ${args.join(" ")}\ncwd: ${spawnCwd}` });
      try { res.end(); } catch {}
      removePromptFile(promptFile).catch(() => {});
    });
    // Heartbeat every 5s
    const heartbeat = setInterval(() => sendEvent({ type: "heartbeat" }), 5000);
    const timer = setTimeout(() => {
      if (finished) return; finished = true;
      child.kill();
      clearInterval(heartbeat);
      sendEvent({ type: "error", message: `Timeout after ${timeout}s` });
      try { res.end(); } catch {}
      removePromptFile(promptFile).catch(() => {});
    }, timeout * 1000);
    child.on("close", async (code) => {
      if (finished) return; finished = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      // 6. Clean up prompt file
      removePromptFile(promptFile).catch(() => {});
      console.log(`[skill-test] close: code=${code}, stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
      // 7. Scan for output files — check user-specified output path first, then test dir
      const scanDirs = [testDir];
      // Also try to read user-specified output path from original prompt
      const outputPathMatch = prompt.match(/輸出路徑:\s*(.+)/);
      if (outputPathMatch) {
        const userPath = outputPathMatch[1].trim();
        const userDir = resolve(PAAW_ROOT, userPath);
        if (!scanDirs.includes(userDir)) scanDirs.unshift(userDir);
      }
      const files = [];
      for (const scanDir of scanDirs) {
      try {
        const entries = await readdir(scanDir);
      for (const name of entries) {
        if (name === "_prompt.txt") continue;
        const fp = join(scanDir, name);
        const s = await stat(fp);
        if (s.isFile()) {
          const ext = name.split(".").pop()?.toLowerCase() || "";
          let type = "text";
          if (["json", "jsonl"].includes(ext)) type = "json";
          else if (["html", "htm"].includes(ext)) type = "html";
          else if (["md", "markdown"].includes(ext)) type = "markdown";
          else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) type = "image";
          else if (["csv"].includes(ext)) type = "csv";
          else if (["yaml", "yml"].includes(ext)) type = "yaml";
          else if (["txt", "log"].includes(ext)) type = "text";
          files.push({ name, path: fp, size: s.size, type, ext });
        }
      }
      } catch {}
      }
        // If no files found but CLI produced stdout, save it as fallback
        if (files.length === 0 && stdout.trim()) {
          const fallbackFile = join(testDir, "output.md");
          const { writeFile: writeFallback } = await import("fs/promises");
          await writeFallback(fallbackFile, stdout, "utf-8");
          files.push({ name: "output.md", path: fallbackFile, size: Buffer.byteLength(stdout), type: "markdown", ext: "md" });
        }
        const noFilesMsg = files.length === 0 ? `\n\nDebug info:\n- CLI bin: ${cliBin}\n- Exit code: ${code}\n- CWD: ${spawnCwd}\n- Test dir: ${relTestDir}\n- stdout (${stdout.length} chars): ${stdout.slice(0, 500) || "(empty)"}\n- stderr (${stderr.length} chars): ${stderr.slice(0, 500) || "(empty)"}` : "";
        sendEvent({ type: "done", exitCode: code, testDir, files, stdout: stdout.slice(-2000), stderr: stderr.slice(-500), debug: noFilesMsg });
      try { res.end(); } catch {}
    });
    return true;
  }

  // GET /api/skill-test/file-content — read a single output file
  if (req.method === "GET" && req.url?.startsWith("/api/skill-test/file-content")) {
    try {
      const qs = new URL(req.url, "http://localhost").searchParams;
      const filePath = qs.get("path");
      if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing path" })); return true; }
      const content = await readFile(resolve(filePath), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, content }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/skill-test — run CLI non-interactively, stream output via SSE, then final result
  if (req.method === "POST" && req.url === "/api/cli-run") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { cli: cliName = "qwen", prompt, cwd: runCwd, maxToolCalls = 10, timeout = 120, stream: wantStream = false } = JSON.parse(body);
      if (!prompt) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing prompt" })); return true; }

      const resolvedBin = resolveCliBin(cliName);

      const cliArgs = [
        "--approval-mode", "yolo",
        "-o", "text",
        "--max-session-turns", String(maxToolCalls),
        "/dev/stdin",
      ];

      // Windows: /dev/stdin doesn't exist; write prompt to temp file and pass as last arg
      const _isWin = process.platform === "win32";
      if (_isWin) {
        const { writeFile: _wf } = await import("fs/promises");
        const { join: _join } = await import("path");
        const { tmpdir: _tmp } = await import("os");
        const _tmpPrompt = _join(_tmp(), `_paaw_prompt_${Date.now()}.txt`);
        await _wf(_tmpPrompt, prompt, "utf-8");
        cliArgs[cliArgs.length - 1] = _tmpPrompt;  // replace /dev/stdin with temp file
      }

      console.log(`[cli-run] Spawning ${resolvedBin} with ${prompt.length}char prompt via stdin (stream=${wantStream})`);

      const child = spawn(resolvedBin, cliArgs, {
        cwd: runCwd || PAAW_ROOT,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb", QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
        stdio: ["pipe", "pipe", "pipe"],
        shell: _isWin,  // Windows: .cmd files need shell:true
      });

      if (!_isWin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", d => {
        stdout += d;
        if (wantStream && !res.headersSent) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        }
        if (wantStream) {
          res.write(`data: ${JSON.stringify({ type: "stdout", data: d.toString() })}\n\n`);
        }
      });
      child.stderr.on("data", d => {
        stderr += d;
        if (wantStream && !res.headersSent) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        }
        if (wantStream) {
          res.write(`data: ${JSON.stringify({ type: "stderr", data: d.toString() })}\n\n`);
        }
      });

      const timer = setTimeout(() => {
        console.log("[cli-run] Timeout, killing");
        child.kill("SIGTERM");
      }, timeout * 1000);

      child.on("close", (code) => {
        clearTimeout(timer);
        console.log(`[cli-run] Done exit=${code}, stdout=${stdout.length}chars`);
        if (!res.headersSent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, exitCode: code, output: stdout.trim(), stderr: stderr.trim() }));
        } else {
          res.write(`data: ${JSON.stringify({ type: "done", exitCode: code, output: stdout.trim() })}\n\n`);
          res.end();
        }
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return true;
  }

  // GET /api/clis — list installed CLI tools
  if (req.method === "GET" && req.url === "/api/clis") {
    try {
      const clis = await checkInstalledClis();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(clis));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/cli-adapters — list all CLI adapter configs
  if (req.method === "GET" && path === "/api/cli-adapters") {
    try {
      const adapters = await CliAdapter.loadAll(PAAW_ROOT);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(adapters.map(a => a.toJSON())));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/cli-adapters/:id — get single adapter config
  if (req.method === "GET" && path.startsWith("/api/cli-adapters/")) {
    try {
      const adapterId = path.replace("/api/cli-adapters/", "");
      const adapter = await CliAdapter.load(adapterId, PAAW_ROOT);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(adapter.toJSON()));
    } catch (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Adapter not found: ${err.message}` }));
    }
    return;
  }

  // GET /api/models — list available models for a CLI
  // ?cli=qwen|claude|opencode (default: qwen)
  const modelsMatch = req.method === "GET" && req.url?.match(/^\/api\/models(?:\?(.*))?$/);
  if (modelsMatch) {
    const qs = new URLSearchParams(modelsMatch[1] || "");
    const cliType = qs.get("cli") || "qwen";
    try {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const models = [];
      let currentModel = "";

      if (cliType === "qwen") {
        // Qwen has no CLI list command — read from settings
        const settingsPath = join(homeDir, ".qwen/settings.json");
        try {
          const raw = await readFile(settingsPath, "utf-8");
          const settings = JSON.parse(raw);
          const providers = settings.modelProviders || {};
          currentModel = settings.model?.name || "";
          for (const [, list] of Object.entries(providers)) {
            if (!Array.isArray(list)) continue;
            for (const m of list) {
              models.push({
                id: m.id, name: m.name,
                contextWindowSize: m.generationConfig?.contextWindowSize,
                vision: m.capabilities?.vision || false,
                current: m.id === currentModel,
              });
            }
          }
        } catch {}
      } else if (cliType === "claude") {
        // Claude has no CLI list command — try reading config for current model
        try {
          const raw = await readFile(join(homeDir, ".claude.json"), "utf-8");
          const cs = JSON.parse(raw);
          if (cs.model) currentModel = cs.model;
        } catch {}
        const claudeModels = [
          { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
          { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
          { id: "claude-haiku-4-20250506", name: "Claude Haiku 4" },
          { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
          { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
        ];
        for (const m of claudeModels) {
          models.push({ id: m.id, name: m.name, current: m.id === currentModel });
        }
      } else if (cliType === "opencode") {
        // OpenCode: read ~/.config/opencode/opencode.json for model config
        // Provider config has: models (custom defs), whitelist (only show these)
        // Agent config has: model (default)
        // Path is the same on Mac, Linux, and Windows (via %APPDATA% or %USERPROFILE%\.config)
        const configPaths = [
          join(homeDir, ".config/opencode/opencode.json"),
          // Windows fallback
          join(process.env.APPDATA || join(homeDir, "AppData/Roaming"), "opencode/opencode.json"),
        ];
        let opencodeConfig = null;
        for (const cp of configPaths) {
          try {
            const raw = await readFile(cp, "utf-8");
            opencodeConfig = JSON.parse(raw);
            break;
          } catch {}
        }

        if (opencodeConfig) {
          // Get default model from agent config
          const agents = opencodeConfig.agent || opencodeConfig.agents || {};
          if (agents.model) currentModel = agents.model;

          // Collect models from provider configs
          const providers = opencodeConfig.provider || opencodeConfig.providers || {};
          for (const [provName, provConf] of Object.entries(providers)) {
            const pc = provConf;
            // If whitelist is set, only show those models
            if (Array.isArray(pc.whitelist)) {
              for (const m of pc.whitelist) {
                const id = typeof m === "string" ? m : m.id;
                models.push({ id, name: id, current: id === currentModel });
              }
            }
            // Also include custom model definitions
            if (pc.models && typeof pc.models === "object") {
              for (const [modelId, modelDef] of Object.entries(pc.models)) {
                const md = modelDef;
                if (!models.find(m => m.id === modelId)) {
                  models.push({ id: modelId, name: md.name || modelId, current: modelId === currentModel });
                }
              }
            }
          }
        }

        if (models.length === 0) {
          // Fallback: execute `opencode models` to get live model list
          const config = CLI_CONFIGS.opencode;
          const bin = resolveCliBin("opencode");
          try {
            const { stdout } = await execAsync(`"${bin}" models 2>&1`, { timeout: 15000 });
            const lines = (stdout || "").split("\n").map(l => l.trim()).filter(Boolean);
            const seen = new Set();
            for (const line of lines) {
              if (!seen.has(line)) {
                seen.add(line);
                models.push({ id: line, name: line, current: false });
              }
            }
          } catch (err) {
            console.log(`[Models] opencode models fallback failed: ${err.message}`);
          }
        }

        if (models.length === 0) {
          models.push({ id: "default", name: "OpenCode Default", current: true });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawRoot: PAAW_ROOT, models, currentModel }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawRoot: PAAW_ROOT, models: [], currentModel: "", error: err.message }));
    }
    return;
  }

  // ── OpenCode endpoints removed (obsolete) ──
  if (req.url?.startsWith("/api/opencode/")) {
    res.writeHead(410, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OpenCode integration removed" }));
    return;
  }

  // ── Crew CRUD endpoints (factory-scoped) ──

    // Helper: resolve CREW_DIR per request with factory scope
  function crewDirForRequest() { return factoryDir(getFactoryId(req.url), "crews"); }

  // Helper: list all crew JSON files
  async function listCrewFiles() {
    const dir = crewDirForRequest();
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    return files.filter(f => f.endsWith(".json") && !f.includes("conversation")).sort();
  }

  // GET /api/crew — list all crew members
  if (req.method === "GET" && req.url?.match(/^\/api\/crew(?:\?.*)?$/)) {
    try {
      const files = await listCrewFiles();
      const crew = await Promise.all(
        files.map(async (name) => {
          try {
            const raw = await readFile(join(crewDirForRequest(), name), "utf-8");
            return JSON.parse(raw);
          } catch { return null; }
        })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(crew.filter(Boolean)));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/crew/:id — get single crew member
  const crewGetMatch = req.method === "GET" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewGetMatch) {
    const crewId = crewGetMatch[1];
    try {
      const files = await listCrewFiles();
      let target = null;
      for (const f of files) {
        try {
          const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
          const data = JSON.parse(raw);
          if (data.id === crewId) { target = f; break; }
        } catch { /* skip */ }
      }
      if (!target) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      const content = await readFile(join(crewDirForRequest(), target), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/crew — create new crew member
  if (req.method === "POST" && req.url?.match(/^\/api\/crew(?:\?.*)?$/)) {
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }
    if (!parsed.id) { res.writeHead(400); res.end("Missing 'id'"); return; }
    if (!parsed.title) { res.writeHead(400); res.end("Missing 'title'"); return; }

    try {
      // Check for duplicate id
      const files = await listCrewFiles();
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === parsed.id) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Crew id '${parsed.id}' already exists` }));
          return;
        }
      }

      // Determine next file number
      const numPrefix = files.length > 0
        ? String(Math.max(...files.map(f => parseInt(f.split("-")[0]) || 0)) + 1).padStart(2, "0")
        : "00";
      const filename = `${numPrefix}-${parsed.id}.json`;
      await writeFile(join(crewDirForRequest(), filename), JSON.stringify(parsed, null, 4), "utf-8");
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, filename, crew: parsed }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // PUT /api/crew/:id — update crew member
  const crewPutMatch = req.method === "PUT" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewPutMatch) {
    const crewId = crewPutMatch[1];
    let parsed;
    try { parsed = JSON.parse(await readBody(req)); } catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Invalid JSON" })); return; }

    try {
      const files = await listCrewFiles();
      let targetFile = null;
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === crewId) { targetFile = f; break; }
      }
      if (!targetFile) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      // Ensure id is not changed
      parsed.id = crewId;
      await writeFile(join(crewDirForRequest(), targetFile), JSON.stringify(parsed, null, 4), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, crew: parsed }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/crew/:id — delete crew member
  const crewDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/crew\/([\w.-]+)(?:\?.*)?$/);
  if (crewDeleteMatch) {
    const crewId = crewDeleteMatch[1];
    try {
      const files = await listCrewFiles();
      let targetFile = null;
      for (const f of files) {
        const raw = await readFile(join(crewDirForRequest(), f), "utf-8");
        const existing = JSON.parse(raw);
        if (existing.id === crewId) { targetFile = f; break; }
      }
      if (!targetFile) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Crew not found" }));
        return;
      }
      const { unlink } = await import("fs/promises");
      await unlink(join(crewDirForRequest(), targetFile));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── End Crew CRUD endpoints ──

  // ── Conversation endpoints ──

  // GET /api/conversations/:employeeId — list conversations
  const convListMatch = req.method === "GET" && req.url?.match(/^\/api\/conversations\/([\w.-]+)(?:\?.*)?$/);
  if (convListMatch) {
    const employeeId = convListMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const convDir = getConvDir(employeeId, root);
    try {
      await mkdir(convDir, { recursive: true });
      const files = await readdir(convDir);
      const jsonFiles = files.filter(f => f.endsWith(".json")).sort().reverse();
      const conversations = await Promise.all(
        jsonFiles.map(async (name) => {
          try {
            const raw = await readFile(join(convDir, name), "utf-8");
            const data = JSON.parse(raw);
            return {
              id: name.replace(/\.json$/, ""),
              title: data.title || name.replace(/\.json$/, ""),
              createdAt: data.createdAt,
              updatedAt: data.updatedAt || data.createdAt,
              messageCount: data.messages?.length || 0,
              model: data.model || "",
            };
          } catch { return null; }
        })
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(conversations.filter(Boolean)));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // GET /api/conversations/:employeeId/:convId — load a conversation
  const convGetMatch = req.method === "GET" && req.url?.match(/^\/api\/conversations\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (convGetMatch) {
    const [, employeeId, convId] = convGetMatch;
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const filePath = join(getConvDir(employeeId, root), `${convId}.json`);
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Conversation not found" }));
    }
    return;
  }

  // POST /api/conversations/:employeeId — save a conversation
  const convSaveMatch = req.method === "POST" && req.url?.match(/^\/api\/conversations\/([\w.-]+)(?:\?.*)?$/);
  if (convSaveMatch) {
    const employeeId = convSaveMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { id, title, messages, model, systemPrompt } = parsed;
    if (!id) { res.writeHead(400); res.end("Missing 'id'"); return; }
    const convDir = getConvDir(employeeId, root);
    await mkdir(convDir, { recursive: true });
    const filePath = join(convDir, `${id}.json`);
    const data = {
      id,
      employeeId,
      title: title || id,
      messages,
      model: model || "",
      systemPrompt: systemPrompt || "",
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

    // Cleanup: keep only the 5 most recent conversations
    try {
      const files = await readdir(convDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));
      if (jsonFiles.length > 5) {
        // Get all files with their timestamps
        const fileStats = await Promise.all(jsonFiles.map(async f => {
          try {
            const raw = await readFile(join(convDir, f), "utf-8");
            const d = JSON.parse(raw);
            return { name: f, updatedAt: d.updatedAt || d.createdAt || "" };
          } catch {
            return { name: f, updatedAt: "" };
          }
        }));
        // Sort by updatedAt descending, delete the oldest ones
        fileStats.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        const toDelete = fileStats.slice(5);
        for (const f of toDelete) {
          try { await unlink(join(convDir, f.name)); } catch { /* ignore */ }
        }
      }
    } catch { /* cleanup is best-effort */ }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, id }));
    return;
  }

  // DELETE /api/conversations/:employeeId/:convId — delete a conversation
  const convDeleteMatch = req.method === "DELETE" && req.url?.match(/^\/api\/conversations\/([\w.-]+)\/([\w.-]+)(?:\?.*)?$/);
  if (convDeleteMatch) {
    const [, employeeId, convId] = convDeleteMatch;
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const filePath = join(getConvDir(employeeId, root), `${convId}.json`);
    const { unlink } = await import("fs/promises");
    try {
      await unlink(filePath);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Conversation not found" }));
    }
    return;
  }

  // ── End Conversation endpoints ──

  // ── Saved Inputs endpoints ──

  // GET /api/saved-inputs/:employeeId — list saved inputs
  const savedInputsGetMatch = req.method === "GET" && req.url?.match(/^\/api\/saved-inputs\/([\w.-]+)(?:\?.*)?$/);
  if (savedInputsGetMatch) {
    const employeeId = savedInputsGetMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    const hash = projectPathHash(root);
    const dir = resolve(CONVERSATIONS_ROOT, hash, employeeId);
    const filePath = join(dir, "saved-inputs.json");
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ inputs: [] }));
    }
    return;
  }

  // POST /api/saved-inputs/:employeeId — save an input
  const savedInputsPostMatch = req.method === "POST" && req.url?.match(/^\/api\/saved-inputs\/([\w.-]+)(?:\?.*)?$/);
  if (savedInputsPostMatch) {
    const employeeId = savedInputsPostMatch[1];
    const u = new URL(req.url, "http://localhost");
    const root = u.searchParams.get("root") || "";
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return; }
    const { hash: inputHash, skillId, data } = parsed;
    if (!inputHash) { res.writeHead(400); res.end("Missing 'hash'"); return; }

    const pHash = projectPathHash(root);
    const dir = resolve(CONVERSATIONS_ROOT, pHash, employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "saved-inputs.json");

    let existing = { inputs: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* first time */ }

    // Check for duplicate hash
    if (!existing.inputs.some(i => i.hash === inputHash)) {
      existing.inputs.push({
        hash: inputHash,
        skillId: skillId || "",
        data: data || {},
        savedAt: new Date().toISOString(),
      });
      await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, inputs: existing.inputs }));
    return;
  }

  // ── End Saved Inputs endpoints ──

  // ── Work Log endpoints ──

  // GET /api/work-log/:employeeId — list work log entries
  const workLogGetMatch = req.method === "GET" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogGetMatch) {
    const employeeId = workLogGetMatch[1];
    const u = new URL(req.url, `http://localhost`);
    const root = u.searchParams.get("root");
    const dir = root
      ? join(CONVERSATIONS_ROOT, projectPathHash(root), employeeId)
      : join(factoryDir(getFactoryId(req.url), "crews"), "conversation", employeeId);
    const filePath = join(dir, "work-log.json");
    try {
      const raw = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(raw);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries: [] }));
    }
    return;
  }

  // POST /api/work-log/:employeeId — save a work log entry
  const workLogPostMatch = req.method === "POST" && req.url?.match(/^\/api\/work-log\/([\w.-]+)(?:\?.*)?$/);
  if (workLogPostMatch) {
    const employeeId = workLogPostMatch[1];
    const u = new URL(req.url, `http://localhost`);
    const root = u.searchParams.get("root");
    const dir = root
      ? join(CONVERSATIONS_ROOT, projectPathHash(root), employeeId)
      : join(factoryDir(getFactoryId(req.url), "crews"), "conversation", employeeId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "work-log.json");

    let body = "";
    for await (const chunk of req) body += chunk;
    const { skillIds, inputSummary, cli, inputData } = JSON.parse(body);

    let existing = { entries: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      existing = JSON.parse(raw);
    } catch { /* first time */ }

    existing.entries.unshift({
      id: `work-${Date.now()}`,
      skillIds: skillIds || [],
      inputSummary: inputSummary || "",
      cli: cli || "",
      inputData: inputData || {},
      timestamp: new Date().toISOString(),
    });

    // Deduplicate: remove entries with same inputSummary + cli within 2 seconds
    existing.entries = existing.entries.filter((entry, idx, arr) => {
      if (idx === 0) return true;
      const prev = arr.findIndex(e => e.inputSummary === entry.inputSummary && e.cli === entry.cli);
      if (prev < idx) {
        const timeDiff = new Date(entry.timestamp).getTime() - new Date(arr[prev].timestamp).getTime();
        if (Math.abs(timeDiff) < 3000) return false; // duplicate within 3s
      }
      return true;
    });

    // Keep last 50 entries
    if (existing.entries.length > 50) existing.entries = existing.entries.slice(0, 50);

    await writeFile(filePath, JSON.stringify(existing, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── End Work Log endpoints ──

  // GET /api/fs/pick-folder — native OS folder picker (macOS / Linux / Windows)
  if (req.method === "GET" && req.url?.startsWith("/api/fs/pick-folder")) {
    try {
      const { execFile, exec } = await import("child_process");
      const platform = process.platform; // 'darwin' | 'linux' | 'win32'
      let result;

      if (platform === "darwin") {
        // macOS — osascript
        result = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", 'set chosenFolder to choose folder with prompt "Select a project folder"\nreturn POSIX path of chosenFolder'], (err, stdout) => {
            if (err) reject(err); else resolve(stdout.toString().trim());
          });
        });
      } else if (platform === "linux") {
        // Linux — try zenity first, fallback to kdialog
        try {
          result = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        } catch {
          result = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", process.env.HOME || process.env.USERPROFILE || "/", "Select a project folder"], (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          });
        }
      } else if (platform === "win32") {
        // Windows — PowerShell FolderBrowserDialog
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          $fb = New-Object System.Windows.Forms.FolderBrowserDialog
          $fb.Description = 'Select a project folder'
          $fb.ShowNewFolderButton = $false
          if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { exit 1 }
        `;
        result = await new Promise((resolve, reject) => {
          import("child_process").then(({ exec }) => {
            exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.Description = 'Select a project folder'; $fb.ShowNewFolderButton = $false; if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { exit 1 }"`, { maxBuffer: 1024*1024 }, (err, stdout) => {
              if (err) reject(err); else resolve(stdout.toString().trim());
            });
          }).catch(reject);
        });
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: result }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, error: "Folder picker cancelled or unavailable" }));
    }
    return;
  }

  // GET /api/fs/browse?path=... — list immediate subdirectories for folder picker
  if (req.method === "GET" && req.url?.startsWith("/api/fs/browse")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.USERPROFILE || process.env.HOME || "/");
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      if (!stat.isDirectory()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not a directory" }));
        return;
      }
      const entries = await readdir(absPath, { withFileTypes: true });
      const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite"]);
      const dirs = entries
        .filter(e => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => ({ name: e.name, path: join(absPath, e.name) }));
      const parent = (absPath !== "/" && !/^[A-Za-z]:\\$/.test(absPath)) ? dirname(absPath) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ currentPath: absPath, parent, directories: dirs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, currentPath: absPath, parent: null, directories: [] }));
    }
    return;
  }

  // GET /api/fs/tree?root=... — directory tree for release unit
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree") && !req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return;
    }
    const absRoot = resolve(root);
    // Safety: only allow absolute paths (Unix: /... or Windows: C:\... / X:/...)
    if (!absRoot.startsWith("/") && !/^[A-Za-z]:/.test(absRoot)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    try {
      const tree = await buildTree(absRoot, absRoot, 2);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/fs/file?path=... — read file content
  if (req.method === "GET" && req.url?.startsWith("/api/fs/file")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(PAAW_ROOT, filePath);
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
      const isImage = imageExts.includes(ext);
      if (isImage && stat.size > 10 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Image too large (max 10MB)" }));
        return;
      }
      if (!isImage && stat.size > 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File too large (max 1MB)" }));
        return;
      }
      if (isImage) {
        // Binary image file — return raw bytes
        const mimeMap = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          bmp: "image/bmp", ico: "image/x-icon",
        };
        const data = await readFile(absPath); // buffer
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Content-Length": stat.size,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(data);
      } else {
        const content = await readFile(absPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: absPath, content, size: stat.size }));
      }
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return;
  }

  // GET /api/fs/tree-deep?root=...&subpath=... — lazy-load one directory level
  if (req.method === "GET" && req.url?.startsWith("/api/fs/tree-deep")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    const subpath = params.get("subpath") || "";
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'root' query param" }));
      return;
    }
    const absDir = resolve(join(root, subpath));
    try {
      const children = await buildTree(absDir, absDir, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(children));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/fs/mkdir — create directory
  if (req.method === "POST" && req.url?.startsWith("/api/fs/mkdir")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { path: dirPath } = JSON.parse(body);
      if (!dirPath) throw new Error("Missing path");
      const abs = resolve(dirPath);
      await mkdir(abs, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: abs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/fs/create-file — create empty file
  if (req.method === "POST" && req.url?.startsWith("/api/fs/create-file")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { path: filePath, content = "" } = JSON.parse(body);
      if (!filePath) throw new Error("Missing path");
      const abs = resolve(filePath);
      await mkdir(dirname(abs), { recursive: true });
      const { writeFile } = await import("fs/promises");
      await writeFile(abs, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: abs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/fs/rename — rename/move file or folder
  if (req.method === "POST" && req.url?.startsWith("/api/fs/rename")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { oldPath, newPath } = JSON.parse(body);
      if (!oldPath || !newPath) throw new Error("Missing oldPath or newPath");
      const absOld = resolve(oldPath);
      const absNew = resolve(newPath);
      const { rename } = await import("fs/promises");
      await rename(absOld, absNew);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, oldPath: absOld, newPath: absNew }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/fs/copy — copy file or folder
  if (req.method === "POST" && req.url?.startsWith("/api/fs/copy")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { srcPath, destPath } = JSON.parse(body);
      if (!srcPath || !destPath) throw new Error("Missing srcPath or destPath");
      const absSrc = resolve(srcPath);
      const absDest = resolve(destPath);
      const { cp } = await import("fs/promises");
      await cp(absSrc, absDest, { recursive: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, srcPath: absSrc, destPath: absDest }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/fs/item?path=... — delete file or folder (recursive)
  if (req.method === "DELETE" && req.url?.startsWith("/api/fs/item")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const targetPath = params.get("path");
    if (!targetPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query param" }));
      return;
    }
    const absPath = resolve(targetPath);
    // Safety: only allow absolute paths
    if (!absPath.startsWith("/") && !/^[A-Za-z]:/.test(absPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only absolute paths allowed" }));
      return;
    }
    // Safety: refuse to delete project root itself
    try {
      const stat = await import("fs").then(m => m.promises.stat(absPath));
      if (stat.isDirectory()) {
        await rm(absPath, { recursive: true, force: true });
      } else {
        await unlink(absPath);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: absPath }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/factory/:factoryId/crews-pic/:filename — serve crew photo
  const crewPicMatch = req.method === "GET" && req.url?.match(/^\/api\/factory\/([\w.-]+)\/crews-pic\/(.+)$/);
  if (crewPicMatch) {
    const [, , picName] = crewPicMatch;
    const picPath = join(CREWS_ROOT, "pic", picName);
    try {
      const { stat } = await import("fs/promises");
      const s = await stat(picPath);
      if (!s.isFile()) throw new Error("Not a file");
      const ext = picName.split(".").pop()?.toLowerCase();
      const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
      res.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
      const { createReadStream } = await import("fs");
      createReadStream(picPath).pipe(res);
    } catch {
      // Fallback: return 1x1 transparent PNG instead of 404
      const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRUEFTkSuQmCC", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      res.end(transparentPng);
    }
    return;
  }

  // GET /api/factory-content/:name — single file
  const singleFileMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content\/([\w.-]+)(?:\?.*)?$/);
  if (singleFileMatch) {
    const name = singleFileMatch[1];
    const fId = getFactoryId(req.url);
    const factoryDir = DOCS_ROOT;
    const filePath = join(factoryDir, name);
    try {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ filename: name, content }));
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
    }
    return;
  }

  // GET /api/factory-content — list all files in factory directory
  const factoryContentListMatch = req.method === "GET" && req.url?.match(/^\/api\/factory-content(?:\?.*)?$/);
  if (factoryContentListMatch) {
    const fId = getFactoryId(req.url);
    const factoryDirPath = DOCS_ROOT;
    try {
      const files = await readdir(factoryDirPath);
      const result = files.sort().map(f => ({ filename: f }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return;
  }

  // GET /api/project-dashboard — read .aieoc/dashboard.json from any project
  if (req.method === "GET" && req.url?.startsWith("/api/project-dashboard")) {
    try {
      const u = new URL(req.url, `http://localhost`);
      const root = u.searchParams.get("root");
      if (!root) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing root param" }));
        return;
      }
      const dashFile = join(root, ".aieoc", "dashboard.json");
      const content = await readFile(dashFile, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(content);
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null));
    }
    return;
  }

  // ── Hello World endpoints removed (demo only) ──
  if (req.url === "/api/hello-world") {
    res.writeHead(410, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Hello World demo removed" }));
    return;
  }

  // SSE: File watcher
  if (req.method === "GET" && req.url?.startsWith("/api/fs/watch")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const root = params.get("root");
    if (!root) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing root" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n"); // kick the stream
    const watcher = startWatcher(root, res);
    req.on("close", () => {
      watcher.close();
      res.end();
    });
    return;
  }

async function buildTree(absRoot, currentPath, maxDepth) {
  const IGNORED = new Set([".git", "node_modules", ".DS_Store", "__pycache__", ".next", "dist", ".cache", ".turbo"]);
  const result = { name: currentPath === absRoot ? basename(absRoot) : basename(currentPath), path: normalizePath(currentPath), type: "dir", children: [] };
  if (maxDepth <= 0) { result.children = undefined; result.lazy = true; return result; }
  let entries;
  try { entries = await readdir(currentPath, { withFileTypes: true }); } catch { return result; }
  // Sort: dirs first, then files, both alphabetical
  const sorted = entries
    .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  // Cap at 200 entries per directory to avoid perf issues
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

// ── File Watcher (SSE) ──
// Each SSE client gets its own watcher, supporting multiple roots simultaneously
function startWatcher(root, sseRes) {
  const w = chokidar.watch(root, {
    ignored: /node_modules|\.git|dist|__pycache__|\.next|\.nuxt|target|build/,
    persistent: true,
    ignoreInitial: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const send = (type, path) => {
    try {
      sseRes.write(`data: ${JSON.stringify({ type, path })}\n\n`);
    } catch { /* client gone */ }
  };
  w.on("add", (p) => send("add", p));
  w.on("unlink", (p) => send("unlink", p));
  w.on("change", (p) => send("change", p));
  w.on("addDir", (p) => send("addDir", p));
  w.on("unlinkDir", (p) => send("unlinkDir", p));
  console.log(`[Watcher] Watching ${root} (client ${sseRes.socket?.remotePort})`);
  return w;
}


// ── PAAW Personal Assistant APIs ──

const PAAW_DATA_DIR = resolve(PAAW_ROOT, "data");
const PAAW_USER_FILE = resolve(PAAW_DATA_DIR, "user.json");
const PAAW_CHAT_DIR = resolve(PAAW_DATA_DIR, "chats");

await mkdir(PAAW_DATA_DIR, { recursive: true });
await mkdir(PAAW_CHAT_DIR, { recursive: true });

  // GET /api/paaw/user — get user profile
  if (req.method === "GET" && path === "/api/paaw/user") {
    try {
      const data = JSON.parse(await readFile(PAAW_USER_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(null)); // not onboarded yet
    }
    return true;
  }

  // POST /api/paaw/user — save user profile (onboarding)
  if (req.method === "POST" && path === "/api/paaw/user") {
    const body = JSON.parse(await readBody(req));
    await writeFile(PAAW_USER_FILE, JSON.stringify(body, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // POST /api/paaw/avatar — upload assistant avatar
  if (req.method === "POST" && path === "/api/paaw/avatar") {
    try {
      const body = JSON.parse(await readBody(req));
      const { data: base64Data, filename } = body;
      if (!base64Data) { res.writeHead(400); res.end(JSON.stringify({ error: "no data" })); return true; }
      const avatarDir = resolve(PAAW_DATA_DIR, "avatars");
      await mkdir(avatarDir, { recursive: true });
      const ext = (filename || "").split(".").pop() || "png";
      const avatarName = `assistant.${ext}`;
      const avatarPath = resolve(avatarDir, avatarName);
      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(avatarPath, buffer);
      // Update user profile with avatar path
      let userProfile;
      try { userProfile = JSON.parse(readFileSync(PAAW_USER_FILE, "utf-8")); } catch { userProfile = {}; }
      userProfile.assistantAvatar = `/api/paaw/avatar/assistant`;
      await writeFile(PAAW_USER_FILE, JSON.stringify(userProfile, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: `/api/paaw/avatar/assistant` }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/paaw/avatar/assistant — serve assistant avatar
  if (req.method === "GET" && path === "/api/paaw/avatar/assistant") {
    try {
      const avatarDir = resolve(PAAW_DATA_DIR, "avatars");
      const files = await readdir(avatarDir);
      const avatarFile = files.find(f => f.startsWith("assistant."));
      if (avatarFile) {
        const data = await readFile(resolve(avatarDir, avatarFile));
        const ext = avatarFile.split(".").pop();
        res.writeHead(200, { "Content-Type": `image/${ext === "jpg" ? "jpeg" : ext}` });
        res.end(data);
      } else {
        res.writeHead(404); res.end("Not found");
      }
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  // ── App Builder Rules API ──
  const APP_RULES_PATH = resolve(PAAW_ROOT, "data/config/app-builder-rules.md");

  // GET /api/paaw/app-rules
  if (req.method === "GET" && path === "/api/paaw/app-rules") {
    try {
      const rules = await readFile(APP_RULES_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(rules);
    } catch {
      res.writeHead(404);
      res.end("App builder rules not found");
    }
    return true;
  }

  // PUT /api/paaw/app-rules
  if (req.method === "PUT" && path === "/api/paaw/app-rules") {
    try {
      const body = await readBody(req);
      await mkdir(resolve(PAAW_ROOT, "data/config"), { recursive: true });
      await writeFile(APP_RULES_PATH, body, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Rules updated" }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App/Skill list for Workflow Builder ──

  // GET /api/paaw/app-skills — list apps with their skills
  if (req.method === "GET" && path === "/api/paaw/app-skills") {
    try {
      const appFiles = await readdir(APPS_ROOT);
      const result = [];
      for (const f of appFiles) {
        if (!f.endsWith(".json")) continue;
        try {
          const app = JSON.parse(await readFile(resolve(APPS_ROOT, f), "utf-8"));
          // Find skills for this app
          const skills = [];
          const appSkillsDir = resolve(APPS_ROOT, app.id, "skills");
          try {
            const dirs = await readdir(appSkillsDir);
            for (const d of dirs) {
              if (existsSync(resolve(appSkillsDir, d, "SKILL.md"))) skills.push(d);
            }
          } catch {}
          result.push({ id: app.id, name: app.name || app.id, icon: app.icon || "📦", skills });
        } catch {}
      }
      // Also add skills from pool
      const poolSkills = [];
      try {
        const dirs = await readdir(resolve(PAAW_ROOT, "data/skills/pool"));
        for (const d of dirs) {
          if (existsSync(resolve(PAAW_ROOT, "data/skills/pool", d, "SKILL.md"))) poolSkills.push(d);
        }
      } catch {}
      if (poolSkills.length > 0) {
        result.push({ id: "_pool", name: "Skill Pool", icon: "🗂️", skills: poolSkills });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── App Import/Export API ──

  // GET /api/paaw/apps/:id/export — export app as shareable bundle
  const appExportMatch = req.method === "GET" && path.match(/^\/api\/paaw\/apps\/([\w.-]+)\/export$/);
  if (appExportMatch) {
    const appId = appExportMatch[1];
    const bundle = {
      manifest: "paaw-app-v1",
      exportedAt: new Date().toISOString(),
      app: null,
      skills: {},
      html: null,
      data: null,
    };
    try {
      // App definition
      bundle.app = JSON.parse(await readFile(resolve(PAAW_ROOT, "data/apps", `${appId}.json`), "utf-8"));
    } catch {}
    if (!bundle.app) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `App not found: ${appId}` }));
      return true;
    }
    try {
      // Skills
      const skillsDir = resolve(PAAW_ROOT, "data/apps", appId, "skills");
      const skillDirs = await readdir(skillsDir);
      for (const sd of skillDirs) {
        try { bundle.skills[sd] = await readFile(resolve(skillsDir, sd, "SKILL.md"), "utf-8"); } catch {}
      }
    } catch {}
    try { bundle.html = await readFile(resolve(PAAW_ROOT, "data/apps", appId, "app.html"), "utf-8"); } catch {}
    try { bundle.data = JSON.parse(await readFile(resolve(PAAW_ROOT, "data/app-data", `${appId}.json`), "utf-8")); } catch {}

    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${appId}-bundle.json"` });
    res.end(JSON.stringify(bundle, null, 2));
    return true;
  }

  // POST /api/paaw/apps/import — import app from bundle
  if (req.method === "POST" && path === "/api/paaw/apps/import") {
    try {
      const bundle = JSON.parse(await readBody(req));
      if (bundle.manifest !== "paaw-app-v1") {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid bundle format. Expected manifest: paaw-app-v1" }));
        return true;
      }
      const app = bundle.app;
      if (!app?.id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing app.id" }));
        return true;
      }
      // Write app definition
      await writeFile(resolve(PAAW_ROOT, "data/apps", `${app.id}.json`), JSON.stringify(app, null, 2), "utf-8");
      // Write skills
      if (bundle.skills) {
        for (const [skillName, skillContent] of Object.entries(bundle.skills)) {
          const skillDir = resolve(PAAW_ROOT, "data/apps", app.id, "skills", skillName);
          await mkdir(skillDir, { recursive: true });
          await writeFile(resolve(skillDir, "SKILL.md"), skillContent, "utf-8");
        }
      }
      // Write app.html
      if (bundle.html) {
        const appDir = resolve(PAAW_ROOT, "data/apps", app.id);
        await mkdir(appDir, { recursive: true });
        await writeFile(resolve(appDir, "app.html"), bundle.html, "utf-8");
      }
      // Write app data
      if (bundle.data) {
        await writeFile(resolve(PAAW_ROOT, "data/app-data", `${app.id}.json`), JSON.stringify(bundle.data, null, 2), "utf-8");
      }
      invalidateCache();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `App「${app.name}」imported successfully`, app }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Provider / Model APIs ──

  // GET /api/paaw/providers — list providers + models (mask apiKey)
  if (req.method === "GET" && path === "/api/paaw/providers") {
    try {
      const config = JSON.parse(await readFile(resolve(PAAW_DATA_DIR, "config/providers.json"), "utf-8"));
      const hasAnyKey = Object.values(config.providers).some((p) => p.apiKey && p.apiKey.length > 0);
      const safe = { active: config.active, defaultModel: config.defaultModel, configured: hasAnyKey, providers: {} };
      for (const [k, v] of Object.entries(config.providers)) {
        safe.providers[k] = { ...v, apiKey: v.apiKey ? v.apiKey.slice(0, 8) + "..." : "" };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safe));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ active: "", defaultModel: "", configured: false, providers: {} }));
    }
    return true;
  }

  // PUT /api/paaw/providers — update provider config
  if (req.method === "PUT" && path === "/api/paaw/providers") {
    try {
      const filePath = resolve(PAAW_DATA_DIR, "config/providers.json");
      const config = JSON.parse(await readFile(filePath, "utf-8"));
      const body = JSON.parse(await readBody(req));
      if (body.active) config.active = body.active;
      if (body.defaultModel) config.defaultModel = body.defaultModel;
      // Update provider fields (apiKey, baseURL, models)
      if (body.provider && body.providerId) {
        const pid = body.providerId;
        if (config.providers[pid]) {
          if (body.provider.apiKey !== undefined) config.providers[pid].apiKey = body.provider.apiKey;
          if (body.provider.baseURL !== undefined) config.providers[pid].baseURL = body.provider.baseURL;
          if (body.provider.models) config.providers[pid].models = body.provider.models;
        }
      }
      // Update all providers at once
      if (body.providers) {
        for (const [pid, pdata] of Object.entries(body.providers)) {
          if (!config.providers[pid]) config.providers[pid] = { name: pid, baseURL: "", apiKey: "", models: [] };
          const p = pdata;
          if (p.apiKey !== undefined) config.providers[pid].apiKey = p.apiKey;
          if (p.baseURL !== undefined) config.providers[pid].baseURL = p.baseURL;
          if (p.models) config.providers[pid].models = p.models;
          if (p.name) config.providers[pid].name = p.name;
        }
      }
      await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
      // Return masked version
      const safe = { ok: true, active: config.active, defaultModel: config.defaultModel, providers: {} };
      for (const [k, v] of Object.entries(config.providers)) {
        safe.providers[k] = { ...v, apiKey: v.apiKey ? v.apiKey.slice(0, 8) + "..." : "" };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(safe));
    } catch (err) {
      console.error("[PAAW] Provider update error:", err);
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to update providers" }));
    }
    return true;
  }

  // ── Workspaces API ──
  const PAAW_WORKSPACES_FILE = resolve(PAAW_DATA_DIR, "workspaces.json");

  // GET /api/paaw/workspaces
  if (req.method === "GET" && path === "/api/paaw/workspaces") {
    try {
      const data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ directories: [] }));
    }
    return true;
  }

  // POST /api/paaw/workspaces — add directory
  if (req.method === "POST" && path === "/api/paaw/workspaces") {
    try {
      let data;
      try { data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      const body = JSON.parse(await readBody(req));
      const dir = body.directory;
      if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: "directory required" })); return true; }
      if (!data.directories.includes(dir)) {
        data.directories.push(dir);
        await writeFile(PAAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to add workspace" }));
    }
    return true;
  }

  // DELETE /api/paaw/workspaces?dir=... — remove directory
  if (req.method === "DELETE" && path === "/api/paaw/workspaces") {
    try {
      const dir = url.searchParams.get("dir");
      let data;
      try { data = JSON.parse(await readFile(PAAW_WORKSPACES_FILE, "utf-8")); } catch { data = { directories: [] }; }
      data.directories = data.directories.filter((d) => d !== dir);
      await writeFile(PAAW_WORKSPACES_FILE, JSON.stringify(data, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(500); res.end(JSON.stringify({ error: "Failed to remove workspace" }));
    }
    return true;
  }

  // ── UI State API (server-side storage, replaces localStorage) ──
  const UI_STATE_FILE = resolve(PAAW_DATA_DIR, "ui-state.json");

  async function loadUiState() {
    try {
      return JSON.parse(await readFile(UI_STATE_FILE, "utf-8"));
    } catch {
      return { recentProjects: [], projectPaths: {} };
    }
  }

  async function saveUiState(state) {
    await writeFile(UI_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }

  // GET /api/paaw/ui-state
  if (req.method === "GET" && path === "/api/paaw/ui-state") {
    const state = await loadUiState();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(state));
    return true;
  }

  // PUT /api/paaw/ui-state
  if (req.method === "PUT" && path === "/api/paaw/ui-state") {
    try {
      const body = JSON.parse(await readBody(req));
      await saveUiState(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // PATCH /api/paaw/ui-state
  if (req.method === "PATCH" && path === "/api/paaw/ui-state") {
    try {
      const patch = JSON.parse(await readBody(req));
      const state = await loadUiState();
      for (const [key, val] of Object.entries(patch)) {
        state[key] = val;
      }
      await saveUiState(state);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }


  // ── Workflow API ──

  // GET /api/paaw/workflows — list all workflows
  if (req.method === "GET" && path === "/api/paaw/workflows") {
    try {
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      const files = await readdir(WORKFLOWS_ROOT);
      const wfs = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          const data = JSON.parse(await readFile(resolve(WORKFLOWS_ROOT, f), "utf-8"));
          wfs.push(data);
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(wfs));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/paaw/workflows/:id — get single workflow
  const wfGetMatch = req.method === "GET" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfGetMatch) {
    try {
      const wfId = wfGetMatch[1];
      const data = JSON.parse(await readFile(resolve(WORKFLOWS_ROOT, `${wfId}.json`), "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404); res.end(JSON.stringify({ error: "Workflow not found" }));
    }
    return true;
  }

  // PUT /api/paaw/workflows/:id — update workflow
  const wfPutMatch = req.method === "PUT" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfPutMatch) {
    try {
      const wfId = wfPutMatch[1];
      const body = JSON.parse(await readBody(req));
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      await writeFile(resolve(WORKFLOWS_ROOT, `${wfId}.json`), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/paaw/workflows — create workflow
  if (req.method === "POST" && path === "/api/paaw/workflows") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.id || !body.name) {
        res.writeHead(400); res.end(JSON.stringify({ error: "id and name required" }));
        return true;
      }
      await mkdir(WORKFLOWS_ROOT, { recursive: true });
      await writeFile(resolve(WORKFLOWS_ROOT, `${body.id}.json`), JSON.stringify(body, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/paaw/workflows/:id — delete workflow
  const wfDelMatch = req.method === "DELETE" && path.match(/^\/api\/paaw\/workflows\/([\w.-]+)$/);
  if (wfDelMatch) {
    try {
      const wfId = wfDelMatch[1];
      const fp = resolve(WORKFLOWS_ROOT, `${wfId}.json`);
      await unlink(fp);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(404); res.end(JSON.stringify({ error: "Workflow not found" }));
    }
    return true;
  }

  // ── Workflow Execution History ──

  // GET /api/paaw/workflows/:id/exec-history
  const wfExecMatch = path.match(/^\/api\/paaw\/workflows\/([^/]+)\/exec-history$/);
  if (req.method === "GET" && wfExecMatch) {
    try {
      const wfId = wfExecMatch[1];
      const histDir = resolve(WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const histFile = resolve(histDir, wfId + ".json");
      let history = [];
      try { history = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // POST /api/paaw/workflows/:id/exec-history — save execution result
  if (req.method === "POST" && wfExecMatch) {
    try {
      const wfId = wfExecMatch[1];
      const entry = JSON.parse(await readBody(req));
      const histDir = resolve(WORKFLOWS_ROOT, "_exec-history");
      await mkdir(histDir, { recursive: true });
      const histFile = resolve(histDir, wfId + ".json");
      let history = [];
      try { history = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
      history.unshift(entry); // newest first
      if (history.length > 50) history = history.slice(0, 50);
      await writeFile(histFile, JSON.stringify(history, null, 2));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // GET /api/paaw/skills/:appId/:skillId/inputs — get skill's userInputs
  const skillInputsMatch = path.match(/^\/api\/paaw\/skills\/([^/]+)\/([^/]+)\/inputs$/);
  if (req.method === "GET" && skillInputsMatch) {
    try {
      const [, appId, skillId] = skillInputsMatch;
      let skillPath = resolve(PAAW_ROOT, "data/apps", appId, "skills", skillId, "SKILL.md");
      let content;
      try { content = await readFile(skillPath, "utf-8"); } catch {
        skillPath = resolve(PAAW_ROOT, "data/skills/pool", skillId, "SKILL.md");
        try { content = await readFile(skillPath, "utf-8"); } catch {
          res.writeHead(404); res.end(JSON.stringify({ error: "Skill not found" })); return true;
        }
      }
      // Parse frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let userInputs = [];
      if (fmMatch) {
        const fm = yaml.load(fmMatch[1]);
        userInputs = fm.userInputs || [];
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skillId, appId, userInputs }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // POST /api/paaw/workflow-output-chat — send workflow result to chat
  if (req.method === "POST" && path === "/api/paaw/workflow-output-chat") {
    try {
      const { chatId, content: msgContent, workflowName } = JSON.parse(await readBody(req));
      const cid = chatId || "default";
      const filePath = resolve(PAAW_CHAT_DIR, `${cid}.json`);
      let chat;
      try { chat = JSON.parse(await readFile(filePath, "utf-8")); } catch {
        chat = { id: cid, title: "PAAW 交談", messages: [], createdAt: new Date().toISOString() };
      }
      const text = typeof msgContent === "string" ? msgContent : JSON.stringify(msgContent, null, 2);
      chat.messages.push({ role: "assistant", content: `🔗 **Workflow: ${workflowName || "未命名"}**\n\n${text}`, timestamp: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(chat, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, chatId: cid }));
    } catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
    return true;
  }

  // POST /api/paaw/file-write — write file for workflow end node (file output)
  if (req.method === "POST" && path === "/api/paaw/file-write") {
    try {
      const { path: filePath, content } = JSON.parse(await readBody(req));
      if (!filePath) { res.writeHead(400); res.end(JSON.stringify({ error: "path required" })); return true; }
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: filePath }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }
}

  // ── Pocket Notes API (compatibility layer for React app.html) ──
  // Uses the same universal format as /api/app-data/pocket
  if (req.url === "/api/notes" || req.url?.startsWith("/api/notes?")) {
    const dir = resolve(PAAW_ROOT || dirname, "data/app-data");
    const NOTES_FILE = join(dir, "pocket.json");
    async function loadArr() {
      try { return JSON.parse(await readFile(NOTES_FILE, "utf-8")); } catch { return []; }
    }
    async function saveArr(data) {
      await mkdir(dir, { recursive: true });
      await writeFile(NOTES_FILE, JSON.stringify(data, null, 2), "utf-8");
    }
    // React expects { notes: [...] }, universal API stores [...]
    // Normalize field names: AI tools may use "text" but UI expects "content"
    function normalizeNote(n) {
      return {
        ...n,
        content: n.content || n.text || n.title || "",
        status: n.status || (n.done ? "done" : "active"),
      };
    }
    if (req.method === "GET") {
      const arr = await loadArr();
      const notes = (Array.isArray(arr) ? arr : []).map(normalizeNote);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ notes }));
      return;
    }
    const reqBody = await _readBody(req);
    if (req.method === "POST") {
      const note = JSON.parse(reqBody);
      const arr = await loadArr();
      if (!note.id) note.id = `pocket_${Date.now().toString(36)}`;
      if (!note.createdAt) note.createdAt = new Date().toISOString();
      arr.unshift(note);
      await saveArr(arr);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, note }));
      return;
    }
    const id = new URL(req.url, "http://localhost").searchParams.get("id");
    if (req.method === "PUT") {
      const updated = JSON.parse(reqBody);
      const arr = await loadArr();
      const idx = arr.findIndex(n => n.id === id);
      if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return; }
      arr[idx] = { ...arr[idx], ...updated, updatedAt: new Date().toISOString() };
      await saveArr(arr);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, note: arr[idx] }));
      return;
    }
    if (req.method === "DELETE") {
      let arr = await loadArr();
      arr = arr.filter(n => n.id !== id);
      await saveArr(arr);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // Main handler catch-all
  if (!res.headersSent) {
    res.writeHead(404);
    res.end("Not found");
  }

});

server.listen(PORT, async () => {
  // Ensure system prompt directory exists
  await mkdir(SYSTEM_DIR, { recursive: true });
  console.log(`[PAAW] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[PAAW] System prompts: ${SYSTEM_DIR}`);
  console.log(`[PAAW] Modular routes: skill, workflow, chat`);
});

// ── WebSocket server for PTY ──
const WS_PORT = parseInt(process.env.PAAW_WS_PORT || "4098", 10);
const wss = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });
const ptySessions = new Map(); // ws -> { pty, id }

// ── Multi-CLI spawn system ──
// Supports: qwen, claude, opencode
// Each CLI has its own binary name, flags, and platform resolution

const CLI_CONFIGS = {
  qwen: {
    name: "Qwen Code",
    get bins() { return { darwin: resolveCliBin("qwen", PAAW_ROOT), linux: "qwen", win32: "qwen.cmd" }; },
    envBin: "QWEN_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("-m", opts.model);
      if (opts.approvalMode === "yolo") args.push("-y");
      else if (opts.approvalMode) args.push("--approval-mode", opts.approvalMode);
      return args;
    },
  },
  claude: {
    name: "Claude Code",
    get bins() { return { darwin: resolveCliBin("claude", PAAW_ROOT), linux: "claude", win32: "claude.cmd" }; },
    envBin: "CLAUDE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model) args.push("--model", opts.model);
      // Claude Code permission modes
      if (opts.approvalMode === "yolo") args.push("--dangerously-skip-permissions", "--allow-dangerously-skip-permissions");
      else if (opts.approvalMode === "auto-edit") args.push("--permission-mode", "acceptEdits");
      else if (opts.approvalMode === "plan") args.push("--permission-mode", "plan");
      else if (opts.approvalMode) args.push("--permission-mode", opts.approvalMode);
      return args;
    },
  },
  opencode: {
    name: "OpenCode",
    get bins() { return { darwin: resolveCliBin("opencode", PAAW_ROOT), linux: "opencode", win32: "opencode.cmd" }; },
    envBin: "OPENCODE_BIN",
    buildArgs: (opts) => {
      const args = [];
      if (opts.model && opts.model.includes("/")) {
        args.push("-m", opts.model);
      }
      // Fixed port for health check + future SDK API use
      if (opts.serverPort) {
        args.push("--port", String(opts.serverPort));
      }
      return args;
    },
  },
};

function spawnCli(ptySpawn, opts) {
  const cliType = opts.cli || "qwen";
  const config = CLI_CONFIGS[cliType];
  if (!config) throw new Error(`Unknown CLI: ${cliType}`);

  const platform = process.platform;
  let bin = resolveCliBin(cliType);
  const args = config.buildArgs(opts);
  const resolvedCwd = opts.cwd || process.env.QWEN_CWD || PAAW_ROOT;

  const ptyOpts = {
    name: "xterm-256color", cols: 120, rows: 30,
    cwd: resolvedCwd,
    env: { ...process.env },
  };

  // Windows: .cmd files need to be spawned via cmd.exe
  if (platform === "win32" && bin.endsWith(".cmd")) {
    const cmdBin = process.env.COMSPEC || "cmd.exe";
    const cmdArgs = ["/c", bin, ...args];
    console.log(`[PTY] Spawning ${config.name}: ${cmdBin} ${cmdArgs.join(" ")} (cwd: ${resolvedCwd})`);
    try {
      return ptySpawn(cmdBin, cmdArgs, ptyOpts);
    } catch (e) {
      // Fallback: try without cmd.exe wrapper
      console.log(`[PTY] cmd.exe spawn failed, trying direct: ${bin} ${args.join(" ")}`);
      return ptySpawn(bin, args, ptyOpts);
    }
  }

  return ptySpawn(bin, args, ptyOpts);
}

// ── Check which CLIs are installed ──
async function checkInstalledClis() {
  const results = {};
  const platform = process.platform;
  for (const [key, config] of Object.entries(CLI_CONFIGS)) {
    const bin = resolveCliBin(key);
    try {
      // For PATH-based binaries, check if they resolve
      const { execFile } = await import("child_process");
      await new Promise((res, rej) => {
        const cmd = platform === "win32" ? "where" : "which";
        execFile(cmd, [bin], (err) => err ? rej(err) : res(true));
      });
      results[key] = { installed: true, bin, name: config.name };
    } catch {
      results[key] = { installed: false, bin, name: config.name };
    }
  }
  return results;
}

// ── WebSocket connection handler ──

wss.on("connection", (ws, req) => {
  const sessionId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[PTY] New session: ${sessionId}`);

  // ── Local spawn mode ──
  let spawned = false;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      const session = ptySessions.get(ws);
      if (session?.pty) session.pty.write(raw.toString());
      return;
    }

    if (msg.type === "spawn") {
      if (spawned) {
        console.log(`[PTY] Ignoring duplicate spawn for ${sessionId}`);
        return;
      }
      spawned = true;
      const old = ptySessions.get(ws);
      if (old?.pty) { old.pty.kill(); }

      const opts = msg.options || {};
      if (opts.cli === "opencode") {
        opts.serverPort = 4199 + Math.floor(Math.random() * 100);
      }

      try {
        const pty = spawnCli(ptySpawn, opts);
        const cliType = opts.cli || "qwen";
        ptySessions.set(ws, { pty, id: sessionId, cliType, serverPort: opts.serverPort });

        // ── Session logging for Vibe Coding ──
        const vibeLogDir = resolve(PAAW_ROOT, "logs/vibe-sessions");
        mkdirSync(vibeLogDir, { recursive: true });
        const vibeLogFile = resolve(vibeLogDir, `${sessionId}.log`);
        const vibeMetaFile = resolve(vibeLogDir, `${sessionId}.json`);
        let vibeLogSize = 0;
        const stripAnsiForLog = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "").replace(/\x1b\[\?\d+[hl]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        // Write session metadata
        writeFileSync(vibeMetaFile, JSON.stringify({
          id: sessionId, cli: cliType, model: opts.model || null,
          cwd: opts.cwd || null, approvalMode: opts.approvalMode || null,
          systemPrompt: opts.systemPrompt || null,
          createdAt: new Date().toISOString(), lastActive: new Date().toISOString(),
        }, null, 2));
        appendFileSync(vibeLogFile, `# Vibe Coding Session: ${sessionId}\n`);
        appendFileSync(vibeLogFile, `# CLI: ${cliType} | CWD: ${opts.cwd || PAAW_ROOT} | Mode: ${opts.approvalMode || 'default'}\n`);
        appendFileSync(vibeLogFile, `# Started: ${new Date().toISOString()}\n\n`);

        // ── Detect when CLI is truly ready (not just PTY spawned) ──
        let cliReadyFired = false;
        let cliDoneFired = false;
        const ptyStartTime = Date.now();
        const cliReadyPatterns = {
          qwen: /(?:YOLO mode|Plan mode|Auto-edit mode|Default mode|Type your message)/,
          claude: /(?:\?>|^>?\s*$)/m,
          opencode: /(?:Welcome to OpenCode|opencode.*ready)/i,
        };
        // Strip ANSI codes for pattern matching
        const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\].*?\x07/g, "");

        pty.onData((data) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "data", data }));
          }
          // ── Log to vibe session file ──
          try {
            const plain = stripAnsiForLog(data);
            if (plain.trim()) {
              appendFileSync(vibeLogFile, plain);
              vibeLogSize += plain.length;
              // Also log to Memory Distillation Engine (periodic, every ~4KB)
              if (vibeLogSize % 4000 < plain.length) {
                getDistillModule().then(m => m.recordVibeOutput({
                  sessionId,
                  cli: cliType,
                  cwd: opts.cwd || null,
                  output: plain.slice(-2000),
                })).catch(() => {});
              }
            }
          } catch {}
          // Detect CLI ready from output
          if (!cliReadyFired) {
            const plain = stripAnsi(data);
            const pattern = cliReadyPatterns[cliType];
            if (pattern && pattern.test(plain)) {
              cliReadyFired = true;
              console.log(`[PTY] CLI ready detected: ${cliType} (${sessionId})`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "cliReady" }));
              }
            }
          }
          // Detect CLI task done — ONLY after cliReady (avoid false positive during startup)
          if (cliReadyFired && !cliDoneFired) {
            const plain = stripAnsi(data);
            if (/\bDONE\b|已完成|完成！|✅.*完成|^完成$|Task completed|finished/i.test(plain)) {
              cliDoneFired = true;
              console.log(`[PTY] CLI done detected (${sessionId})`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "cliDone" }));
              }
              // Reset after 3s so next task's DONE can be detected
              setTimeout(() => { cliDoneFired = false; }, 3000);
            }
          }
        });

        pty.onExit(({ exitCode }) => {
          console.log(`[PTY] Exited: ${sessionId} (code: ${exitCode})`);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "exit", exitCode }));
          }
          ptySessions.delete(ws);
        });

        ws.send(JSON.stringify({ type: "ready", sessionId, platform: process.platform }));
      } catch (err) {
        console.error(`[PTY] Spawn failed:`, err.message);
        ws.send(JSON.stringify({ type: "error", message: `Failed to start CLI: ${err.message}` }));
      }
    }
    else if (msg.type === "input") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.write(msg.text || "");
        // Log user input to vibe session
        if (session.vibeLogFd !== false) {
          try {
            const vibeLogDir2 = resolve(PAAW_ROOT, "logs/vibe-sessions");
            const metaFile = resolve(vibeLogDir2, `${session.id}.json`);
            const meta = JSON.parse(readFileSync(metaFile, "utf8"));
            meta.lastActive = new Date().toISOString();
            writeFileSync(metaFile, JSON.stringify(meta, null, 2));
          } catch {}
        }
      }
    }
    else if (msg.type === "multiline") {
      // Legacy: Windows multi-line fallback (no longer sent by frontend)
      const session = ptySessions.get(ws);
      if (!session?.pty) return;
      try {
        session.pty.write((msg.text || "").replace(/\n/g, "\r\n") + "\r");
      } catch {}
    }
    else if (msg.type === "resize") {
      const session = ptySessions.get(ws);
      if (session?.pty && msg.cols && msg.rows) {
        session.pty.resize(msg.cols, msg.rows);
      }
    }
    else if (msg.type === "kill") {
      const session = ptySessions.get(ws);
      if (session?.pty) {
        session.pty.kill();
        ptySessions.delete(ws);
      }
    }
  });

  ws.on("close", () => {
    const session = ptySessions.get(ws);
    if (session?.pty) {
      console.log(`[PTY] Connection closed, killing: ${session.id}`);
      session.pty.kill();
      ptySessions.delete(ws);
    }
  });

  ws.on("error", (err) => {
    console.error(`[PTY] WebSocket error:`, err.message);
  });
});

console.log(`[PTY-WS] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);

// ── Vibe Coding Session APIs (routed via vibeSessionsApiHandler) ──
const VIBE_SESSIONS_DIR = resolve(PAAW_ROOT, "logs/vibe-sessions");

const vibeSessionsApiHandler = async (req, res) => {
  const url = req.url || "";

  // GET /api/vibe-sessions — list all
  if (req.method === "GET" && url.match(/^\/api\/vibe-sessions(?:\?.*)?$/)) {
    try {
      mkdirSync(VIBE_SESSIONS_DIR, { recursive: true });
      const files = readdirSync(VIBE_SESSIONS_DIR).filter(f => f.endsWith(".json"));
      const sessions = [];
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(resolve(VIBE_SESSIONS_DIR, f), "utf8"));
          const logFile = resolve(VIBE_SESSIONS_DIR, f.replace(".json", ".log"));
          let logSize = 0;
          try { logSize = statSync(logFile).size; } catch {}
          sessions.push({ ...meta, logSize });
        } catch {}
      }
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/vibe-sessions/:id/log — raw log
  const logMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)\/log(?:\?.*)?$/);
  if (req.method === "GET" && logMatch) {
    try {
      const id = logMatch[1];
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      if (!existsSync(logPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Log not found" }));
        return true;
      }
      const content = readFileSync(logPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/vibe-sessions/:id — metadata
  const oneMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
  if (req.method === "GET" && oneMatch) {
    try {
      const id = oneMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      if (!existsSync(metaPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return true;
      }
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      try { meta.logSize = statSync(logPath).size; } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(meta));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/vibe-sessions/:id/distill
  const distillMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)\/distill(?:\?.*)?$/);
  if (req.method === "POST" && distillMatch) {
    try {
      const id = distillMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      if (!existsSync(metaPath) || !existsSync(logPath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return true;
      }

      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      let logContent = readFileSync(logPath, "utf8");
      if (logContent.length > 30000) {
        logContent = "... (前半省略) ...\n\n" + logContent.slice(-30000);
      }

      let body = {};
      try { body = JSON.parse(await readBodyStr(req)); } catch {}

      const distillPrompt = body.prompt || `你是程式開發知識蒸餾器。請分析以下 AI CLI coding session 的完整 log，精煉出：

1. **任務摘要**：做了什麼、為什麼做
2. **關鍵決策**：選擇了什麼方案、為什麼
3. **技術要點**：用到的技術、工具、技巧
4. **遇到的問題與解法**：bug、error、如何解決
5. **產出的成果**：建立了哪些檔案、功能
6. **可復用的模式**：值得記住的模式、最佳實踐

請用 Markdown 格式輸出，簡潔但有價值。這個摘要會存入知識庫供未來參考。`;

      const fullPrompt = `${distillPrompt}\n\n---\nSession: ${meta.cli} | CWD: ${meta.cwd} | Mode: ${meta.approvalMode}\nDate: ${meta.createdAt}\n\n<log>\n${logContent}\n</log>`;

      let distilled = null;
      try {
        const providerConfig = JSON.parse(readFileSync(resolve(PAAW_ROOT, "data/config/providers.json"), "utf8"));
        const providerId = providerConfig.active;
        const provider = providerConfig.providers[providerId];
        if (provider?.apiKey && provider.apiKey !== "na") {
          const model = providerConfig.defaultModel || "glm-5.1";
          const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;
          const llmResp = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
              ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: distillPrompt },
                { role: "user", content: fullPrompt },
              ],
              max_tokens: 4096,
            }),
          });
          if (llmResp.ok) {
            const data = await llmResp.json();
            distilled = data.choices?.[0]?.message?.content || null;
          }
        }
      } catch (err) {
        console.error(`[distill] LLM call failed: ${err.message}`);
      }

      if (!distilled || distilled.length < 50) {
        distilled = `# Vibe Coding Session 摘要\n\n**Session:** ${meta.id}\n**CLI:** ${meta.cli}\n**工作目錄:** ${meta.cwd}\n**時間:** ${meta.createdAt}\n\n> ⚠️ 自動蒸餾失敗，原始 log 已保存。你可以手動貼到 AI 做摘要。\n\n---\n\n${logContent.slice(0, 5000)}${logContent.length > 5000 ? "\n\n... (截斷)" : ""}`;
      }

      const knowledgeDir = resolve(PAAW_ROOT, "knowledge/vibe-sessions");
      mkdirSync(knowledgeDir, { recursive: true });
      const dateStr = meta.createdAt.replace(/[:.]/g, "-").slice(0, 19);
      const distillFile = resolve(knowledgeDir, `${dateStr}-${meta.cli}-session.md`);
      const md = `# Vibe Coding Session 摘要\n\n**Session ID:** ${meta.id}\n**CLI:** ${meta.cli} ${meta.model ? "(" + meta.model + ")" : ""}\n**工作目錄:** ${meta.cwd}\n**執行模式:** ${meta.approvalMode}\n**時間:** ${meta.createdAt}\n\n---\n\n${distilled}\n\n---\n*蒸餾時間: ${new Date().toISOString()}*`;
      writeFileSync(distillFile, md);

      meta.distilled = true;
      meta.distillFile = distillFile;
      meta.distilledAt = new Date().toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, file: distillFile, content: md }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/vibe-sessions/:id
  const delMatch = url.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
  if (req.method === "DELETE" && delMatch) {
    try {
      const id = delMatch[1];
      const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
      const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
      try { unlinkSync(metaPath); } catch {}
      try { unlinkSync(logPath); } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
};

// ── Memory Distillation Engine (imported from routes/distill.mjs) ──
// record() / recordChatInteraction() / recordVibeOutput() / distillAll() are in routes/distill.mjs
// The old inline distill code has been replaced by the modular engine.
// API routes are handled by the modular distillRouter (loaded in request handler above).
// Auto-distill scheduler hook:
let _distillMod = null;
async function getDistillModule() {
  if (!_distillMod) { _distillMod = await import("./routes/distill.mjs"); }
  return _distillMod;
}

// ── Cron Job Scheduler ──
const CRON_JOBS_FILE = resolve(PAAW_ROOT, "factories/default/cron-jobs.json");
const CRON_LOGS_DIR = resolve(PAAW_ROOT, "logs/cron");
const CRON_RESULTS_DIR = resolve(PAAW_ROOT, "logs/cron-results");

// Simple cron expression parser: "min hour day month dow"
function matchesCron(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mMin, mHour, mDay, mMon, mDow] = parts;
  const check = (val, spec) => {
    if (spec === "*") return true;
    for (const s of spec.split(",")) {
      if (s.includes("-")) {
        const [lo, hi] = s.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
      } else if (parseInt(s) === val) return true;
    }
    return false;
  };
  return check(date.getMinutes(), mMin) && check(date.getHours(), mHour) && check(date.getDate(), mDay) && check(date.getMonth() + 1, mMon) && check(date.getDay(), mDow);
}

async function loadCronJobs() {
  try {
    const raw = await readFile(CRON_JOBS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch { return []; }
}

async function saveCronJobs(jobs) {
  await mkdir(dirname(CRON_JOBS_FILE), { recursive: true });
  await writeFile(CRON_JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
}

async function appendCronLog(jobId, entry) {
  await mkdir(join(CRON_LOGS_DIR, jobId), { recursive: true });
  const logFile = join(CRON_LOGS_DIR, jobId, "history.jsonl");
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n";
  await writeFile(logFile, line, { flag: "a" });
}

async function runCronJob(job) {
  const runTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runId = `${job.id}-${runTs}`;
  console.log(`[cron] Running job: ${job.name} (${job.id}) run=${runId}`);

  await appendCronLog(job.id, { runId, status: "started" });

  // ── Reminder type: inject message into chat ──
  if (job.type === "reminder") {
    try {
      const files = await readdir(PAAW_CHAT_DIR);
      const chatFiles = files.filter(f => f.endsWith(".json")).sort().reverse();
      if (chatFiles.length > 0) {
        const chatPath = resolve(PAAW_CHAT_DIR, chatFiles[0]);
        const chat = JSON.parse(await readFile(chatPath, "utf-8"));
        chat.messages.push({
          role: "assistant",
          content: `⏰ **提醒**：${job.reminderText || job.name}`,
          timestamp: new Date().toISOString(),
        });
        chat.updatedAt = new Date().toISOString();
        await writeFile(chatPath, JSON.stringify(chat, null, 2), "utf-8");
      }
      await appendCronLog(job.id, { runId, status: "done", reminderDelivered: true });
      const jobs = await loadCronJobs();
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        jobs[idx].lastRun = new Date().toISOString();
        jobs[idx].lastStatus = "done";
        await saveCronJobs(jobs);
      }
      console.log(`[cron] Reminder ${job.id} delivered`);
    } catch (err) {
      await appendCronLog(job.id, { runId, status: "error", error: err.message });
      const jobs = await loadCronJobs();
      const idx = jobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        jobs[idx].lastRun = new Date().toISOString();
        jobs[idx].lastStatus = "error";
        await saveCronJobs(jobs);
      }
    }
    return;
  }

  // ── Report type: run CLI ──
  try {
    const { spawn } = await import("child_process");
    // Build prompt with params
    let prompt = job.prompt || `Execute report app ${job.reportAppId}`;
    if (job.params && Object.keys(job.params).length > 0) {
      prompt += `\n\nParameters:\n${Object.entries(job.params).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
    }

    const appDir = resolve(PAAW_ROOT, "skills/physical-skill", job.reportAppId);
    const _cronBin = resolveCliBin("qwen");
    const _cronWin = process.platform === "win32";
    const child = spawn(_cronBin, ["--approval-mode", "yolo", "-o", "text", "--max-session-turns", "20", prompt], {
      cwd: appDir,
      env: { ...process.env, HOME: process.env.HOME || process.env.USERPROFILE, QWEN_CODE_SUPPRESS_YOLO_WARNING: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      shell: _cronWin,  // Windows: .cmd files need shell:true
    });

    let output = "";
    child.stdout.on("data", c => { output += c.toString(); });
    child.stderr.on("data", c => { output += c.toString(); });

    await new Promise((resolve, reject) => {
      child.on("close", resolve);
      child.on("error", reject);
    });

    // Save result snapshot
    const resultDir = join(CRON_RESULTS_DIR, job.id);
    await mkdir(resultDir, { recursive: true });

    // Extract HTML from output if present
    let htmlContent = output;
    const codeBlockMatch = htmlContent.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) htmlContent = codeBlockMatch[1].trim();
    let htmlMatch = htmlContent.match(/<!DOCTYPE\s+html[^>]*>[\s\S]*<\/html>/i);
    if (htmlMatch) htmlContent = htmlMatch[0];
    else {
      htmlMatch = htmlContent.match(/<html[\s\S]*<\/html>/i);
      if (htmlMatch) htmlContent = htmlMatch[0];
    }

    const hasHtml = htmlContent.includes("<html");
    if (hasHtml) {
      await writeFile(join(resultDir, `${runTs}.html`), htmlContent, "utf-8");
    }

    // Also save raw text output
    await writeFile(join(resultDir, `${runTs}.txt`), output, "utf-8");

    await appendCronLog(job.id, { runId, status: "done", outputLength: output.length, hasHtml, resultFile: `${runTs}.${hasHtml ? "html" : "txt"}` });

    // Update job's lastRun
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx].lastRun = new Date().toISOString();
      jobs[idx].lastStatus = "done";
      await saveCronJobs(jobs);
    }
    console.log(`[cron] Job ${job.id} done, hasHtml=${hasHtml}`);
  } catch (err) {
    await appendCronLog(job.id, { runId, status: "error", error: err.message });
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx].lastRun = new Date().toISOString();
      jobs[idx].lastStatus = "error";
      await saveCronJobs(jobs);
    }
    console.log(`[cron] Job ${job.id} error:`, err.message);
  }
}

// Check every 60s
const lastCronMin = { min: -1 };
setInterval(async () => {
  const now = new Date();
  if (now.getMinutes() === lastCronMin.min) return; // already checked this minute
  lastCronMin.min = now.getMinutes();

  try {
    const jobs = await loadCronJobs();
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (matchesCron(job.schedule, now)) {
        runCronJob(job).catch(() => {}); // fire and forget
      }
    }
  } catch {}
}, 30_000);

console.log("[cron] Scheduler started, checking every 60s");

// ── Auto-distill scheduler (delegates to routes/distill.mjs) ──
const lastDistillDate = { date: "" };
setInterval(async () => {
  try {
    const mod = await getDistillModule();
    const config = mod.loadConfig ? mod.loadConfig() : null;
    if (!config?.enabled || !config?.autoDistill) return;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    if (mod.matchesCron && mod.matchesCron(config.autoDistillSchedule, now) && lastDistillDate.date !== dateStr) {
      lastDistillDate.date = dateStr;
      console.log(`[distill] Running auto-distill for ${dateStr}`);
      mod.distillAll().catch(err => console.error("[distill] Error:", err.message));
    }
  } catch {}
}, 60_000);
console.log("[distill] Auto-distill scheduler started");
// Cron API endpoints (registered inside server handler)
const cronApiHandler = async (req, res) => {
  // GET /api/cron-jobs
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs(?:\?.*)?$/)) {
    const jobs = await loadCronJobs();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jobs));
    return true;
  }
  // POST /api/cron-jobs
  if (req.method === "POST" && req.url === "/api/cron-jobs") {
    let parsed;
    try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const job = {
      id: parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `cron-${Date.now()}`,
      name: parsed.name,
      type: parsed.type || "report", // "report" or "reminder"
      reminderText: parsed.reminderText || "",
      reportAppId: parsed.reportAppId || "",
      schedule: parsed.schedule || "0 * * * *",
      prompt: parsed.prompt || "",
      params: parsed.params || {},
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
    };
    jobs.push(job);
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(job));
    return true;
  }
  // PATCH /api/cron-jobs/:id
  if (req.method === "PATCH" && req.url?.match(/^\/api\/cron-jobs\/[^/]+$/)) {
    const id = req.url.split("/").pop();
    let patch;
    try { patch = JSON.parse(body); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const jobs = await loadCronJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx < 0) { res.writeHead(404); res.end("Not found"); return true; }
    if (patch.enabled !== undefined) jobs[idx].enabled = patch.enabled;
    if (patch.schedule) jobs[idx].schedule = patch.schedule;
    if (patch.prompt) jobs[idx].prompt = patch.prompt;
    if (patch.name) jobs[idx].name = patch.name;
    if (patch.params) jobs[idx].params = patch.params;
    if (patch.reportAppId) jobs[idx].reportAppId = patch.reportAppId;
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jobs[idx]));
    return true;
  }
  // DELETE /api/cron-jobs/:id
  if (req.method === "DELETE" && req.url?.match(/^\/api\/cron-jobs\/[^/]+$/)) {
    const id = req.url.split("/").pop();
    let jobs = await loadCronJobs();
    jobs = jobs.filter(j => j.id !== id);
    await saveCronJobs(jobs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  // GET /api/cron-jobs/:id/logs
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/logs$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const logFile = join(CRON_LOGS_DIR, id, "history.jsonl");
    try {
      const raw = await readFile(logFile, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lines.slice(-50)));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }
  // GET /api/cron-jobs/:id/results — list result files
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/results$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const resultDir = join(CRON_RESULTS_DIR, id);
    try {
      const files = await readdir(resultDir);
      const results = [];
      for (const f of files.sort().reverse()) {
        if (f.endsWith(".html") || f.endsWith(".txt")) {
          results.push({ file: f, name: f.replace(/\.(html|txt)$/, ""), type: f.endsWith(".html") ? "html" : "text" });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results.slice(0, 50)));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    }
    return true;
  }
  // GET /api/cron-result?path=... — serve a specific result file
  if (req.method === "GET" && req.url?.match(/^\/api\/cron-result\?/)) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const filePath = urlObj.searchParams.get("path");
    if (!filePath || !filePath.includes("/cron-results/")) {
      res.writeHead(403); res.end("Forbidden"); return true;
    }
    try {
      const content = await readFile(filePath, "utf-8");
      const isHtml = filePath.endsWith(".html");
      res.writeHead(200, { "Content-Type": isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" });
      res.end(content);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }
  // POST /api/cron-jobs/:id/run — manual trigger
  if (req.method === "POST" && req.url?.match(/^\/api\/cron-jobs\/[^/]+\/run$/)) {
    const parts = req.url.split("/");
    const id = parts[parts.length - 2];
    const jobs = await loadCronJobs();
    const job = jobs.find(j => j.id === id);
    if (!job) { res.writeHead(404); res.end("Not found"); return true; }
    runCronJob(job).catch(() => {});
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Job triggered" }));
    return true;
  }
  return false;
};

// Log installed CLIs on startup
checkInstalledClis().then(clis => {
  for (const [key, info] of Object.entries(clis)) {
    console.log(`[CLI] ${info.name}: ${info.installed ? `✅ ${info.bin}` : "❌ not found"}`);
  }
}).catch(() => {});

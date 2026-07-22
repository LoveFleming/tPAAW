/**
 * Coding Issues Route — Issue tracking for .paaw/ projects
 *
 * Issues = problem/requirement records (記錄、分類、追蹤)
 * Tasks = actionable work items (派工、執行、追蹤) → /api/coding-tasks
 *
 * Endpoints:
 *   GET    /api/coding-issues?path=...                    — List issues (filter: status, priority, label, type)
 *   GET    /api/coding-issues/:id?path=...                — Get single issue
 *   POST   /api/coding-issues?path=...                    — Create issue
 *   PUT    /api/coding-issues/:id?path=...                — Update issue
 *   DELETE /api/coding-issues/:id?path=...                — Delete issue
 *   POST   /api/coding-issues/import-known?path=...       — Import from KNOWN-ISSUES.md
 *   POST   /api/coding-issues/:id/notes?path=...          — Add note
 *   GET    /api/coding-issues/stats?path=...              — Summary stats
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";
import { PaawProject } from "../lib/paaw-project.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── Helpers ──

function parseQuery(rawUrl) {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx < 0) return {};
  const params = {};
  for (const part of rawUrl.slice(qIdx + 1).split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return params;
}

function genId(existing) {
  const nums = existing
    .map(i => parseInt(i.id?.replace(/^ISS-/, ""), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `ISS-${String(next).padStart(3, "0")}`;
}

function now() { return new Date().toISOString(); }

async function loadIssues(projectPath) {
  const issuesFile = join(projectPath, ".paaw", "issues", "ISSUES.json");
  if (!existsSync(issuesFile)) return [];
  try {
    const data = JSON.parse(await readFile(issuesFile, "utf-8"));
    if (!Array.isArray(data.issues)) return [];
    return data.issues.map(i => ({
      id: i.id || "",
      title: i.title || "",
      type: i.type || "bug",              // bug, security, requirement, enhancement
      status: i.status || "open",
      priority: i.priority || "medium",
      severity: i.severity || null,        // critical, major, minor, info
      labels: Array.isArray(i.labels) ? i.labels : [],
      linkedTaskIds: Array.isArray(i.linkedTaskIds) ? i.linkedTaskIds : [],
      description: i.description || "",
      reproduction: i.reproduction || "",
      solution: i.solution || "",
      relatedFiles: Array.isArray(i.relatedFiles) ? i.relatedFiles : [],
      notes: Array.isArray(i.notes) ? i.notes : [],
      createdAt: i.createdAt || now(),
      updatedAt: i.updatedAt || now(),
      resolvedAt: i.resolvedAt || null,
      createdBy: i.createdBy || "user",
    }));
  } catch { return []; }
}

async function saveIssues(projectPath, issues) {
  const issuesDir = join(projectPath, ".paaw", "issues");
  if (!existsSync(issuesDir)) await mkdir(issuesDir, { recursive: true });
  const issuesFile = join(issuesDir, "ISSUES.json");
  await writeFile(issuesFile, JSON.stringify({ issues, updatedAt: now() }, null, 2), "utf-8");
}

// ── KNOWN-ISSUES.md parser ──

function parseKnownIssues(md) {
  const issues = [];
  const lines = md.split("\n");
  let current = null;
  let inOpenSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+.*open/i.test(line)) { inOpenSection = true; continue; }
    if (/^##\s+.*resolved|##\s+.*closed/i.test(line)) { inOpenSection = false; continue; }
    const h3 = line.match(/^###\s+(KI-\d+):\s*(.+)/);
    if (h3) {
      if (current) issues.push(current);
      current = {
        id: h3[1].replace(/^KI-/, "ISS-"),
        title: h3[2].trim(),
        status: inOpenSection ? "open" : "closed",
        priority: "medium",
        labels: [],
        linkedTaskIds: [],
        description: "",
        reproduction: "",
        solution: "",
        relatedFiles: [],
        createdAt: now(),
        updatedAt: now(),
        resolvedAt: inOpenSection ? null : now(),
        createdBy: "import",
        originalId: h3[1],
      };
      continue;
    }
    if (!current) continue;
    const impact = line.match(/[-*]\s+\*\*影響[：:]\*\*\s*(.+)/);
    if (impact) { current.description = impact[1].trim(); continue; }
    const workaround = line.match(/[-*]\s+\*\*[Ww]orkaround[：:]\*\*\s*(.+)/);
    if (workaround) { current.solution = workaround[1].trim(); continue; }
    const priority = line.match(/[-*]\s+\*\*優先級[：:]\*\*\s*(\w+)/);
    if (priority) {
      const p = priority[1].toLowerCase().trim();
      if (["critical", "high", "medium", "low"].includes(p)) current.priority = p;
      continue;
    }
    const related = line.match(/[-*]\s+\*\*相關[：:]\*\*\s*(.+)/);
    if (related) { current.relatedFiles = related[1].split(",").map(s => s.trim()).filter(Boolean); continue; }
  }
  if (current) issues.push(current);
  return issues;
}

// ── Route Handler ──

export default async function codingIssuesRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  if (!url.startsWith("/api/coding-issues")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const projRoot = resolve(projectPath);

  // ── GET /api/coding-issues/stats ──
  if (url === "/api/coding-issues/stats" && method === "GET") {
    const issues = await loadIssues(projRoot);
    const stats = {
      total: issues.length,
      open: issues.filter(i => i.status === "open").length,
      inProgress: issues.filter(i => i.status === "in-progress").length,
      resolved: issues.filter(i => i.status === "resolved").length,
      closed: issues.filter(i => i.status === "closed").length,
      wontfix: issues.filter(i => i.status === "wontfix").length,
      byPriority: {
        critical: issues.filter(i => i.priority === "critical").length,
        high: issues.filter(i => i.priority === "high").length,
        medium: issues.filter(i => i.priority === "medium").length,
        low: issues.filter(i => i.priority === "low").length,
      },
      byType: {
        bug: issues.filter(i => i.type === "bug").length,
        security: issues.filter(i => i.type === "security").length,
        requirement: issues.filter(i => i.type === "requirement").length,
        enhancement: issues.filter(i => i.type === "enhancement").length,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return true;
  }

  // ── POST /api/coding-issues/import-known ──
  if (url === "/api/coding-issues/import-known" && method === "POST") {
    const paaw = new PaawProject(projRoot);
    const knownFile = paaw._resolvePath("KNOWN-ISSUES.md");
    if (!existsSync(knownFile)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "KNOWN-ISSUES.md not found" }));
      return true;
    }
    const md = readSync(knownFile, "utf-8");
    const imported = parseKnownIssues(md);
    const existing = await loadIssues(projRoot);
    const existingIds = new Set(existing.map(i => i.id));
    const newIssues = imported.filter(i => !existingIds.has(i.id));
    const all = [...existing, ...newIssues];
    await saveIssues(projRoot, all);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ imported: newIssues.length, total: all.length, issues: newIssues }));
    return true;
  }

  // ── POST /api/coding-issues/:id/notes ──
  const notesMatch = url.match(/^\/api\/coding-issues\/([^/?]+)\/notes$/);
  if (notesMatch && method === "POST") {
    const id = decodeURIComponent(notesMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    if (!body.content?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Note content is required" }));
      return true;
    }
    const issues = await loadIssues(projRoot);
    const idx = issues.findIndex(i => i.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Issue not found" }));
      return true;
    }
    if (!Array.isArray(issues[idx].notes)) issues[idx].notes = [];
    issues[idx].notes.push({ by: body.by || "user", at: now(), content: body.content.trim() });
    issues[idx].updatedAt = now();
    await saveIssues(projRoot, issues);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(issues[idx]));
    return true;
  }

  // ── GET /api/coding-issues/:id ──
  const singleMatch = url.match(/^\/api\/coding-issues\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const id = decodeURIComponent(singleMatch[1]);
    const issues = await loadIssues(projRoot);
    const issue = issues.find(i => i.id === id);
    if (!issue) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Issue not found" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(issue));
    return true;
  }

  // ── PUT /api/coding-issues/:id ──
  if (singleMatch && method === "PUT") {
    const id = decodeURIComponent(singleMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const issues = await loadIssues(projRoot);
    const idx = issues.findIndex(i => i.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Issue not found" }));
      return true;
    }
    const updated = { ...issues[idx], ...body, id: issues[idx].id, updatedAt: now() };
    if ((body.status === "resolved" || body.status === "closed") && !updated.resolvedAt) {
      updated.resolvedAt = now();
    }
    if (body.status === "open" || body.status === "in-progress") {
      updated.resolvedAt = null;
    }
    issues[idx] = updated;
    await saveIssues(projRoot, issues);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // ── DELETE /api/coding-issues/:id ──
  if (singleMatch && method === "DELETE") {
    const id = decodeURIComponent(singleMatch[1]);
    const issues = await loadIssues(projRoot);
    const idx = issues.findIndex(i => i.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Issue not found" }));
      return true;
    }
    const deleted = issues.splice(idx, 1)[0];
    await saveIssues(projRoot, issues);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return true;
  }

  // ── GET /api/coding-issues (list) ──
  if (url === "/api/coding-issues" && method === "GET") {
    let issues = await loadIssues(projRoot);
    if (q.status) { const s = q.status.split(","); issues = issues.filter(i => s.includes(i.status)); }
    if (q.priority) { const s = q.priority.split(","); issues = issues.filter(i => s.includes(i.priority)); }
    if (q.label) { issues = issues.filter(i => i.labels?.includes(q.label)); }
    if (q.type) { const s = q.type.split(","); issues = issues.filter(i => s.includes(i.type)); }
    if (q.search) {
      const s = q.search.toLowerCase();
      issues = issues.filter(i =>
        i.title?.toLowerCase().includes(s) ||
        i.description?.toLowerCase().includes(s) ||
        i.id?.toLowerCase().includes(s)
      );
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusOrder = { open: 0, "in-progress": 1, resolved: 2, closed: 3, wontfix: 4 };
    issues.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ issues }));
    return true;
  }

  // ── POST /api/coding-issues (create) ──
  if (url === "/api/coding-issues" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    if (!body.title?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Title is required" }));
      return true;
    }
    const issues = await loadIssues(projRoot);
    const newIssue = {
      id: genId(issues),
      title: body.title.trim(),
      type: body.type || "bug",
      status: body.status || "open",
      priority: body.priority || "medium",
      severity: body.severity || null,
      labels: body.labels || [],
      linkedTaskIds: body.linkedTaskIds || [],
      description: body.description || "",
      reproduction: body.reproduction || "",
      solution: body.solution || "",
      relatedFiles: body.relatedFiles || [],
      notes: body.notes || [],
      createdAt: now(),
      updatedAt: now(),
      resolvedAt: null,
      createdBy: body.createdBy || "user",
    };
    issues.push(newIssue);
    await saveIssues(projRoot, issues);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newIssue));
    return true;
  }

  return false;
}

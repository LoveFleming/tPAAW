/**
 * Coding Tasks Route — Task management for .paaw/ projects
 *
 * Tasks = actionable work items (派工、執行、追蹤)
 * Issues = problem/requirement records (記錄、分類、追蹤)
 *
 * Endpoints:
 *   GET    /api/coding-tasks?path=...                       — List tasks (filter: status, type, priority, assignee, parentId)
 *   GET    /api/coding-tasks/:id?path=...                   — Get single task
 *   POST   /api/coding-tasks?path=...                       — Create task
 *   PUT    /api/coding-tasks/:id?path=...                   — Update task
 *   DELETE /api/coding-tasks/:id?path=...                   — Delete task
 *   POST   /api/coding-tasks/decompose?path=...             — Decompose into sub-tasks
 *   POST   /api/coding-tasks/:id/notes?path=...             — Add note
 *   GET    /api/coding-tasks/stats?path=...                 — Summary stats
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";

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
    .map(i => parseInt(i.id?.replace(/^TASK-/, ""), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `TASK-${String(next).padStart(3, "0")}`;
}

function now() { return new Date().toISOString(); }

async function loadTasks(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return [];
  try {
    const data = JSON.parse(await readFile(tasksFile, "utf-8"));
    if (!Array.isArray(data.tasks)) return [];
    return data.tasks.map(t => ({
      id: t.id || "",
      title: t.title || "",
      type: t.type || "chore",          // requirement, bug, security, chore
      parentId: t.parentId || null,
      linkedIssueId: t.linkedIssueId || null,
      status: t.status || "open",
      priority: t.priority || "medium",
      effort: t.effort || null,          // S, M, L, XL
      labels: Array.isArray(t.labels) ? t.labels : [],
      assignee: t.assignee || null,
      description: t.description || "",
      relatedFiles: Array.isArray(t.relatedFiles) ? t.relatedFiles : [],
      notes: Array.isArray(t.notes) ? t.notes : [],
      executionResult: t.executionResult || null,
      createdAt: t.createdAt || now(),
      updatedAt: t.updatedAt || now(),
      resolvedAt: t.resolvedAt || null,
      createdBy: t.createdBy || "agent",
    }));
  } catch { return []; }
}

async function saveTasks(projectPath, tasks) {
  const tasksDir = join(projectPath, ".paaw", "tasks");
  if (!existsSync(tasksDir)) await mkdir(tasksDir, { recursive: true });
  const tasksFile = join(tasksDir, "TASKS.json");
  await writeFile(tasksFile, JSON.stringify({ tasks, updatedAt: now() }, null, 2), "utf-8");
}

// ── Route Handler ──

export default async function codingTasksRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  if (!url.startsWith("/api/coding-tasks")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const projRoot = resolve(projectPath);

  // ── GET /api/coding-tasks/stats ──
  if (url === "/api/coding-tasks/stats" && method === "GET") {
    const tasks = await loadTasks(projRoot);
    const stats = {
      total: tasks.length,
      open: tasks.filter(t => t.status === "open").length,
      inProgress: tasks.filter(t => t.status === "in-progress").length,
      resolved: tasks.filter(t => t.status === "resolved").length,
      closed: tasks.filter(t => t.status === "closed").length,
      wontfix: tasks.filter(t => t.status === "wontfix").length,
      byPriority: {
        critical: tasks.filter(t => t.priority === "critical").length,
        high: tasks.filter(t => t.priority === "high").length,
        medium: tasks.filter(t => t.priority === "medium").length,
        low: tasks.filter(t => t.priority === "low").length,
      },
      byType: {
        requirement: tasks.filter(t => t.type === "requirement").length,
        bug: tasks.filter(t => t.type === "bug").length,
        security: tasks.filter(t => t.type === "security").length,
        chore: tasks.filter(t => t.type === "chore").length,
      },
      byAssignee: {},
    };
    for (const t of tasks) {
      const a = t.assignee || "unassigned";
      if (!stats.byAssignee[a]) stats.byAssignee[a] = { total: 0, open: 0, resolved: 0 };
      stats.byAssignee[a].total++;
      if (t.status === "open" || t.status === "in-progress") stats.byAssignee[a].open++;
      if (t.status === "resolved" || t.status === "closed") stats.byAssignee[a].resolved++;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return true;
  }

  // ── POST /api/coding-tasks/decompose ──
  if (url === "/api/coding-tasks/decompose" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { parentId, subTasks } = body;
    if (!parentId || !Array.isArray(subTasks) || subTasks.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "parentId and subTasks[] are required" }));
      return true;
    }
    const tasks = await loadTasks(projRoot);
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Task ${parentId} not found` }));
      return true;
    }
    const created = [];
    for (const sub of subTasks) {
      if (!sub.title?.trim()) continue;
      const newSub = {
        id: genId(tasks.concat(created)),
        title: sub.title.trim(),
        type: sub.type || parent.type,
        parentId: parentId,
        linkedIssueId: sub.linkedIssueId || parent.linkedIssueId || null,
        status: "open",
        priority: sub.priority || parent.priority,
        effort: sub.effort || null,
        labels: sub.labels || parent.labels || [],
        assignee: sub.assignee || null,
        description: sub.description || "",
        relatedFiles: sub.relatedFiles || [],
        notes: [],
        executionResult: null,
        createdAt: now(),
        updatedAt: now(),
        resolvedAt: null,
        createdBy: body.createdBy || "agent",
      };
      created.push(newSub);
    }
    // Mark parent in-progress
    if (parent.status === "open") {
      parent.status = "in-progress";
      parent.updatedAt = now();
    }
    if (!Array.isArray(parent.notes)) parent.notes = [];
    parent.notes.push({
      by: body.createdBy || "agent",
      at: now(),
      content: `拆分為 ${created.length} 個子任務：${created.map(s => s.id).join(", ")}`,
    });
    parent.updatedAt = now();

    const all = [...tasks, ...created];
    await saveTasks(projRoot, all);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ parentId, subTasks: created, total: all.length }));
    return true;
  }

  // ── POST /api/coding-tasks/:id/notes ──
  const notesMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/notes$/);
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
    const tasks = await loadTasks(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    if (!Array.isArray(tasks[idx].notes)) tasks[idx].notes = [];
    tasks[idx].notes.push({ by: body.by || "user", at: now(), content: body.content.trim() });
    tasks[idx].updatedAt = now();
    await saveTasks(projRoot, tasks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tasks[idx]));
    return true;
  }

  // ── GET /api/coding-tasks/:id ──
  const singleMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const id = decodeURIComponent(singleMatch[1]);
    const tasks = await loadTasks(projRoot);
    const task = tasks.find(t => t.id === id);
    if (!task) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // ── PUT /api/coding-tasks/:id ──
  if (singleMatch && method === "PUT") {
    const id = decodeURIComponent(singleMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const tasks = await loadTasks(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const updated = {
      ...tasks[idx],
      ...body,
      id: tasks[idx].id,
      updatedAt: now(),
    };
    if ((body.status === "resolved" || body.status === "closed") && !updated.resolvedAt) {
      updated.resolvedAt = now();
    }
    if (body.status === "open" || body.status === "in-progress") {
      updated.resolvedAt = null;
    }
    tasks[idx] = updated;
    await saveTasks(projRoot, tasks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // ── DELETE /api/coding-tasks/:id ──
  if (singleMatch && method === "DELETE") {
    const id = decodeURIComponent(singleMatch[1]);
    const tasks = await loadTasks(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const deleted = tasks.splice(idx, 1)[0];
    await saveTasks(projRoot, tasks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return true;
  }

  // ── GET /api/coding-tasks (list) ──
  if (url === "/api/coding-tasks" && method === "GET") {
    let tasks = await loadTasks(projRoot);
    if (q.status) { const s = q.status.split(","); tasks = tasks.filter(t => s.includes(t.status)); }
    if (q.priority) { const s = q.priority.split(","); tasks = tasks.filter(t => s.includes(t.priority)); }
    if (q.type) { const s = q.type.split(","); tasks = tasks.filter(t => s.includes(t.type)); }
    if (q.assignee) { const s = q.assignee.split(","); tasks = tasks.filter(t => s.includes(t.assignee || "unassigned")); }
    if (q.parentId) { tasks = tasks.filter(t => t.parentId === q.parentId); }
    if (q.linkedIssueId) { tasks = tasks.filter(t => t.linkedIssueId === q.linkedIssueId); }
    if (q.search) {
      const s = q.search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title?.toLowerCase().includes(s) ||
        t.description?.toLowerCase().includes(s) ||
        t.id?.toLowerCase().includes(s)
      );
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusOrder = { open: 0, "in-progress": 1, resolved: 2, closed: 3, wontfix: 4 };
    tasks.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tasks }));
    return true;
  }

  // ── POST /api/coding-tasks (create) ──
  if (url === "/api/coding-tasks" && method === "POST") {
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
    const tasks = await loadTasks(projRoot);
    const newTask = {
      id: genId(tasks),
      title: body.title.trim(),
      type: body.type || "chore",
      parentId: body.parentId || null,
      linkedIssueId: body.linkedIssueId || null,
      status: body.status || "open",
      priority: body.priority || "medium",
      effort: body.effort || null,
      labels: body.labels || [],
      assignee: body.assignee || null,
      description: body.description || "",
      relatedFiles: body.relatedFiles || [],
      notes: body.notes || [],
      executionResult: null,
      createdAt: now(),
      updatedAt: now(),
      resolvedAt: null,
      createdBy: body.createdBy || "user",
    };
    tasks.push(newTask);
    await saveTasks(projRoot, tasks);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newTask));
    return true;
  }

  return false;
}

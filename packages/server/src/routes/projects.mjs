/**
 * PAAW Project Board API
 *
 * 專案管理看板 — 多專案、分類任務、里程碑、進度追蹤
 *
 * API:
 *   GET    /api/projects                 — 列出所有專案
 *   POST   /api/projects                 — 新增專案
 *   GET    /api/projects/:id             — 取得專案詳情
 *   PUT    /api/projects/:id             — 更新專案
 *   DELETE /api/projects/:id             — 刪除專案
 *   GET    /api/projects/:id/stats       — 專案統計
 *   POST   /api/projects/:id/categories  — 新增分類
 *   PUT    /api/projects/:id/categories/:catId   — 更新分類
 *   DELETE /api/projects/:id/categories/:catId   — 刪除分類
 *   POST   /api/projects/:id/tasks       — 新增任務
 *   PUT    /api/projects/:id/tasks/:taskId       — 更新任務
 *   DELETE /api/projects/:id/tasks/:taskId       — 刪除任務
 *   POST   /api/projects/:id/milestones  — 新增里程碑
 *   PUT    /api/projects/:id/milestones/:msId    — 更新里程碑
 *   DELETE /api/projects/:id/milestones/:msId    — 刪除里程碑
 */

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readBody } from "./shared.mjs";
import { DATA_HOME } from "../data-home.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const DATA_DIR = resolve(DATA_HOME, "projects");

// ── Helpers ──

function genId(prefix = "p") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

async function loadProject(id) {
  const file = resolve(DATA_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf-8"));
}

async function saveProject(project) {
  await ensureDataDir();
  const file = resolve(DATA_DIR, `${project.id}.json`);
  await writeFile(file, JSON.stringify(project, null, 2), "utf-8");
}

async function listAllProjects() {
  await ensureDataDir();
  const files = await readdir(DATA_DIR);
  const projects = [];
  for (const f of files.filter(f => f.endsWith(".json"))) {
    try {
      const data = JSON.parse(await readFile(resolve(DATA_DIR, f), "utf-8"));
      // 只回傳 summary
      const allTasks = (data.categories || []).flatMap(c => c.tasks || []);
      const done = allTasks.filter(t => t.status === "done").length;
      const total = allTasks.length;
      projects.push({
        id: data.id,
        name: data.name,
        icon: data.icon,
        description: data.description,
        status: data.status,
        startDate: data.startDate,
        targetDate: data.targetDate,
        repo: data.repo,
        dashboard: data.dashboard,
        taskDone: done,
        taskTotal: total,
        taskPct: total > 0 ? Math.round((done / total) * 100) : 0,
        milestonesTotal: (data.milestones || []).length,
        milestonesDone: (data.milestones || []).filter(m => m.status === "done").length,
      });
    } catch {}
  }
  return projects;
}

function computeStats(project) {
  const allTasks = (project.categories || []).flatMap(c => c.tasks || []);
  const done = allTasks.filter(t => t.status === "done").length;
  const progress = allTasks.filter(t => t.status === "progress").length;
  const todo = allTasks.filter(t => t.status === "todo").length;
  const total = allTasks.length;
  return {
    total,
    done,
    progress,
    todo,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    milestonesTotal: (project.milestones || []).length,
    milestonesDone: (project.milestones || []).filter(m => m.status === "done").length,
    categories: (project.categories || []).map(c => {
      const cDone = (c.tasks || []).filter(t => t.status === "done").length;
      const cTotal = (c.tasks || []).length;
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        description: c.description,
        done: cDone,
        total: cTotal,
        pct: cTotal > 0 ? Math.round((cDone / cTotal) * 100) : 0,
      };
    }),
  };
}

// ════════════════════════════════════════
// Route Handler
// ════════════════════════════════════════

async function handleProjectRoutes(req, res) {
  const url = req.url || "";
  const method = req.method;
  const parsedUrl = new URL(url, "http://localhost");
  const path = parsedUrl.pathname;

  if (method === "OPTIONS") return false;

  // ── Project list / create ──

  // GET /api/projects
  if (path === "/api/projects" && method === "GET") {
    const projects = await listAllProjects();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects }));
    return true;
  }

  // POST /api/projects
  if (path === "/api/projects" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const id = body.id || genId("p");
    const project = {
      id,
      name: body.name || "新專案",
      icon: body.icon || "📋",
      description: body.description || "",
      status: body.status || "todo",
      startDate: body.startDate || new Date().toISOString().slice(0, 10),
      targetDate: body.targetDate || "",
      repo: body.repo || "",
      dashboard: body.dashboard || "",
      categories: body.categories || [],
      milestones: body.milestones || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, project }));
    return true;
  }

  // ── Single project ──

  // GET /api/projects/:id
  const detailMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (detailMatch && method === "GET") {
    const project = await loadProject(detailMatch[1]);
    if (!project) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Project not found" })); return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ project }));
    return true;
  }

  // PUT /api/projects/:id
  if (detailMatch && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(detailMatch[1]);
    if (!project) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Project not found" })); return true;
    }
    for (const [k, v] of Object.entries(body)) {
      if (k !== "id" && k !== "createdAt") project[k] = v;
    }
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, project }));
    return true;
  }

  // DELETE /api/projects/:id
  if (detailMatch && method === "DELETE") {
    const id = detailMatch[1];
    const file = resolve(DATA_DIR, `${id}.json`);
    if (existsSync(file)) {
      const { rm } = await import("fs/promises");
      await rm(file);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // GET /api/projects/:id/stats
  const statsMatch = path.match(/^\/api\/projects\/([^/]+)\/stats$/);
  if (statsMatch && method === "GET") {
    const project = await loadProject(statsMatch[1]);
    if (!project) {
      res.writeHead(404); res.end(JSON.stringify({ error: "Project not found" })); return true;
    }
    const stats = computeStats(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ stats }));
    return true;
  }

  // ── Categories ──

  // POST /api/projects/:id/categories
  const catMatch = path.match(/^\/api\/projects\/([^/]+)\/categories$/);
  if (catMatch && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(catMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const cat = {
      id: genId("c"),
      name: body.name || "新分類",
      icon: body.icon || "📁",
      description: body.description || "",
      tasks: [],
    };
    project.categories = project.categories || [];
    project.categories.push(cat);
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, category: cat }));
    return true;
  }

  // PUT /api/projects/:id/categories/:catId
  const catDetailMatch = path.match(/^\/api\/projects\/([^/]+)\/categories\/([^/]+)$/);
  if (catDetailMatch && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(catDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const cat = (project.categories || []).find(c => c.id === catDetailMatch[2]);
    if (!cat) { res.writeHead(404); res.end(JSON.stringify({ error: "Category not found" })); return true; }
    if (body.name !== undefined) cat.name = body.name;
    if (body.icon !== undefined) cat.icon = body.icon;
    if (body.description !== undefined) cat.description = body.description;
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, category: cat }));
    return true;
  }

  // DELETE /api/projects/:id/categories/:catId
  if (catDetailMatch && method === "DELETE") {
    const project = await loadProject(catDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    project.categories = (project.categories || []).filter(c => c.id !== catDetailMatch[2]);
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Tasks ──

  // POST /api/projects/:id/tasks (body.categoryId 指定分類)
  const taskMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks$/);
  if (taskMatch && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(taskMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const cat = (project.categories || []).find(c => c.id === body.categoryId);
    if (!cat) { res.writeHead(404); res.end(JSON.stringify({ error: "Category not found" })); return true; }
    const task = {
      id: genId("t"),
      name: body.name || "新任務",
      status: body.status || "todo",
      priority: body.priority || "medium",
      start: body.start || "",
      end: body.end || "",
      assignee: body.assignee || "",
    };
    cat.tasks = cat.tasks || [];
    cat.tasks.push(task);
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, task }));
    return true;
  }

  // PUT /api/projects/:id/tasks/:taskId
  const taskDetailMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)$/);
  if (taskDetailMatch && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(taskDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    let found = null;
    for (const cat of (project.categories || [])) {
      found = (cat.tasks || []).find(t => t.id === taskDetailMatch[2]);
      if (found) {
        if (body.name !== undefined) found.name = body.name;
        if (body.status !== undefined) found.status = body.status;
        if (body.priority !== undefined) found.priority = body.priority;
        if (body.start !== undefined) found.start = body.start;
        if (body.end !== undefined) found.end = body.end;
        if (body.assignee !== undefined) found.assignee = body.assignee;
        break;
      }
    }
    if (!found) { res.writeHead(404); res.end(JSON.stringify({ error: "Task not found" })); return true; }
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, task: found }));
    return true;
  }

  // DELETE /api/projects/:id/tasks/:taskId
  if (taskDetailMatch && method === "DELETE") {
    const project = await loadProject(taskDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    for (const cat of (project.categories || [])) {
      const before = (cat.tasks || []).length;
      cat.tasks = (cat.tasks || []).filter(t => t.id !== taskDetailMatch[2]);
      if (cat.tasks.length < before) break;
    }
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Milestones ──

  // POST /api/projects/:id/milestones
  const msMatch = path.match(/^\/api\/projects\/([^/]+)\/milestones$/);
  if (msMatch && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(msMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const ms = {
      id: genId("m"),
      name: body.name || "新里程碑",
      status: body.status || "todo",
      note: body.note || "",
      date: body.date || "",
    };
    project.milestones = project.milestones || [];
    project.milestones.push(ms);
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, milestone: ms }));
    return true;
  }

  // PUT/DELETE /api/projects/:id/milestones/:msId
  const msDetailMatch = path.match(/^\/api\/projects\/([^/]+)\/milestones\/([^/]+)$/);
  if (msDetailMatch && method === "PUT") {
    const body = JSON.parse(await readBody(req));
    const project = await loadProject(msDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const ms = (project.milestones || []).find(m => m.id === msDetailMatch[2]);
    if (!ms) { res.writeHead(404); res.end(JSON.stringify({ error: "Milestone not found" })); return true; }
    if (body.name !== undefined) ms.name = body.name;
    if (body.status !== undefined) ms.status = body.status;
    if (body.note !== undefined) ms.note = body.note;
    if (body.date !== undefined) ms.date = body.date;
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, milestone: ms }));
    return true;
  }

  if (msDetailMatch && method === "DELETE") {
    const project = await loadProject(msDetailMatch[1]);
    if (!project) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    project.milestones = (project.milestones || []).filter(m => m.id !== msDetailMatch[2]);
    project.updatedAt = new Date().toISOString();
    await saveProject(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}

export default handleProjectRoutes;

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const DATA_DIR = resolve(PAAW_ROOT, "data/projects");

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

// ── Default PAAW Project ──

async function ensureDefaultProject() {
  await ensureDataDir();
  const paawFile = resolve(DATA_DIR, "paaw.json");
  if (existsSync(paawFile)) return;

  const paawProject = {
    id: "paaw",
    name: "PAAW — Personal AI Assistant Workspace",
    icon: "🐾",
    description: "Build your personal AI workforce. 人用 AI 自己做工具 → AI 幫你記資料 → AI 放大你記的資料 → 形成能力飛輪。",
    status: "in-progress",
    startDate: "2026-01-01",
    targetDate: "2026-12-31",
    repo: "https://github.com/LoveFleming/tAgent",
    dashboard: "",
    categories: [
      {
        id: "infrastructure",
        name: "基礎設施",
        icon: "🏗️",
        description: "LLM retry、路徑系統、安全防護、備份還原",
        tasks: [
          { id: genId("t"), name: "LLM API 重試/清理/驗證", status: "done", priority: "high", start: "2026-02-01", end: "2026-02-15" },
          { id: genId("t"), name: "絕對路徑系統 ({{PAAW_ROOT}})", status: "done", priority: "high", start: "2026-02-10", end: "2026-02-28" },
          { id: genId("t"), name: "多 Provider fallback chain", status: "done", priority: "high", start: "2026-03-01", end: "2026-03-10" },
          { id: genId("t"), name: "Backup/Restore 系統 (跨平台)", status: "done", priority: "high", start: "2026-06-15", end: "2026-06-25" },
          { id: genId("t"), name: "Security Kernel (approval + audit)", status: "progress", priority: "medium", start: "2026-06-20", end: "2026-07-15" },
        ],
      },
      {
        id: "skill-system",
        name: "Skill 系統",
        icon: "🔨",
        description: "技能定義、Skill Builder、測試執行",
        tasks: [
          { id: genId("t"), name: "Skill 格式標準化 (schema)", status: "done", priority: "high", start: "2026-03-01", end: "2026-03-15" },
          { id: genId("t"), name: "Skill Builder (AI 建構技能)", status: "done", priority: "high", start: "2026-03-15", end: "2026-04-30" },
          { id: genId("t"), name: "Skill 測試沙盒 + timeout", status: "done", priority: "medium", start: "2026-05-01", end: "2026-05-15" },
          { id: genId("t"), name: "Skill 輸出模式 (file/display/both)", status: "done", priority: "medium", start: "2026-06-10", end: "2026-06-18" },
          { id: genId("t"), name: "Skill 版本管理", status: "todo", priority: "low", start: "", end: "" },
        ],
      },
      {
        id: "app-system",
        name: "App 系統",
        icon: "📱",
        description: "App Builder、自動註冊為 Chat Tool、雙入口",
        tasks: [
          { id: genId("t"), name: "App Builder (AI 建構 App)", status: "done", priority: "high", start: "2026-04-01", end: "2026-04-30" },
          { id: genId("t"), name: "App 自動註冊為 Chat Tool", status: "done", priority: "high", start: "2026-05-01", end: "2026-05-15" },
          { id: genId("t"), name: "雙入口：聊天 + App 視窗", status: "done", priority: "high", start: "2026-05-15", end: "2026-06-01" },
          { id: genId("t"), name: "App 資料 = AI 記憶", status: "progress", priority: "high", start: "2026-06-20", end: "2026-07-30" },
          { id: genId("t"), name: "觸發關鍵字自動路由", status: "todo", priority: "medium", start: "", end: "" },
        ],
      },
      {
        id: "chat-assistant",
        name: "聊天助理",
        icon: "💬",
        description: "Context Engine、Tool Engine、串流回應",
        tasks: [
          { id: genId("t"), name: "Context Engine (per-message)", status: "done", priority: "high", start: "2026-03-10", end: "2026-03-25" },
          { id: genId("t"), name: "Tool Engine (ReAct loop)", status: "done", priority: "high", start: "2026-03-25", end: "2026-04-10" },
          { id: genId("t"), name: "串流回應 (SSE)", status: "done", priority: "high", start: "2026-04-10", end: "2026-04-25" },
          { id: genId("t"), name: "聊天工具整合", status: "done", priority: "medium", start: "2026-06-20", end: "2026-06-28" },
          { id: genId("t"), name: "Deep Link 機制", status: "done", priority: "medium", start: "2026-06-25", end: "2026-06-27" },
        ],
      },
      {
        id: "builtin-apps",
        name: "內建應用",
        icon: "📦",
        description: "Notes、Mind Map、Briefing Player、Vibe Coding IDE",
        tasks: [
          { id: genId("t"), name: "Notes 筆記系統 (OneNote 式)", status: "done", priority: "high", start: "2026-06-20", end: "2026-06-27" },
          { id: genId("t"), name: "Mind Map Viewer (markmap)", status: "done", priority: "medium", start: "2026-06-15", end: "2026-06-22" },
          { id: genId("t"), name: "Briefing Player", status: "done", priority: "low", start: "2026-05-20", end: "2026-05-30" },
          { id: genId("t"), name: "Vibe Coding IDE", status: "done", priority: "high", start: "2026-05-25", end: "2026-06-20" },
          { id: genId("t"), name: "Project Board (專案看板)", status: "progress", priority: "high", start: "2026-06-27", end: "2026-06-30" },
          { id: genId("t"), name: "Gantt Chart 甘特圖", status: "progress", priority: "medium", start: "2026-06-28", end: "2026-07-05" },
        ],
      },
      {
        id: "ai-intelligence",
        name: "AI 智慧層",
        icon: "🧠",
        description: "AI 蒸餾、知識庫、自動學習",
        tasks: [
          { id: genId("t"), name: "AI 蒸餾系統", status: "done", priority: "medium", start: "2026-04-15", end: "2026-05-15" },
          { id: genId("t"), name: "Knowledge 知識庫管理", status: "done", priority: "medium", start: "2026-05-15", end: "2026-05-30" },
          { id: genId("t"), name: "自動蒸餾排程", status: "done", priority: "low", start: "2026-05-30", end: "2026-06-05" },
          { id: genId("t"), name: "AI 寫筆記", status: "done", priority: "medium", start: "2026-06-25", end: "2026-06-28" },
        ],
      },
      {
        id: "ui-ux",
        name: "UI/UX",
        icon: "🎨",
        description: "主題系統、響應式設計、VibeCodingIDE 風格",
        tasks: [
          { id: genId("t"), name: "7 種主題色系統", status: "done", priority: "medium", start: "2026-04-01", end: "2026-04-15" },
          { id: genId("t"), name: "tk token 系統", status: "done", priority: "medium", start: "2026-06-20", end: "2026-06-25" },
          { id: genId("t"), name: "i18n 多語系", status: "done", priority: "low", start: "2026-05-10", end: "2026-05-20" },
          { id: genId("t"), name: "VibeCodingIDE 邊框優化", status: "done", priority: "low", start: "2026-06-26", end: "2026-06-27" },
        ],
      },
      {
        id: "operations",
        name: "營運與部署",
        icon: "🚀",
        description: "Cron 排程、系統設定、部署流程",
        tasks: [
          { id: genId("t"), name: "Cron Job 系統", status: "done", priority: "medium", start: "2026-05-01", end: "2026-05-15" },
          { id: genId("t"), name: "設定頁 (Provider/Skill/Backup)", status: "done", priority: "medium", start: "2026-05-15", end: "2026-06-01" },
          { id: genId("t"), name: "Vercel 靜態部署", status: "done", priority: "low", start: "2026-04-20", end: "2026-05-01" },
          { id: genId("t"), name: "Windows 跨平台相容", status: "done", priority: "medium", start: "2026-06-10", end: "2026-06-20" },
          { id: genId("t"), name: "Docker 容器化部署", status: "todo", priority: "low", start: "", end: "" },
        ],
      },
    ],
    milestones: [
      { id: genId("m"), name: "PAAW v0.1 — 核心框架", status: "done", note: "Skill + App + Chat 基礎架構", date: "2026-03" },
      { id: genId("m"), name: "PAAW v0.5 — 雙入口 + 工具生態", status: "done", note: "聊天視窗 + App 視窗都能用", date: "2026-05" },
      { id: genId("m"), name: "PAAW v0.8 — 內建應用套件", status: "done", note: "Notes + Mind Map + Vibe Coding IDE", date: "2026-06" },
      { id: genId("m"), name: "PAAW v1.0 — 正式發布", status: "progress", note: "Project Board + Gantt + 安裝包", date: "2026-09" },
      { id: genId("m"), name: "PAAW v1.5 — Plugin Marketplace", status: "todo", note: "第三方技能/App 市集", date: "2026-12" },
      { id: genId("m"), name: "PAAW v2.0 — Multi-user", status: "todo", note: "多人協作 + 權限管理", date: "2027-Q1" },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(paawFile, JSON.stringify(paawProject, null, 2), "utf-8");
  console.log("[Projects] Default PAAW project created");
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

  // Ensure default project exists
  await ensureDefaultProject();

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
    if (id === "paaw") {
      res.writeHead(403); res.end(JSON.stringify({ error: "Cannot delete default project" })); return true;
    }
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

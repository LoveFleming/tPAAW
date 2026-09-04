/**
 * Coding Tasks Route — Feature-first 任務模型（2026-09-01 Fleming 定調簡化）
 *
 * Task = 掛在 feature 下的最小工作單位。沒有 pipeline、沒有 mini/full loop 語意。
 *   status: open | close | pending | ignore
 *     open    — 派工候選（唯一會被自動派工挑走的狀態）
 *     pending — 暫停中（執行中 / 失敗等人處理 / 等外部）
 *     close   — 完成
 *     ignore  — 永不處理
 *   type:   dev | test | docs
 *   featureId 必填（雜項掛 Utility & Platform Misc）
 *
 * Loop mode（mini/full）與 EM cron 只是「觸發器」設定 — 決定何時派工，不再影響 task 結構。
 *
 * Endpoints:
 *   GET    /api/coding-tasks?path=...              — List tasks (filter: status, type, featureId, priority, assignee, parentId, search)
 *   GET    /api/coding-tasks/stats?path=...        — Summary stats（4 status + byType + byAssignee）
 *   GET    /api/coding-tasks/:id?path=...          — Get single task
 *   POST   /api/coding-tasks?path=...              — Create task（title + featureId + type 必填）
 *   PUT    /api/coding-tasks/:id?path=...          — Update task
 *   DELETE /api/coding-tasks/:id?path=...          — Delete task（+ abort running agent）
 *   POST   /api/coding-tasks/decompose?path=...    — Decompose into sub-tasks
 *   POST   /api/coding-tasks/:id/notes?path=...    — Add note
 *   GET    /api/coding-tasks/:id/git/diff          — Get task diff
 *   POST   /api/coding-tasks/:id/git/stage         — Git add task files
 *   POST   /api/coding-tasks/:id/git/commit        — Git commit + push（成功 → task close）
 *   POST   /api/coding-tasks/:id/git/restore       — Restore task files
 *   POST   /api/coding-tasks/:id/dispatch          — 派工（assignee + status pending）
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";
import { TaskGit } from "../lib/task-git.mjs";
import { buildReviewBoundary } from "../lib/review-boundary.mjs";
import { featureExists, touchFeature } from "../lib/feature-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 常數 ──

export const TASK_STATUSES = ["open", "close", "pending", "ignore"];
export const TASK_TYPES = ["dev", "test", "docs"];

// ── 舊資料正規化 ──

export function normalizeStatus(s) {
  const st = String(s || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (st === "open" || st === "todo") return "open";
  if (["in_progress", "review", "testing", "pending", "awaiting_human"].includes(st)) return "pending";
  if (["done", "completed", "resolved", "closed"].includes(st)) return "close";
  if (["skipped", "wontfix", "ignore"].includes(st)) return "ignore";
  return "open";
}

export function normalizeType(t) {
  const ty = String(t || "").toLowerCase();
  if (ty === "test" || ty === "testing") return "test";
  if (ty === "docs" || ty === "doc" || ty === "documentation") return "docs";
  return "dev"; // feature/bugfix/refactor/bug/security/requirement/chore/health → dev
}

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

// ── Task Storage（讀取時正規化 + 剝除 pipeline 舊欄位）──

async function loadTasksAndConfig(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  let tasks = [];
  let config = { loopMode: "mini" };
  if (existsSync(tasksFile)) {
    try {
      const data = JSON.parse(await readFile(tasksFile, "utf-8"));
      if (Array.isArray(data.tasks)) {
        tasks = data.tasks.map(t => ({
          id: t.id || "",
          featureId: t.featureId || null,
          type: normalizeType(t.type),
          title: t.title || "",
          parentId: t.parentId || null,
          status: normalizeStatus(t.status),
          priority: t.priority || "medium",
          labels: Array.isArray(t.labels) ? t.labels : [],
          assignee: t.assignee || null,
          description: t.description || "",
          relatedFiles: Array.isArray(t.relatedFiles) ? t.relatedFiles : [],
          notes: Array.isArray(t.notes) ? t.notes : [],
          result: t.result || t.executionResult?.summary || null,
          git: t.git || null,
          timeoutSeconds: t.timeoutSeconds || 0,
          createdAt: t.createdAt || now(),
          updatedAt: t.updatedAt || now(),
          resolvedAt: t.resolvedAt || null,
          createdBy: t.createdBy || "agent",
          source: t.source || null,
          spec: t.spec || null,
          reviewBoundary: t.reviewBoundary || null,
        }));
      }
      if (data.loopMode) config.loopMode = data.loopMode;
    } catch { /* empty */ }
  }
  return { tasks, config };
}

async function loadTasks(projectPath) {
  const { tasks } = await loadTasksAndConfig(projectPath);
  return tasks;
}

async function saveTasks(projectPath, tasks, config) {
  const tasksDir = join(projectPath, ".paaw", "tasks");
  if (!existsSync(tasksDir)) await mkdir(tasksDir, { recursive: true });
  const tasksFile = join(tasksDir, "TASKS.json");
  const output = { tasks, updatedAt: now() };
  if (config?.loopMode) output.loopMode = config.loopMode;
  await writeFile(tasksFile, JSON.stringify(output, null, 2), "utf-8");
  // task 結案 → touch feature updatedAt（UI by updatedAt 排序反映活動）
  for (const t of tasks) {
    if (t.status === "close" && t.featureId) {
      try { touchFeature(projectPath, t.featureId, t.updatedAt || now()); } catch {}
    }
  }
  // R4: task 變動 → debounced handover state 刷新
  import("../lib/release-unit/handover-state.mjs").then(m => m.scheduleHandoverRefresh(projectPath)).catch(() => {});
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

  // ════════════════════════════════════════════════
  // STATIC ROUTES (must come before /:id routes)
  // ════════════════════════════════════════════════

  // ── GET /api/coding-tasks/stats ──
  if (url === "/api/coding-tasks/stats" && method === "GET") {
    const { tasks } = await loadTasksAndConfig(projRoot);
    const stats = {
      total: tasks.length,
      open: tasks.filter(t => t.status === "open").length,
      pending: tasks.filter(t => t.status === "pending").length,
      close: tasks.filter(t => t.status === "close").length,
      ignore: tasks.filter(t => t.status === "ignore").length,
      byPriority: {
        critical: tasks.filter(t => t.priority === "critical").length,
        high: tasks.filter(t => t.priority === "high").length,
        medium: tasks.filter(t => t.priority === "medium").length,
        low: tasks.filter(t => t.priority === "low").length,
      },
      byType: {
        dev: tasks.filter(t => t.type === "dev").length,
        test: tasks.filter(t => t.type === "test").length,
        docs: tasks.filter(t => t.type === "docs").length,
      },
      byAssignee: {},
    };
    for (const t of tasks) {
      const a = t.assignee || "unassigned";
      if (!stats.byAssignee[a]) stats.byAssignee[a] = { total: 0, open: 0, close: 0 };
      stats.byAssignee[a].total++;
      if (t.status === "open") stats.byAssignee[a].open++;
      if (t.status === "close") stats.byAssignee[a].close++;
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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Task ${parentId} not found` }));
      return true;
    }
    const created = [];
    for (const sub of subTasks) {
      if (!sub.title?.trim()) continue;
      const ts = now();
      created.push({
        id: genId(tasks.concat(created)),
        featureId: sub.featureId || parent.featureId || null,
        type: normalizeType(sub.type || parent.type),
        title: sub.title.trim(),
        parentId,
        status: "open",
        priority: sub.priority || parent.priority,
        labels: sub.labels || parent.labels || [],
        assignee: sub.assignee || null,
        description: sub.description || "",
        relatedFiles: sub.relatedFiles || [],
        notes: [],
        result: null,
        git: null,
        timeoutSeconds: 0,
        createdAt: ts,
        updatedAt: ts,
        resolvedAt: null,
        createdBy: body.createdBy || "agent",
        source: sub.source || parent.source || null,
      });
    }
    if (!Array.isArray(parent.notes)) parent.notes = [];
    parent.notes.push({
      by: body.createdBy || "agent",
      at: now(),
      content: `拆分為 ${created.length} 個子任務：${created.map(s => s.id).join(", ")}`,
    });
    parent.updatedAt = now();

    const all = [...tasks, ...created];
    await saveTasks(projRoot, all, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ parentId, subTasks: created, total: all.length }));
    return true;
  }

  // ════════════════════════════════════════════════
  // /:id ROUTES
  // ════════════════════════════════════════════════

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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    if (!Array.isArray(tasks[idx].notes)) tasks[idx].notes = [];
    tasks[idx].notes.push({ by: body.by || "user", at: now(), content: body.content.trim() });
    tasks[idx].updatedAt = now();
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tasks[idx]));
    return true;
  }

  // ── :id/git/diff ──
  const gitDiffMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/git\/diff$/);
  if (gitDiffMatch && method === "GET") {
    const id = decodeURIComponent(gitDiffMatch[1]);
    const { tasks } = await loadTasksAndConfig(projRoot);
    const task = tasks.find(t => t.id === id);
    if (!task) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const git = new TaskGit(projRoot);
    const diff = await git.getDiff(task);
    const headSha = await git.getHeadSha();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, diff, headSha }));
    return true;
  }

  // ── :id/git/stage ──
  const gitStageMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/git\/stage$/);
  if (gitStageMatch && method === "POST") {
    const id = decodeURIComponent(gitStageMatch[1]);
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const git = new TaskGit(projRoot);
    const result = await git.stage(tasks[idx]);
    tasks[idx].git = { ...tasks[idx].git, staged: result.staged, stagedAt: now() };
    tasks[idx].updatedAt = now();
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, ...result }));
    return true;
  }

  // ── :id/git/commit ──（成功 → task close）
  const gitCommitMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/git\/commit$/);
  if (gitCommitMatch && method === "POST") {
    const id = decodeURIComponent(gitCommitMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const task = tasks[idx];
    const git = new TaskGit(projRoot);
    const message = body.message || TaskGit.generateCommitMessage(task);
    const result = await git.commit(task, message, body.push !== false);
    task.git = {
      ...task.git,
      commitSha: result.sha,
      backupBranch: result.backupBranch,
      pushed: result.pushed,
      committedAt: now(),
    };
    // Review Boundary（R1）：commit 後比對 fileScope vs 實際 diff → expected/unexpected
    try {
      task.reviewBoundary = await buildReviewBoundary(projRoot, task);
    } catch (e) {
      console.error("[coding-tasks] review boundary failed:", e.message);
    }
    // Commit 成功 = task 完成
    task.status = "close";
    if (!task.resolvedAt) task.resolvedAt = now();
    task.updatedAt = now();
    // Commit 後自動重掃 CU 機械層 + 重建 RU Model（fire-and-forget）
    import("../lib/cu-mechanical.mjs").then(m => m.rescanMechanicalLayer(projRoot)).catch(() => {});
    import("../lib/release-unit/model.mjs").then(m => m.buildReleaseUnitModel(projRoot)).catch(() => {});
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, ...result, message }));
    return true;
  }

  // ── :id/git/restore ──
  const gitRestoreMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/git\/restore$/);
  if (gitRestoreMatch && method === "POST") {
    const id = decodeURIComponent(gitRestoreMatch[1]);
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const git = new TaskGit(projRoot);
    const result = await git.restore(tasks[idx]);
    tasks[idx].updatedAt = now();
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, ...result }));
    return true;
  }

  // ── :id/dispatch — 派工：assignee + status pending ──
  const dispatchMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/dispatch$/);
  if (dispatchMatch && method === "POST") {
    const id = decodeURIComponent(dispatchMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const task = tasks[idx];
    task.assignee = body.agent || body.assignee || body.by || "developer";
    task.status = "pending";
    task.updatedAt = now();
    if (!Array.isArray(task.notes)) task.notes = [];
    task.notes.push({
      by: body.by || "dispatch",
      at: now(),
      content: body.instructions
        ? `派工給 **${task.assignee}**：${body.instructions}`
        : body.note || `派工給 ${task.assignee}`,
    });
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // ── GET /api/coding-tasks/:id ──
  const singleMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const id = decodeURIComponent(singleMatch[1]);
    const { tasks } = await loadTasksAndConfig(projRoot);
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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const existing = tasks[idx];
    // 驗證
    if (body.status !== undefined && !TASK_STATUSES.includes(body.status)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `status must be one of: ${TASK_STATUSES.join(", ")}` }));
      return true;
    }
    if (body.type !== undefined && !TASK_TYPES.includes(normalizeType(body.type))) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `type must be one of: ${TASK_TYPES.join(", ")}` }));
      return true;
    }
    if (body.featureId !== undefined && body.featureId && !featureExists(projRoot, body.featureId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `featureId '${body.featureId}' not found in FEATURES.json` }));
      return true;
    }
    const updated = {
      ...existing,
      ...(body.featureId !== undefined ? { featureId: body.featureId } : {}),
      ...(body.type !== undefined ? { type: normalizeType(body.type) } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
      ...(body.result !== undefined ? { result: body.result } : {}),
      ...(Array.isArray(body.relatedFiles) ? { relatedFiles: body.relatedFiles } : {}),
      ...(Array.isArray(body.labels) ? { labels: body.labels } : {}),
      id: existing.id, // never overwrite ID
      updatedAt: now(),
    };
    if (body.status !== undefined) {
      updated.status = body.status;
      if (body.status === "close" && !updated.resolvedAt) updated.resolvedAt = now();
      if (body.status === "open" || body.status === "pending") updated.resolvedAt = null;
    }
    tasks[idx] = updated;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(updated));
    return true;
  }

  // ── DELETE /api/coding-tasks/:id (also aborts running agent) ──
  if (singleMatch && method === "DELETE") {
    const id = decodeURIComponent(singleMatch[1]);
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const deleted = tasks.splice(idx, 1)[0];
    // Also delete sub-tasks if this is a parent
    if (!deleted.parentId) {
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].parentId === id) tasks.splice(i, 1);
      }
    }
    // Try to abort running agent
    try {
      const { runningCodingAgents } = await import("../lib/running-agents.mjs");
      const agentId = deleted.assignee;
      if (agentId && runningCodingAgents.has(agentId)) {
        const entry = runningCodingAgents.get(agentId);
        entry?.abortController?.abort();
        runningCodingAgents.delete(agentId);
      }
    } catch {}
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return true;
  }

  // ════════════════════════════════════════════════
  // LIST & CREATE (catch-all for /api/coding-tasks)
  // ════════════════════════════════════════════════

  // ── GET /api/coding-tasks (list) ──
  if (url === "/api/coding-tasks" && method === "GET") {
    const { tasks: allTasks, config } = await loadTasksAndConfig(projRoot);
    let tasks = allTasks;
    if (q.status) { const s = q.status.split(","); tasks = tasks.filter(t => s.includes(t.status)); }
    if (q.priority) { const s = q.priority.split(","); tasks = tasks.filter(t => s.includes(t.priority)); }
    if (q.type) { const s = q.type.split(",").map(normalizeType); tasks = tasks.filter(t => s.includes(t.type)); }
    if (q.assignee) { const s = q.assignee.split(","); tasks = tasks.filter(t => s.includes(t.assignee || "unassigned")); }
    if (q.parentId) { tasks = tasks.filter(t => t.parentId === q.parentId); }
    if (q.featureId) { tasks = tasks.filter(t => t.featureId === q.featureId); }
    if (q.search) {
      const s = q.search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title?.toLowerCase().includes(s) ||
        t.description?.toLowerCase().includes(s) ||
        t.id?.toLowerCase().includes(s)
      );
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusOrder = { open: 0, pending: 1, close: 2, ignore: 3 };
    tasks.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tasks, projectLoopMode: config.loopMode }));
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
    if (!body.featureId?.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "featureId is required（一切以 feature 為主 — 雜項掛 Utility & Platform Misc）" }));
      return true;
    }
    const type = normalizeType(body.type);
    if (body.type && !TASK_TYPES.includes(type)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `type must be one of: ${TASK_TYPES.join(", ")}` }));
      return true;
    }
    if (!featureExists(projRoot, body.featureId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `featureId '${body.featureId}' not found in FEATURES.json` }));
      return true;
    }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const ts = now();
    const newTask = {
      id: genId(tasks),
      featureId: body.featureId.trim(),
      type,
      title: body.title.trim(),
      parentId: body.parentId || null,
      status: "open",
      priority: body.priority || "medium",
      labels: body.labels || [],
      assignee: body.assignee || null,
      description: body.description || "",
      relatedFiles: body.relatedFiles || [],
      notes: [],
      result: null,
      git: null,
      timeoutSeconds: body.timeoutSeconds || 0,
      spec: body.spec || null,
      createdAt: ts,
      updatedAt: ts,
      resolvedAt: null,
      createdBy: body.createdBy || "user",
      source: body.source || null,
    };
    tasks.push(newTask);
    await saveTasks(projRoot, tasks, config);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newTask));
    return true;
  }

  return false;
}

/**
 * Coding Tasks Route — Task management for .paaw/ projects
 *
 * Tasks = actionable work items (派工、執行、追蹤)
 * Issues = problem/requirement records (記錄、分類、追蹤)
 *
 * Endpoints:
 *   GET    /api/coding-tasks?path=...                       — List tasks (filter: status, type, priority, assignee, parentId, pipeline)
 *   GET    /api/coding-tasks/stats?path=...                 — Summary stats
 *   GET    /api/coding-tasks/pipeline/overview?path=...     — Pipeline summary for all tasks
 *   GET    /api/coding-tasks/overnight-queue?path=...       — Tonight's overnight queue
 *   GET    /api/coding-tasks/overnight-queue/results?path=... — Last overnight results
 *   GET    /api/coding-tasks/:id?path=...                   — Get single task (ensurePipeline applied)
 *   POST   /api/coding-tasks?path=...                       — Create task
 *   PUT    /api/coding-tasks/:id?path=...                   — Update task
 *   DELETE /api/coding-tasks/:id?path=...                   — Delete task
 *   POST   /api/coding-tasks/decompose?path=...             — Decompose into sub-tasks
 *   POST   /api/coding-tasks/:id/notes?path=...             — Add note
 *   POST   /api/coding-tasks/:id/pipeline/advance?path=...  — Advance a pipeline phase
 *   POST   /api/coding-tasks/:id/pipeline/reject?path=...   — Reject/return a pipeline phase
 *   GET    /api/coding-tasks/:id/git/diff?path=...          — Get task diff
 *   POST   /api/coding-tasks/:id/git/stage?path=...         — Git add task files
 *   POST   /api/coding-tasks/:id/git/commit?path=...        — Git commit + optional push
 *   POST   /api/coding-tasks/:id/git/restore?path=...       — Restore task files
 *   POST   /api/coding-tasks/:id/dispatch?path=...          — EM dispatch
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { PassThrough } from "stream";
import { readBody } from "./shared.mjs";
import { TaskGit } from "../lib/task-git.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

// ── Pipeline Constants ──

const PIPELINE_PHASES = ["spec", "implement", "review", "test", "qa", "docs", "commit"];

// ── Mini Loop phases — 人是 QA，只走 implement → commit ──
const MINI_LOOP_PHASES = ["implement", "commit"];

// ── Loop mode → active phases mapping ──
const LOOP_MODE_PHASES = {
  full: PIPELINE_PHASES,
  mini: MINI_LOOP_PHASES,
};

// ── Project Phase → Loop Mode 對應表 ──
const PHASE_TO_LOOP_MODE = {
  bootstrap: "mini",
  mvp: "mini",
  growth: "mini",
  stable: "full",
  refactor: "full",
};

function loopModeFromProjectPhase(projectPhase) {
  return PHASE_TO_LOOP_MODE[projectPhase] || "mini";
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

// ── Pipeline Helpers ──

function ensurePipeline(task, projectConfig) {
  const loopMode = getEffectiveLoopMode(task, projectConfig);
  const activePhases = LOOP_MODE_PHASES[loopMode] || PIPELINE_PHASES;

  if (!task.pipeline) {
    const isDone = task.status === "resolved" || task.status === "closed";
    task.pipeline = {};
    for (const phase of PIPELINE_PHASES) {
      if (!activePhases.includes(phase)) {
        // Skip phase — mark as done/skipped
        task.pipeline[phase] = { status: "done", by: "system", reason: `skipped (${loopMode} loop)` };
      } else if (isDone) {
        task.pipeline[phase] = { status: "done", by: "unknown" };
      } else if (phase === "implement" && task.status === "in-progress") {
        task.pipeline[phase] = { status: "done", by: "unknown" };
      } else {
        task.pipeline[phase] = { status: "pending" };
      }
    }
  }
  // Ensure all phases exist
  for (const phase of PIPELINE_PHASES) {
    if (!task.pipeline[phase]) {
      if (!activePhases.includes(phase)) {
        task.pipeline[phase] = { status: "done", by: "system", reason: `skipped (${loopMode} loop)` };
      } else {
        task.pipeline[phase] = { status: "pending" };
      }
    }
  }
  return task;
}

function getActivePhases(task, projectConfig) {
  const loopMode = getEffectiveLoopMode(task, projectConfig);
  return LOOP_MODE_PHASES[loopMode] || PIPELINE_PHASES;
}

function deriveStatus(task, projectConfig) {
  const p = task.pipeline;
  if (!p) return task.status || "open";
  if (p.commit?.status === "done") return "resolved";
  const activePhases = getActivePhases(task, projectConfig);
  for (const phase of activePhases) {
    if (p[phase]?.status === "in_progress") return "in-progress";
    if (p[phase]?.status === "failed" || p[phase]?.status === "needs_human" || p[phase]?.status === "awaiting_human" || p[phase]?.status === "rework") return "in-progress";
    if (p[phase]?.status === "pending") return "in-progress";
  }
  if (p.spec?.status === "pending") return "open";
  return task.status || "open";
}

// ── Task Storage ──

async function loadTasksAndConfig(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  let tasks = [];
  let config = { loopMode: "mini" }; // default: mini for new projects
  if (existsSync(tasksFile)) {
    try {
      const data = JSON.parse(await readFile(tasksFile, "utf-8"));
      if (Array.isArray(data.tasks)) {
        tasks = data.tasks.map(t => {
          const mapped = {
            id: t.id || "",
            title: t.title || "",
            type: t.type || "feature",
            parentId: t.parentId || null,
            linkedIssueId: t.linkedIssueId || null,
            status: t.status || "open",
            priority: t.priority || "medium",
            effort: t.effort || null,
            labels: Array.isArray(t.labels) ? t.labels : [],
            assignee: t.assignee || null,
            description: t.description || "",
            relatedFiles: Array.isArray(t.relatedFiles) ? t.relatedFiles : [],
            notes: Array.isArray(t.notes) ? t.notes : [],
            executionResult: t.executionResult || null,
            timeoutSeconds: t.timeoutSeconds || 0,
            createdAt: t.createdAt || now(),
            updatedAt: t.updatedAt || now(),
            resolvedAt: t.resolvedAt || null,
            createdBy: t.createdBy || "agent",
            pipeline: t.pipeline || null,
            loopModeOverride: t.loopModeOverride || t.loopMode || null, // backward compat
            source: t.source || null,
            spec: t.spec || null,
            changes: t.changes || null,
            git: t.git || null,
            testResult: t.testResult || null,
            qaResult: t.qaResult || null,
            overnight: t.overnight || null,
          };
          return ensurePipeline(mapped, config);
        });
      }
      // Project-level config from TASKS.json top-level
      if (data.loopMode) config.loopMode = data.loopMode;
    } catch { /* empty */ }
  }
  return { tasks, config };
}

// Backward compat: loadTasks returns just the array
async function loadTasks(projectPath) {
  const { tasks } = await loadTasksAndConfig(projectPath);
  return tasks;
}

function getEffectiveLoopMode(task, projectConfig) {
  // Health tasks always use mini loop (implement → commit)
  if (task.type === "health") return "mini";
  return task.loopModeOverride || projectConfig?.loopMode || "mini";
}

async function saveTasks(projectPath, tasks, config) {
  const tasksDir = join(projectPath, ".paaw", "tasks");
  if (!existsSync(tasksDir)) await mkdir(tasksDir, { recursive: true });
  const tasksFile = join(tasksDir, "TASKS.json");
  const output = { tasks, updatedAt: now() };
  if (config?.loopMode) output.loopMode = config.loopMode;
  await writeFile(tasksFile, JSON.stringify(output, null, 2), "utf-8");
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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
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
      pipelineDistribution: {},
    };
    for (const t of tasks) {
      const a = t.assignee || "unassigned";
      if (!stats.byAssignee[a]) stats.byAssignee[a] = { total: 0, open: 0, resolved: 0 };
      stats.byAssignee[a].total++;
      if (t.status === "open" || t.status === "in-progress") stats.byAssignee[a].open++;
      if (t.status === "resolved" || t.status === "closed") stats.byAssignee[a].resolved++;
    }
    // Pipeline distribution
    for (const t of tasks) {
      for (const phase of PIPELINE_PHASES) {
        const ph = t.pipeline?.[phase];
        if (ph) {
          const key = `${phase}:${ph.status}`;
          stats.pipelineDistribution[key] = (stats.pipelineDistribution[key] || 0) + 1;
        }
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stats));
    return true;
  }

  // ── GET /api/coding-tasks/pipeline/overview ──
  if (url === "/api/coding-tasks/pipeline/overview" && method === "GET") {
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const overview = {
      total: tasks.length,
      projectLoopMode: config.loopMode,
      phases: {},
      phaseOrder: PIPELINE_PHASES,
    };
    for (const phase of PIPELINE_PHASES) {
      overview.phases[phase] = {
        pending: 0,
        in_progress: 0,
        done: 0,
        failed: 0,
        needs_human: 0,
        skipped: 0,
      };
    }
    for (const t of tasks) {
      for (const phase of PIPELINE_PHASES) {
        const ph = t.pipeline?.[phase];
        if (ph && overview.phases[phase]) {
          const st = ph.status || "pending";
          if (overview.phases[phase][st] !== undefined) {
            overview.phases[phase][st]++;
          }
        }
      }
    }
    // Summary: how many tasks fully complete
    overview.completed = tasks.filter(t => t.pipeline?.commit?.status === "done").length;
    overview.inPipeline = tasks.filter(t => {
      const p = t.pipeline;
      if (!p) return false;
      if (p.commit?.status === "done") return false;
      return PIPELINE_PHASES.some(ph => {
        const st = p[ph]?.status;
        return st === "in_progress" || st === "pending" || st === "failed" || st === "needs_human";
      });
    }).length;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(overview));
    return true;
  }

  // ── GET /api/coding-tasks/overnight-queue ──
  if (url === "/api/coding-tasks/overnight-queue" && method === "GET") {
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    // Tasks that are ready for overnight processing:
    // - spec is done, implement is pending or in_progress
    // - not yet fully resolved
    const queue = tasks.filter(t => {
      const p = t.pipeline;
      if (!p) return false;
      if (p.commit?.status === "done") return false;
      // Spec must be done
      if (p.spec?.status !== "done") return false;
      // At least one remaining phase is pending or in_progress
      const remaining = ["implement", "review", "test", "qa", "docs", "commit"];
      return remaining.some(ph => {
        const st = p[ph]?.status;
        return st === "pending" || st === "in_progress" || st === "failed";
      });
    });
    // Group by current phase
    const grouped = {};
    for (const phase of PIPELINE_PHASES) {
      grouped[phase] = queue.filter(t => {
        const statuses = PIPELINE_PHASES;
        // Find the first phase that isn't done
        for (const ph of statuses) {
          const st = t.pipeline[ph]?.status;
          if (st !== "done" && st !== "skipped") {
            return ph === phase;
          }
        }
        return false;
      });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      total: queue.length,
      byCurrentPhase: grouped,
      tasks: queue,
    }));
    return true;
  }

  // ── GET /api/coding-tasks/overnight-queue/results ──
  if (url === "/api/coding-tasks/overnight-queue/results" && method === "GET") {
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    // Find tasks with overnight results (overnight field exists with results)
    const results = tasks.filter(t => t.overnight && (t.overnight.lastRun || t.overnight.result));
    const summary = {
      total: results.length,
      succeeded: results.filter(t => t.overnight?.result === "success").length,
      failed: results.filter(t => t.overnight?.result === "failed").length,
      partial: results.filter(t => t.overnight?.result === "partial").length,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      summary,
      tasks: results.map(t => ({
        id: t.id,
        title: t.title,
        overnight: t.overnight,
        pipeline: t.pipeline,
      })),
    }));
    return true;
  }

  // ── POST /api/coding-tasks/health-fix ──
  // Create an execution plan from fixPlan (not coding tasks)
  if (url === "/api/coding-tasks/health-fix" && method === "POST") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { title, description, fixPlan, source } = body;
    if (!fixPlan?.steps || !Array.isArray(fixPlan.steps) || fixPlan.steps.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fixPlan.steps[] is required" }));
      return true;
    }

    try {
      const { createPlan, markPlanStarted, updateSubTask } = await import("../lib/execution-plan.mjs");

      // Build items for createPlan
      // Each fixPlan.step = one task with one subtask
      const items = fixPlan.steps.map((step, i) => ({
        title: step.task?.trim() || step.title?.trim() || `Fix step ${i + 1}`,
        assignee: step.agent || "developer",
        source: "code_health",
        sourceRef: source || "health-scan",
        priority: "medium",
        subtasks: [{
          title: step.task?.trim() || `Fix step ${i + 1}`,
          assignee: step.agent || "developer",
        }],
      }));

      const plan = await createPlan({
        projectPath: projRoot,
        projectPhase: "health",
        mode: "health-fix",
        items,
      });

      // Mark as started immediately
      await markPlanStarted(projRoot, plan.planId);

      // Auto-dispatch: trigger first subtask in background
      setImmediate(async () => {
        try {
          await runHealthPlanSubtask(projRoot, plan.planId);
        } catch (e) {
          console.error("[health-fix] auto-dispatch error:", e.message);
        }
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, planId: plan.planId, totalSubtasks: plan.summary.totalSubtasks, status: plan.status }));
    } catch (e) {
      console.error("[health-fix] createPlan error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
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
      const newSub = ensurePipeline({
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
        createdAt: ts,
        updatedAt: ts,
        resolvedAt: null,
        createdBy: body.createdBy || "agent",
        source: sub.source || parent.source || null,
        spec: sub.spec || parent.spec || null,
        changes: sub.changes || null,
        git: sub.git || null,
        testResult: null,
        qaResult: null,
        overnight: null,
      });
      // New sub-tasks start with spec done, implement pending
      newSub.pipeline = {
        spec:      { status: "done", by: body.createdBy || "agent", at: ts },
        implement: { status: "pending" },
        review:    { status: "pending" },
        test:      { status: "pending" },
        qa:        { status: "pending" },
        docs:      { status: "pending" },
        commit:    { status: "pending" },
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
    await saveTasks(projRoot, all, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ parentId, subTasks: created, total: all.length }));
    return true;
  }

  // ════════════════════════════════════════════════
  // /:id ROUTES
  // ════════════════════════════════════════════════

  // ── :id/notes ──
  // ── GET /api/coding-tasks/project/loop-mode ──
  if (url === "/api/coding-tasks/project/loop-mode" && method === "GET") {
    const { config } = await loadTasksAndConfig(projRoot);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ loopMode: config.loopMode }));
    return true;
  }

  // ── PUT /api/coding-tasks/project/loop-mode ──
  if (url === "/api/coding-tasks/project/loop-mode" && method === "PUT") {
    const body = await _readBody(req);
    const parsed = JSON.parse(body);
    const { loopMode } = parsed;
    if (loopMode !== "mini" && loopMode !== "full") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "loopMode must be 'mini' or 'full'" }));
      return true;
    }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    config.loopMode = loopMode;
    // Re-ensure pipeline for all active tasks
    for (const task of tasks) {
      if (task.status !== "resolved" && task.status !== "closed") {
        ensurePipeline(task, config);
        task.status = deriveStatus(task, config);
      }
    }
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, loopMode, tasksUpdated: tasks.filter(t => t.status !== "resolved" && t.status !== "closed").length }));
    return true;
  }

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

  // ── :id/pipeline/advance ──
  const advanceMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/pipeline\/advance$/);
  if (advanceMatch && method === "POST") {
    const id = decodeURIComponent(advanceMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { phase, result, by } = body;
    if (!phase || !PIPELINE_PHASES.includes(phase)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid phase. Must be one of: ${PIPELINE_PHASES.join(", ")}` }));
      return true;
    }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const task = ensurePipeline(tasks[idx], config);
    // Special: if advancing spec from agent (not human), set to awaiting_human first (Gate 1)
    if (phase === "spec" && task.pipeline.spec?.status === "in_progress" && by !== "human") {
      task.pipeline.spec = { status: "awaiting_human", by: by || "agent", at: now(), result: result || undefined };
      task.status = deriveStatus(task, config);
      await saveTasks(projRoot, tasks, config);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, task }));
      return true;
    }
    // Mark current phase done
    task.pipeline[phase] = {
      status: "done",
      by: by || "agent",
      at: now(),
      result: result || undefined,
    };
    // Advance to next ACTIVE phase (skip inactive phases for mini loop)
    const activePhases = getActivePhases(task, config);
    const activeIdx = activePhases.indexOf(phase);
    if (activeIdx < activePhases.length - 1) {
      const nextPhase = activePhases[activeIdx + 1];
      // Skip any phases between current and next active that are still pending
      for (let i = PIPELINE_PHASES.indexOf(phase) + 1; PIPELINE_PHASES[i] !== nextPhase; i++) {
        if (task.pipeline[PIPELINE_PHASES[i]]?.status === "pending") {
          task.pipeline[PIPELINE_PHASES[i]] = { status: "done", by: "system", at: now(), reason: "auto-skipped" };
        }
      }
      if (task.pipeline[nextPhase]?.status === "pending") {
        // Commit phase always awaits human; spec awaits human in full loop
        if (nextPhase === "commit") {
          task.pipeline[nextPhase] = { status: "awaiting_human", by: by || "agent", at: now() };
        } else {
          task.pipeline[nextPhase] = { status: "in_progress", by: by || "agent", at: now() };
        }
      }
    }
    // Derive flat status
    task.status = deriveStatus(task, config);
    if (task.status === "resolved" && !task.resolvedAt) {
      task.resolvedAt = now();
    }
    task.updatedAt = now();
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // ── :id/pipeline/reject ──
  const rejectMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/pipeline\/reject$/);
  if (rejectMatch && method === "POST") {
    const id = decodeURIComponent(rejectMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const { phase, reason, by, returnTo, feedback } = body;
    if (!phase || !PIPELINE_PHASES.includes(phase)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid phase. Must be one of: ${PIPELINE_PHASES.join(", ")}` }));
      return true;
    }
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Task not found" }));
      return true;
    }
    const task = ensurePipeline(tasks[idx], config);
    // Mark phase as rework/needs_human/failed
    const phaseStatus = body.status || "rework";
    task.pipeline[phase] = {
      status: phaseStatus,
      by: by || "agent",
      at: now(),
      reason: reason || undefined,
      feedback: feedback || undefined,
    };
    // Return to an earlier phase (default: implement for QA rework)
    const activePhases = getActivePhases(task, config);
    const targetPhase = returnTo && PIPELINE_PHASES.includes(returnTo) ? returnTo : "implement";
    // Reset downstream phases
    const targetIdx = PIPELINE_PHASES.indexOf(targetPhase);
    const currentIdx = PIPELINE_PHASES.indexOf(phase);
    for (let i = targetIdx; i <= currentIdx; i++) {
      const ph = PIPELINE_PHASES[i];
      if (i === targetIdx) {
        task.pipeline[ph] = { status: "in_progress", by: by || "agent", at: now(), reason: `rework from ${phase}`, feedback: feedback || undefined };
      } else if (activePhases.includes(ph)) {
        task.pipeline[ph] = { status: "pending" };
      }
    }
    // Add rework note
    if (!Array.isArray(task.notes)) task.notes = [];
    task.notes.push({ by: by || "agent", at: now(), content: `🔄 Rework from ${phase}: ${reason || feedback || "QA rejected"}` });
    task.status = deriveStatus(task, config);
    task.updatedAt = now();
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(task));
    return true;
  }

  // ── :id/git/diff ──
  const gitDiffMatch = url.match(/^\/api\/coding-tasks\/([^/?]+)\/git\/diff$/);
  if (gitDiffMatch && method === "GET") {
    const id = decodeURIComponent(gitDiffMatch[1]);
    const { tasks, config } = await loadTasksAndConfig(projRoot);
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
    const task = ensurePipeline(tasks[idx], config);
    const git = new TaskGit(projRoot);
    const result = await git.stage(task);
    task.git = { ...task.git, staged: result.staged, stagedAt: now() };
    task.updatedAt = now();
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, ...result }));
    return true;
  }

  // ── :id/git/commit ──
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
    const task = ensurePipeline(tasks[idx], config);
    const git = new TaskGit(projRoot);
    const message = body.message || TaskGit.generateCommitMessage(task);
    const result = await git.commit(task, message, body.push !== false);
    // Update task git info
    task.git = {
      ...task.git,
      commitSha: result.sha,
      backupBranch: result.backupBranch,
      pushed: result.pushed,
      committedAt: now(),
    };
    // Mark commit phase done if pipeline is at that stage
    if (task.pipeline?.commit?.status !== "done") {
      task.pipeline.commit = { status: "done", by: body.by || "agent", at: now() };
    }
    task.status = deriveStatus(task, config);
    if (task.status === "resolved" && !task.resolvedAt) {
      task.resolvedAt = now();
    }
    task.updatedAt = now();
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
    const task = ensurePipeline(tasks[idx], config);
    const git = new TaskGit(projRoot);
    const result = await git.restore(task);
    task.updatedAt = now();
    tasks[idx] = task;
    await saveTasks(projRoot, tasks, config);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id, ...result }));
    return true;
  }

  // ── :id/dispatch ──
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
    const task = ensurePipeline(tasks[idx], config);
    // Dispatch = mark phase as in_progress, set assignTo + assignee
    const phase = body.phase || "implement";
    const agent = body.agent || body.assignee || body.by || "agent";
    if (PIPELINE_PHASES.includes(phase)) {
      task.pipeline[phase] = {
        ...task.pipeline[phase],
        status: "in_progress",
        assignTo: agent,
        by: agent,
        at: now(),
      };
    }
    task.assignee = agent;
    task.status = deriveStatus(task, config);
    task.updatedAt = now();
    if (!Array.isArray(task.notes)) task.notes = [];
    const noteContent = body.instructions
      ? `Dispatched to **${agent}** for **${phase}** phase: ${body.instructions}`
      : body.note || `Dispatched to ${agent} for ${phase}`;
    task.notes.push({
      by: body.by || "dispatch",
      at: now(),
      content: noteContent,
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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
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
    const existing = ensurePipeline(tasks[idx], config);
    const updated = {
      ...existing,
      ...body,
      id: existing.id, // never overwrite ID
      updatedAt: now(),
    };
    // If task override changed, re-ensure pipeline
    const oldOverride = existing.loopModeOverride;
    const newOverride = body.loopModeOverride;
    if (newOverride !== undefined && newOverride !== oldOverride) {
      updated.loopModeOverride = newOverride;
      updated.pipeline = ensurePipeline(updated, config).pipeline;
    }
    // Handle pipeline field updates
    if (body.pipeline) {
      updated.pipeline = { ...existing.pipeline, ...body.pipeline };
      // Re-derive status from updated pipeline
      updated.status = deriveStatus(updated, config);
    }
    if ((body.status === "resolved" || body.status === "closed") && !updated.resolvedAt) {
      updated.resolvedAt = now();
    }
    if (body.status === "open" || body.status === "in-progress") {
      updated.resolvedAt = null;
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
      const subIds = tasks.filter(t => t.parentId === id).map(t => t.id);
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
    if (q.type) { const s = q.type.split(","); tasks = tasks.filter(t => s.includes(t.type)); }
    if (q.assignee) { const s = q.assignee.split(","); tasks = tasks.filter(t => s.includes(t.assignee || "unassigned")); }
    if (q.parentId) { tasks = tasks.filter(t => t.parentId === q.parentId); }
    if (q.linkedIssueId) { tasks = tasks.filter(t => t.linkedIssueId === q.linkedIssueId); }
    // Pipeline filter: ?pipeline=implement:pending or ?pipeline=commit:done
    if (q.pipeline) {
      const [phase, status] = q.pipeline.split(":");
      if (phase && status) {
        tasks = tasks.filter(t => t.pipeline?.[phase]?.status === status);
      } else if (phase) {
        // Filter tasks whose current active phase matches
        tasks = tasks.filter(t => {
          for (const ph of PIPELINE_PHASES) {
            const st = t.pipeline?.[ph]?.status;
            if (st && st !== "done" && st !== "skipped") {
              return ph === phase;
            }
          }
          return false;
        });
      }
    }
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
    const { tasks, config } = await loadTasksAndConfig(projRoot);
    const ts = now();
    const newTask = ensurePipeline({
      id: genId(tasks),
      title: body.title.trim() || "Untitled",
      type: body.type || "feature",
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
      timeoutSeconds: body.timeoutSeconds || 0,
      createdAt: ts,
      updatedAt: ts,
      resolvedAt: null,
      createdBy: body.createdBy || "user",
      // New pipeline fields
      source: body.source || null,
      spec: body.spec || (body.description ? { description: body.description } : null),
      changes: body.changes || null,
      git: body.git || null,
      testResult: null,
      qaResult: null,
      overnight: null,
      pipeline: body.pipeline || null,
      loopModeOverride: body.loopModeOverride || body.loopMode || null,  // task override, not project
    });
    // Derive status from pipeline
    newTask.status = deriveStatus(newTask, config);
    tasks.push(newTask);
    await saveTasks(projRoot, tasks, config);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(newTask));
    return true;
  }

  return false;
}

/**
 * runHealthPlanSubtask — Execute the next pending subtask of a health-fix execution plan.
 * After completion, auto-advances to the next subtask.
 * When all done, marks plan as completed.
 */
export async function runHealthPlanSubtask(projRoot, planId) {
  const { getPlan, getNextPendingSubTask, updateSubTask, markPlanCompleted } = await import("../lib/execution-plan.mjs");
  const plan = await getPlan(projRoot, planId);
  if (!plan || plan.status === "completed" || plan.status === "failed") {
    console.log(`[health-plan] Plan ${planId} is ${plan?.status || "not found"}, stopping`);
    return;
  }

  const result = await getNextPendingSubTask(projRoot, planId);
  if (!result) {
    // No more pending subtasks — finalize plan
    const finalPlan = await getPlan(projRoot, planId);
    const allDone = finalPlan.tasks.every(t => t.subtasks.every(s => s.status === "done"));
    if (allDone) {
      await markPlanCompleted(projRoot, planId);
      // Invalidate status cache — agent may have changed files
      try {
        const cacheFile = join(projRoot, ".paaw", "code-intelligence", "status-cache.json");
        if (existsSync(cacheFile)) { try { await import("fs/promises").then(m => m.unlink(cacheFile)); } catch {} }
      } catch {}
      console.log(`[health-plan] ✅ Plan ${planId} completed!`);
    } else {
      await updatePlanStatus(projRoot, planId, "partial");
      console.log(`[health-plan] ⚠️ Plan ${planId} partially completed`);
    }
    return;
  }

  const subtask = result.subtask;

  // Mark subtask as running
  await updateSubTask(projRoot, planId, subtask.subtaskId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const agentId = subtask.assignee;
  if (!agentId) {
    console.warn(`[health-plan] Subtask ${subtask.subtaskId} has no assignee, skipping`);
    await updateSubTask(projRoot, planId, subtask.subtaskId, { status: "skipped", completedAt: new Date().toISOString() });
    // Move to next
    await runHealthPlanSubtask(projRoot, planId);
    return;
  }

  // Check if agent is busy
  const { runningCodingAgents } = await import("../lib/running-agents.mjs");
  if (runningCodingAgents.has(agentId)) {
    // Revert to pending, will be retried
    await updateSubTask(projRoot, planId, subtask.subtaskId, { status: "pending", startedAt: null });
    console.log(`[health-plan] Agent ${agentId} is busy, subtask ${subtask.subtaskId} queued`);
    // Retry in 30 seconds
    setTimeout(() => runHealthPlanSubtask(projRoot, planId), 30000);
    return;
  }

  // Load crew config for agent
  const agentMap = {
    architect: "coding.architect",
    developer: "coding.developer",
    tester: "coding.tester",
    "doc-writer": "coding.doc-writer",
    qa: "coding.qa",
    helpdesk: "coding.helpdesk",
  };
  const { PAAW_ROOT } = await import("./shared.mjs").then(m => ({ PAAW_ROOT: m.PAAW_ROOT }));
  const crewId = agentMap[agentId] || agentId;
  const crewFile = join(PAAW_ROOT, "data", "crews", `${crewId}.json`);

  if (!existsSync(crewFile)) {
    console.error(`[health-plan] Agent '${agentId}' not found at ${crewFile}`);
    await updateSubTask(projRoot, planId, subtask.subtaskId, { status: "fail", error: `Agent not found: ${agentId}`, completedAt: new Date().toISOString() });
    await runHealthPlanSubtask(projRoot, planId);
    return;
  }

  try {
    const crewDef = JSON.parse(readFileSync(crewFile, "utf-8"));
    const systemPrompt = crewDef.rolePrompt || "";

    // Build context
    const extraContext = [];
    try {
      const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");
      const actionLog = await listActionLog(projRoot);
      if (actionLog.length > 0) {
        const recent = actionLog.slice(-10).map(e => `- [${e.agent}] ${e.action}${e.detail ? ": " + e.detail : ""} (${e.ts})`).join("\n");
        extraContext.push(`\n## Recent Action Log\n${recent}`);
      }
      const agentMemoryText = await loadAgentMemory(agentId, projRoot);
      if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory\n${agentMemoryText}`);
    } catch {}

    extraContext.push("\n## Rules\n- Only use `git add` (stage files), never `git commit` or `git push`.\n- When done, list all files you modified.\n- Write clean, minimal changes.\n");

    const fullSystemPrompt = systemPrompt + extraContext.join("");
    const messages = [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: subtask.title },
    ];

    const { resolveLLMConfig, runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
    const llm = resolveLLMConfig(projRoot);

    // Create a sink stream for SSE output (background work, no UI)
    const sink = new PassThrough();
    sink.resume();

    const abortCtrl = new AbortController();
    runningCodingAgents.set(agentId, { abortController: abortCtrl, res: sink, startedAt: Date.now(), source: `health-plan:${planId}` });

    const startTime = Date.now();

    await runAgentLoopStream({
      systemPrompt: fullSystemPrompt,
      messages,
      cwd: projRoot,
      agentId,
      model: llm.model,
      maxTurns: 30,
      timeout: 3600, // 60 min
      abortSignal: abortCtrl.signal,
    }, sink);

    const durationMs = Date.now() - startTime;
    runningCodingAgents.delete(agentId);
    sink.end();

    // Mark subtask as done
    await updateSubTask(projRoot, planId, subtask.subtaskId, {
      status: "done",
      completedAt: new Date().toISOString(),
      durationMs,
    });

    console.log(`[health-plan] ✅ Subtask ${subtask.subtaskId} done (${Math.round(durationMs / 1000)}s)`);

    // Dispatch next subtask
    await runHealthPlanSubtask(projRoot, planId);

  } catch (e) {
    runningCodingAgents.delete(agentId);
    console.error(`[health-plan] ❌ Subtask ${subtask.subtaskId} error:`, e.message);

    // Mark as failed but continue chain
    await updateSubTask(projRoot, planId, subtask.subtaskId, {
      status: e.message?.includes("timed out") ? "timeout" : "fail",
      error: e.message.slice(0, 200),
      completedAt: new Date().toISOString(),
    });

    // Continue to next subtask
    await runHealthPlanSubtask(projRoot, planId);
  }
}

/**
 * triggerHealthAgentDispatch — Run agent directly (no HTTP self-call)
 * Used by health-fix auto-dispatch chain.
 * SSE output goes to /dev/null (background work, no UI consumer).
 * After agent completes (or errors), chain to next sub-task or mark parent done.
 */
export async function triggerHealthAgentDispatch({ projRoot, subTask, chainParentId, chainSubTaskIds, chainCurrentIndex }) {
  const agentId = subTask.assignee;
  if (!agentId) {
    console.warn(`[health-chain] sub-task ${subTask.id} has no assignee, skipping`);
    return;
  }

  // Check if agent is busy
  const { runningCodingAgents } = await import("../lib/running-agents.mjs");
  if (runningCodingAgents.has(agentId)) {
    // Mark sub-task as queued
    const allTasks = await loadTasks(projRoot);
    const idx = allTasks.findIndex(t => t.id === subTask.id);
    if (idx >= 0) {
      if (!Array.isArray(allTasks[idx].notes)) allTasks[idx].notes = [];
      allTasks[idx].notes.push({ by: "system", at: new Date().toISOString(), content: `⏳ Agent ${agentId} is busy — queued for later` });
      allTasks[idx].updatedAt = new Date().toISOString();
      const { config: cfg } = await loadTasksAndConfig(projRoot);
      await saveTasks(projRoot, allTasks, cfg);
    }
    return;
  }

  // Load crew config for agent
  const agentMap = {
    architect: "coding.architect",
    developer: "coding.developer",
    tester: "coding.tester",
    "doc-writer": "coding.doc-writer",
    qa: "coding.qa",
    helpdesk: "coding.helpdesk",
  };
  const crewId = agentMap[agentId] || agentId;
  const { PAAW_ROOT } = await import("./shared.mjs").then(m => ({ PAAW_ROOT: m.PAAW_ROOT }));
  const crewFile = join(PAAW_ROOT, "data", "crews", `${crewId}.json`);
  if (!existsSync(crewFile)) {
    console.error(`[health-chain] Agent '${agentId}' not found at ${crewFile}`);
    return;
  }

  try {
    const crewDef = JSON.parse(readFileSync(crewFile, "utf-8"));
    const systemPrompt = crewDef.rolePrompt || "";

    // Build context (same as dispatch)
    const extraContext = [];
    const { listActionLog, loadAgentMemory } = await import("../lib/action-log.mjs");

    // Action log
    const actionLog = await listActionLog(projRoot);
    if (actionLog.length > 0) {
      const recent = actionLog.slice(-10).map(e => `- [${e.agent}] ${e.action}${e.detail ? ": " + e.detail : ""} (${e.ts})`).join("\n");
      extraContext.push(`\n## Recent Action Log\n${recent}`);
    }

    // Agent memory
    const agentMemoryText = await loadAgentMemory(agentId, projRoot);
    if (agentMemoryText) extraContext.push(`\n## Your Long-term Memory\n${agentMemoryText}`);

    const AGENT_RULES = "\n## Rules\n- Only use `git add` (stage files), never `git commit` or `git push`. The human decides when to commit and push.\n- When done, list all files you modified (code, config, docs).\n- Write clean, minimal changes. Don't over-engineer.\n- Follow existing code patterns and conventions.\n";
    extraContext.push(AGENT_RULES);

    const fullSystemPrompt = systemPrompt + extraContext.join("");
    const messages = [
      { role: "system", content: fullSystemPrompt },
      { role: "user", content: subTask.description || subTask.title },
    ];

    // Resolve LLM config
    const { resolveLLMConfig, runAgentLoopStream } = await import("../lib/paaw-agent-loop.mjs");
    const llm = resolveLLMConfig(projRoot);

    // Create a sink stream for SSE output (background work, no UI)
    const sink = new PassThrough();
    sink.resume(); // drain automatically — don't buffer

    // Register agent as running
    const abortCtrl = new AbortController();
    runningCodingAgents.set(agentId, { abortController: abortCtrl, res: sink, startedAt: Date.now(), source: "health-chain" });

    await runAgentLoopStream({
      systemPrompt: fullSystemPrompt,
      messages,
      cwd: projRoot,
      agentId,
      model: llm.model,
      maxTurns: 30,
      timeout: subTask.timeoutSeconds || 3600,
      abortSignal: abortCtrl.signal,
    }, sink);

    runningCodingAgents.delete(agentId);
    sink.end();

    // ── Post-completion: record result to sub-task ──
    const allTasks = await loadTasks(projRoot);
    const subIdx = allTasks.findIndex(t => t.id === subTask.id);
    if (subIdx >= 0) {
      if (!Array.isArray(allTasks[subIdx].notes)) allTasks[subIdx].notes = [];
      allTasks[subIdx].notes.push({ by: agentId, at: new Date().toISOString(), content: `✅ Agent ${agentId} completed health fix task` });
      allTasks[subIdx].updatedAt = new Date().toISOString();
      const { config: cfg } = await loadTasksAndConfig(projRoot);
      await saveTasks(projRoot, allTasks, cfg);
    }

    // ── Advance sub-task pipeline ──
    // Mini loop: implement → commit. Advance implement phase.
    try {
      // Directly update pipeline status (deriveStatus is local to this file)
      const allTasks2 = await loadTasks(projRoot);
      const sIdx = allTasks2.findIndex(t => t.id === subTask.id);
      if (sIdx >= 0) {
        const st = allTasks2[sIdx];
        if (st.pipeline?.implement) {
          st.pipeline.implement.status = "done";
          const { config: cfg2 } = await loadTasksAndConfig(projRoot);
          st.status = deriveStatus(st, cfg2);
          st.updatedAt = new Date().toISOString();
        }
        const { config: cfg2 } = await loadTasksAndConfig(projRoot);
        await saveTasks(projRoot, allTasks2, cfg2);
      }
    } catch (e) { console.error("[health-chain] pipeline advance error:", e.message); }

    // ── Chain: dispatch next sub-task ──
    if (chainCurrentIndex < chainSubTaskIds.length - 1) {
      const nextIndex = chainCurrentIndex + 1;
      const nextSubId = chainSubTaskIds[nextIndex];
      const allTasks3 = await loadTasks(projRoot);
      const nextSub = allTasks3.find(t => t.id === nextSubId);
      if (nextSub && nextSub.assignee) {
        console.log(`[health-chain] dispatching next sub-task ${nextIndex + 1}/${chainSubTaskIds.length}: ${nextSub.assignee}`);
        await triggerHealthAgentDispatch({
          projRoot,
          subTask: nextSub,
          chainParentId,
          chainSubTaskIds,
          chainCurrentIndex: nextIndex,
        });
      }
    } else {
      // ── Last sub-task done → mark parent resolved ──
      const allTasks4 = await loadTasks(projRoot);
      const parentIdx = allTasks4.findIndex(t => t.id === chainParentId);
      if (parentIdx >= 0) {
        allTasks4[parentIdx].status = "resolved";
        allTasks4[parentIdx].resolvedAt = new Date().toISOString();
        if (!Array.isArray(allTasks4[parentIdx].notes)) allTasks4[parentIdx].notes = [];
        allTasks4[parentIdx].notes.push({ by: "system", at: new Date().toISOString(), content: `✅ All ${chainSubTaskIds.length} sub-tasks completed — health fix done` });
        allTasks4[parentIdx].updatedAt = new Date().toISOString();
        const { config: cfg3 } = await loadTasksAndConfig(projRoot);
        await saveTasks(projRoot, allTasks4, cfg3);
      }
      console.log(`[health-chain] parent ${chainParentId} resolved ✅`);
    }

  } catch (e) {
    runningCodingAgents.delete(agentId);
    console.error(`[health-chain] agent ${agentId} error:`, e.message);

    // Record error to sub-task
    try {
      const allTasks = await loadTasks(projRoot);
      const subIdx = allTasks.findIndex(t => t.id === subTask.id);
      if (subIdx >= 0) {
        if (!Array.isArray(allTasks[subIdx].notes)) allTasks[subIdx].notes = [];
        allTasks[subIdx].notes.push({ by: agentId, at: new Date().toISOString(), content: `⚠️ Agent ${agentId} error: ${e.message.slice(0, 200)}. Moving to next.` });
        allTasks[subIdx].updatedAt = new Date().toISOString();
        const { config: cfg } = await loadTasksAndConfig(projRoot);
        await saveTasks(projRoot, allTasks, cfg);
      }
    } catch {}

    // Chain continues even on error
    if (chainCurrentIndex < chainSubTaskIds.length - 1) {
      const nextIndex = chainCurrentIndex + 1;
      const nextSubId = chainSubTaskIds[nextIndex];
      try {
        const allTasks3 = await loadTasks(projRoot);
        const nextSub = allTasks3.find(t => t.id === nextSubId);
        if (nextSub && nextSub.assignee) {
          console.log(`[health-chain] error occurred, dispatching next sub-task ${nextIndex + 1}/${chainSubTaskIds.length}`);
          await triggerHealthAgentDispatch({
            projRoot,
            subTask: nextSub,
            chainParentId,
            chainSubTaskIds,
            chainCurrentIndex: nextIndex,
          });
        }
      } catch (e2) { console.error("[health-chain] chain recovery error:", e2.message); }
    }
  }
}

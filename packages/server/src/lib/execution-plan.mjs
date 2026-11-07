/**
 * Execution Plan — EM 自動派工執行計畫
 *
 * EM 啟動自動派工時產生一份執行計畫，每個 sub-task 是獨立工作單元，
 * 有明確的 agent、timeout（預設 2h）、token/cost 追蹤。
 *
 * Plan 歸 plan，TASKS.json 歸 task — 不混淆。
 * Sub-task 完成後可以回寫 note 到對應的 TASK。
 *
 * 存儲：{projectRoot}/.paaw/auto-dispatch/plans/{planId}.json
 */

import { readFile, writeFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeResolve } from './coding-security.mjs';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── 狀態機定義 ──

// 合法 plan status 值域（更新 plan.status 前必須通過檢查）
const PLAN_STATUSES = ['created', 'running', 'completed', 'failed', 'partial', 'interrupted'];
// terminal state — 不可再轉回 running（防止 completed 被覆寫）
const TERMINAL_PLAN_STATUSES = ['completed', 'failed', 'partial'];
// sub-task 合法 status 值域
const SUBTASK_STATUSES = ['pending', 'running', 'done', 'fail', 'timeout', 'skipped', 'interrupted'];
// updateSubTask 允許呼叫端覆寫的欄位白名單（防止覆寫 subtaskId/title 等結構欄位）
const SUBTASK_PATCHABLE = [
  'status', 'startedAt', 'completedAt', 'durationMs',
  'tokenUsage', 'costUsd', 'model', 'result', 'error',
];

// ── 錯誤類型（route 層據此對應 HTTP status）──

class PlanError extends Error {
  constructor(message, code, httpStatus) {
    super(message);
    this.name = 'PlanError';
    this.code = code;          // e.g. NOT_FOUND | VALIDATION | PATH_TRAVERSAL
    this.httpStatus = httpStatus;
  }
}

function _notFound(message) {
  return new PlanError(message, 'NOT_FOUND', 404);
}

function _validation(message) {
  return new PlanError(message, 'VALIDATION', 400);
}

// ── 並發鎖（per-plan 序列化讀-改-寫，避免 lost update）──

const _planLocks = new Map(); // planId → Promise chain tail

/**
 * 將同一 planId 的讀-改-寫操作序列化，避免並發 PATCH/resume 互相覆蓋。
 * 以 promise chain 實作，確保前一個操作完成後才執行下一個。
 */
function _withPlanLock(planId, fn) {
  const prev = _planLocks.get(planId) || Promise.resolve();
  // 捕捉前一個的 rejection，避免中斷鏈
  const next = prev.catch(() => {}).then(fn);
  _planLocks.set(planId, next.catch(() => {}));
  return next;
}

// ── 工具函數 ──

function _plansDir(rootDir) {
  return join(rootDir, '.paaw', 'auto-dispatch', 'plans');
}

function _planPath(rootDir, planId) {
  // 走 safeResolve 防止 planId 帶 ../ 逃逸 plans 目錄（PATCH/DELETE 的 URL 參數）
  return safeResolve(_plansDir(rootDir), `${planId}.json`);
}

/**
 * 原子寫入 plan：先寫 temp 檔再 rename 覆蓋，避免崩潰/並發造成截斷或損毀。
 * rename 在同一檔案系統內為原子操作。
 */
async function _writePlanAtomic(rootDir, planId, plan) {
  const target = _planPath(rootDir, planId);
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(plan, null, 2) + '\n', 'utf-8');
    await rename(tmp, target);
  } catch (err) {
    // 寫入或 rename 失敗時清掉 temp 檔，避免殘留垃圾
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

async function _ensurePlansDir(rootDir) {
  const dir = _plansDir(rootDir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

function _genPlanId(projectPath) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  // basename() 跨平台（Windows 反斜線亦可）— 取代 split('/')
  const base = basename(projectPath) || 'project';
  return `ns-${date}-${base}`;
}

/**
 * 產生不與既有 plan 檔碰撞的 planId。
 * 同日同專案二次 createPlan 時加序號（-1/-2/...），避免覆蓋進行中的 plan
 * （覆蓋會破壞 resume 中斷恢復語意）。
 */
async function _genUniquePlanId(projectPath) {
  const dir = _plansDir(projectPath);
  const baseId = _genPlanId(projectPath);
  let candidate = baseId;
  let n = 1;
  while (existsSync(join(dir, `${candidate}.json`))) {
    candidate = `${baseId}-${n}`;
    n++;
  }
  return candidate;
}

function _genSubTaskId(parentId, index) {
  return `${parentId}.${String(index).padStart(2, '0')}`;
}

// ── 建立 Plan ──

/**
 * 建立執行計畫
 *
 * @param {Object} opts
 * @param {string} opts.projectPath - 專案根目錄
 * @param {string} opts.projectPhase - bootstrap/mvp/growth/stable/refactor
 * @param {string} opts.mode - em / parallel
 * @param {Array} opts.items - EM 規劃出的工作項目
 *   [{ title, assignee, source, sourceRef, priority, subtasks: [{ title, assignee }] }]
 * @returns {Object} plan
 */
export async function createPlan(opts = {}) {
  const { projectPath, projectPhase = 'bootstrap', mode = 'em', items = [] } = opts;
  if (!projectPath) throw new Error('projectPath required');

  await _ensurePlansDir(projectPath);

  // 不與既有 plan 碰撞（同日同專案二次 create 會加序號，避免覆蓋進行中的 plan）
  const planId = await _genUniquePlanId(projectPath);
  const now = new Date().toISOString();

  const tasks = [];
  let subtaskCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const taskId = `ST-${String(i + 1).padStart(3, '0')}`;

    const subtasks = (item.subtasks || [{ title: item.title, assignee: item.assignee }]).map((st, j) => {
      const subId = _genSubTaskId(taskId, j + 1);
      subtaskCount++;
      return {
        subtaskId: subId,
        title: st.title || item.title,
        assignee: st.assignee || item.assignee || 'developer',
        status: 'pending', // pending | running | done | fail | timeout | skipped
        timeoutMs: st.timeoutMs || DEFAULT_TIMEOUT_MS,
        startedAt: null,
        completedAt: null,
        durationMs: 0,
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
        costUsd: 0,
        model: null,
        result: null,
        error: null,
      };
    });

    tasks.push({
      taskId,
      parentId: null,
      source: item.source || 'unknown', // task_pipeline | security | issue | action_log | tech_debt
      sourceRef: item.sourceRef || null, // e.g. "TASK-003"
      title: item.title,
      assignee: item.assignee || subtasks[0]?.assignee || 'developer',
      status: 'pending',
      priority: item.priority || 'medium', // high | medium | low
      subtasks,
    });
  }

  const plan = {
    planId,
    projectPath,
    projectPhase,
    mode,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    status: 'created', // created | running | completed | partial | failed
    tasks,
    summary: {
      totalTasks: tasks.length,
      totalSubtasks: subtaskCount,
      completed: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
    },
  };

  await _writePlanAtomic(projectPath, planId, plan);
  console.log(`[ExecutionPlan] Created ${planId}: ${tasks.length} tasks, ${subtaskCount} subtasks`);
  return plan;
}

// ── 讀取 Plan ──

export async function getPlan(rootDir, planId) {
  const p = _planPath(rootDir, planId);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf-8'));
}

/**
 * 取得最新的 plan（用於 UI 顯示目前執行狀態）
 */
export async function getLatestPlan(rootDir) {
  const dir = _plansDir(rootDir);
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse();
  if (files.length === 0) return null;
  return JSON.parse(await readFile(join(dir, files[0]), 'utf-8'));
}

/**
 * 列出所有 plans（摘要）
 */
export async function listPlans(rootDir) {
  const dir = _plansDir(rootDir);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse();
  const plans = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await readFile(join(dir, f), 'utf-8'));
      plans.push({
        planId: p.planId,
        createdAt: p.createdAt,
        status: p.status,
        projectPhase: p.projectPhase,
        mode: p.mode,
        totalSubtasks: p.summary?.totalSubtasks || 0,
        completed: p.summary?.completed || 0,
        failed: p.summary?.failed || 0,
        totalCostUsd: p.summary?.totalCostUsd || 0,
      });
    } catch {}
  }
  return plans;
}

// ── 更新 Sub-task ──

/**
 * 更新 sub-task 狀態
 *
 * @param {string} rootDir
 * @param {string} planId
 * @param {string} subtaskId - e.g. "ST-001.01"
 * @param {Object} patch - { status, startedAt, completedAt, tokenUsage, costUsd, model, result, error }
 */
export async function updateSubTask(rootDir, planId, subtaskId, patch = {}) {
  // patch 白名單：只允許更新狀態/用量欄位，禁止覆寫 subtaskId/title 等結構欄位
  const cleanPatch = {};
  for (const k of Object.keys(patch || {})) {
    if (SUBTASK_PATCHABLE.includes(k)) cleanPatch[k] = patch[k];
  }
  if (cleanPatch.status !== undefined && !SUBTASK_STATUSES.includes(cleanPatch.status)) {
    throw _validation(`Invalid subtask status: ${cleanPatch.status}`);
  }

  // 讀-改-寫序列化（同 planId 併發 PATCH 不 lost update）
  return _withPlanLock(planId, async () => {
    const plan = await getPlan(rootDir, planId);
    if (!plan) throw _notFound(`Plan not found: ${planId}`);

    let found = false;
    for (const task of plan.tasks) {
      for (const st of task.subtasks) {
        if (st.subtaskId === subtaskId) {
          Object.assign(st, cleanPatch);

        // Auto-compute duration
        if (st.startedAt && st.completedAt && !st.durationMs) {
          st.durationMs = new Date(st.completedAt).getTime() - new Date(st.startedAt).getTime();
        }

        // Update parent task status
        const allDone = task.subtasks.every(s => s.status === 'done' || s.status === 'fail' || s.status === 'timeout' || s.status === 'skipped');
        const anyFail = task.subtasks.some(s => s.status === 'fail' || s.status === 'timeout');
        if (allDone) {
          task.status = anyFail ? 'partial' : 'done';
        } else if (task.subtasks.some(s => s.status === 'running')) {
          task.status = 'running';
        }

        found = true;
        break;
      }
    }
    if (found) break;
  }

    if (!found) throw _notFound(`Sub-task not found: ${subtaskId}`);

    // Recompute summary
    _recomputeSummary(plan);

    await _writePlanAtomic(rootDir, planId, plan);
    return plan;
  });
}

// ── 摘要 ──

export async function getPlanSummary(rootDir, planId) {
  const plan = await getPlan(rootDir, planId);
  if (!plan) return null;
  return {
    planId: plan.planId,
    status: plan.status,
    createdAt: plan.createdAt,
    startedAt: plan.startedAt,
    completedAt: plan.completedAt,
    ...plan.summary,
    tasks: plan.tasks.map(t => ({
      taskId: t.taskId,
      title: t.title,
      source: t.source,
      sourceRef: t.sourceRef,
      status: t.status,
      priority: t.priority,
      subtasks: t.subtasks.map(st => ({
        subtaskId: st.subtaskId,
        title: st.title,
        assignee: st.assignee,
        status: st.status,
        durationMs: st.durationMs,
        tokenUsage: st.tokenUsage,
        costUsd: st.costUsd,
        model: st.model,
        error: st.error,
      })),
    })),
  };
}

// ── 內部函數 ──

function _recomputeSummary(plan) {
  let completed = 0, failed = 0, timedOut = 0, skipped = 0;
  let totalTokens = 0, totalCostUsd = 0, totalDurationMs = 0;

  for (const task of plan.tasks) {
    for (const st of task.subtasks) {
      if (st.status === 'done') completed++;
      else if (st.status === 'fail') failed++;
      else if (st.status === 'timeout') timedOut++;
      else if (st.status === 'skipped') skipped++;

      totalTokens += st.tokenUsage?.total || 0;
      totalCostUsd += st.costUsd || 0;
      totalDurationMs += st.durationMs || 0;
    }
  }

  plan.summary = {
    ...plan.summary,
    completed,
    failed,
    timedOut,
    skipped,
    totalTokens,
    totalCostUsd,
    totalDurationMs,
  };

  // Update plan status
  const total = plan.summary.totalSubtasks;
  const finished = completed + failed + timedOut + skipped;
  if (finished === total && total > 0) {
    plan.status = failed + timedOut > 0 ? (completed > 0 ? 'partial' : 'failed') : 'completed';
    plan.completedAt = new Date().toISOString();
  } else if (finished > 0) {
    plan.status = 'running';
  }
}

/**
 * 取得下一個 pending sub-task
 */
export async function getNextPendingSubTask(rootDir, planId) {
  const plan = await getPlan(rootDir, planId);
  if (!plan) return null;
  for (const task of plan.tasks) {
    for (const st of task.subtasks) {
      if (st.status === 'pending') {
        return { plan, task, subtask: st };
      }
    }
  }
  return null;
}

/**
 * 標記 plan 開始執行
 */
export async function markPlanStarted(rootDir, planId) {
  return _withPlanLock(planId, async () => {
    const plan = await getPlan(rootDir, planId);
    if (!plan) throw _notFound(`Plan not found: ${planId}`);
    // 不可從 terminal state 復活（completed/failed/partial 不得回到 running）
    if (TERMINAL_PLAN_STATUSES.includes(plan.status)) {
      throw _validation(`Cannot start a ${plan.status} plan`);
    }
    plan.status = 'running';
    plan.startedAt = new Date().toISOString();
    await _writePlanAtomic(rootDir, planId, plan);
    return plan;
  });
}

export async function markPlanCompleted(rootDir, planId) {
  return _withPlanLock(planId, async () => {
    const plan = await getPlan(rootDir, planId);
    if (!plan) throw _notFound(`Plan not found: ${planId}`);
    _recomputeSummary(plan);
    // If still running after recompute, force it
    if (plan.status === 'running') {
      plan.status = 'completed';
      plan.completedAt = new Date().toISOString();
    }
    await _writePlanAtomic(rootDir, planId, plan);
    return plan;
  });
}

// ── Resume & Recovery ──

/**
 * 找出未完成的 plan（status = running 但有 pending/running sub-task）
 */
export async function findIncompletePlans(rootDir) {
  const plans = await listPlans(rootDir);
  const incomplete = [];
  for (const p of plans) {
    if (p.status === 'running' || p.status === 'created') {
      const full = await getPlan(rootDir, p.planId);
      if (!full) continue;
      const hasPending = full.tasks.some(t => t.subtasks.some(st => st.status === 'pending' || st.status === 'running'));
      if (hasPending) incomplete.push(full);
    }
  }
  return incomplete;
}

/**
 * 標記被中斷的 sub-task（running → interrupted）
 * 在 server 重啟時呼叫
 */
export async function markInterruptedPlans(rootDir) {
  const incomplete = await findIncompletePlans(rootDir);
  let marked = 0;
  for (const plan of incomplete) {
    let changed = false;
    for (const task of plan.tasks) {
      for (const st of task.subtasks) {
        if (st.status === 'running') {
          st.status = 'interrupted';
          st.error = st.error || 'Server restarted while running';
          changed = true;
        }
      }
    }
    if (changed) {
      _recomputeSummary(plan);
      await _writePlanAtomic(rootDir, plan.planId, plan);
      console.log(`[ExecutionPlan] Marked interrupted: ${plan.planId}`);
      marked++;
    }
  }
  return marked;
}

/**
 * Resume a plan — 把 interrupted/pending sub-task 重設為 pending，繼續執行
 */
export async function resumePlan(rootDir, planId) {
  return _withPlanLock(planId, async () => {
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw _notFound(`Plan not found: ${planId}`);

  let resumed = 0;
  for (const task of plan.tasks) {
    for (const st of task.subtasks) {
      // 2026-08-16: fail/timeout 也重跑 — partial plan 的失敗項必須能被 resume
      // （skipped 是政策性排除，不重跑）
      // 2026-08-30: running 也重跑 — server 重啟／崩潰時 subtask 會留在 running（殭屍），
      // 不重跑的話永遠卡住且被誤判「全部完成」（Fleming 實案例：派工中 server 重啟）
      if (st.status === 'interrupted' || st.status === 'pending' || st.status === 'fail' || st.status === 'timeout' || st.status === 'running') {
        st.status = 'pending';
        st.startedAt = null;
        st.completedAt = null;
        st.error = null;
        resumed++;
      }
    }
  }

  // Reset parent task status
  for (const task of plan.tasks) {
    const allDone = task.subtasks.every(s => s.status === 'done' || s.status === 'fail' || s.status === 'timeout' || s.status === 'skipped');
    if (!allDone) task.status = 'pending';
  }

  plan.status = 'running';
  plan.completedAt = null;
  _recomputeSummary(plan);
  await _writePlanAtomic(rootDir, plan.planId, plan);
  console.log(`[ExecutionPlan] Resumed ${plan.planId}: ${resumed} subtasks back to pending`);
  return { plan, resumedCount: resumed };
  });
}

/**
 * 刪除 plan
 */
export async function deletePlan(rootDir, planId) {
  const p = _planPath(rootDir, planId);
  if (!existsSync(p)) throw _notFound(`Plan not found: ${planId}`);
  // 非同步 unlink，與模組其餘風格一致（不在 request path 用 sync I/O）
  await unlink(p);
  console.log(`[ExecutionPlan] Deleted: ${planId}`);
  return true;
}

/**
 * 更新 plan status（手動）
 */
export async function updatePlanStatus(rootDir, planId, status) {
  if (!PLAN_STATUSES.includes(status)) throw _validation(`Invalid status: ${status}`);
  return _withPlanLock(planId, async () => {
    const plan = await getPlan(rootDir, planId);
    if (!plan) throw _notFound(`Plan not found: ${planId}`);
    // terminal state 不可被覆寫回 running（避免已完成 plan 被誤改成執行中）
    if (TERMINAL_PLAN_STATUSES.includes(plan.status) && status === 'running') {
      throw _validation(`Cannot revert ${plan.status} plan back to running`);
    }
    plan.status = status;
    if (status === 'completed') plan.completedAt = new Date().toISOString();
    await _writePlanAtomic(rootDir, planId, plan);
    console.log(`[ExecutionPlan] Status updated: ${planId} → ${status}`);
    return plan;
  });
}

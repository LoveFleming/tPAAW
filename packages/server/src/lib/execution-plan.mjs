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

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── 工具函數 ──

function _plansDir(rootDir) {
  return join(rootDir, '.paaw', 'auto-dispatch', 'plans');
}

function _planPath(rootDir, planId) {
  return join(_plansDir(rootDir), `${planId}.json`);
}

async function _ensurePlansDir(rootDir) {
  const dir = _plansDir(rootDir);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

function _genPlanId(projectPath) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const base = projectPath.split('/').pop() || 'project';
  return `ns-${date}-${base}`;
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

  const planId = _genPlanId(projectPath);
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

  await writeFile(_planPath(projectPath, planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
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
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  let found = false;
  for (const task of plan.tasks) {
    for (const st of task.subtasks) {
      if (st.subtaskId === subtaskId) {
        Object.assign(st, patch);

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

  if (!found) throw new Error(`Sub-task not found: ${subtaskId}`);

  // Recompute summary
  _recomputeSummary(plan);

  await writeFile(_planPath(rootDir, planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
  return plan;
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
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  plan.status = 'running';
  plan.startedAt = new Date().toISOString();
  await writeFile(_planPath(rootDir, planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
  return plan;
}

export async function markPlanCompleted(rootDir, planId) {
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  _recomputeSummary(plan);
  // If still running after recompute, force it
  if (plan.status === 'running') {
    plan.status = 'completed';
    plan.completedAt = new Date().toISOString();
  }
  await writeFile(_planPath(rootDir, planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
  return plan;
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
      await writeFile(_planPath(rootDir, plan.planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
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
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

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
  await writeFile(_planPath(rootDir, plan.planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
  console.log(`[ExecutionPlan] Resumed ${plan.planId}: ${resumed} subtasks back to pending`);
  return { plan, resumedCount: resumed };
}

/**
 * 刪除 plan
 */
export async function deletePlan(rootDir, planId) {
  const p = _planPath(rootDir, planId);
  const { existsSync, unlinkSync } = await import('fs');
  if (!existsSync(p)) throw new Error(`Plan not found: ${planId}`);
  unlinkSync(p);
  console.log(`[ExecutionPlan] Deleted: ${planId}`);
  return true;
}

/**
 * 更新 plan status（手動）
 */
export async function updatePlanStatus(rootDir, planId, status) {
  const plan = await getPlan(rootDir, planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  const valid = ['created', 'running', 'completed', 'failed', 'partial', 'interrupted'];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  plan.status = status;
  if (status === 'completed') plan.completedAt = new Date().toISOString();
  await writeFile(_planPath(rootDir, planId), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
  console.log(`[ExecutionPlan] Status updated: ${planId} → ${status}`);
  return plan;
}

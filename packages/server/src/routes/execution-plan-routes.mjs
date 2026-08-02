/**
 * Auto Dispatch Execution Plan API routes
 *
 * POST   /api/auto-dispatch/plan/create           — 建立執行計畫
 * GET    /api/auto-dispatch/plan/latest            — 取得最新 plan（UI 用）
 * GET    /api/auto-dispatch/plan/list              — 列出所有 plans
 * GET    /api/auto-dispatch/plan/:planId           — 取得完整 plan
 * GET    /api/auto-dispatch/plan/:planId/summary   — 摘要
 * PATCH  /api/auto-dispatch/plan/:planId/subtask/:subId — 更新 sub-task
 * POST   /api/auto-dispatch/plan/:planId/execute   — 開始執行（由 auto-dispatch-manager 呼叫）
 */

import {
  createPlan, getPlan, getLatestPlan, listPlans,
  getPlanSummary, updateSubTask, markPlanStarted, getNextPendingSubTask,
  findIncompletePlans, markInterruptedPlans, resumePlan,
  deletePlan, updatePlanStatus,
} from '../lib/execution-plan.mjs';

export default async function executionPlanRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();

  // ── POST /api/auto-dispatch/plan/create ──
  if (req.method === 'POST' && urlObj.pathname === '/api/auto-dispatch/plan/create') {
    try {
      const body = await _readBody(req);
      const { projectPath, projectPhase, mode, items } = body;
      const plan = await createPlan({
        projectPath: projectPath || rootDir,
        projectPhase,
        mode,
        items: items || [],
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── GET /api/auto-dispatch/plan/latest ──
  if (req.method === 'GET' && urlObj.pathname === '/api/auto-dispatch/plan/latest') {
    try {
      const plan = await getLatestPlan(rootDir);
      if (!plan) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'No plans found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── GET /api/auto-dispatch/plan/list ──
  if (req.method === 'GET' && urlObj.pathname === '/api/auto-dispatch/plan/list') {
    try {
      const plans = await listPlans(rootDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plans }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── GET /api/auto-dispatch/plan/:planId/summary ──
  const summaryMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)\/summary$/);
  if (req.method === 'GET' && summaryMatch) {
    try {
      const summary = await getPlanSummary(rootDir, summaryMatch[1]);
      if (!summary) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Plan not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, summary }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── GET /api/auto-dispatch/plan/:planId ──
  const getMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)$/);
  if (req.method === 'GET' && getMatch) {
    try {
      const plan = await getPlan(rootDir, getMatch[1]);
      if (!plan) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Plan not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── PATCH /api/auto-dispatch/plan/:planId/subtask/:subId ──
  const subMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)\/subtask\/(.+)$/);
  if (req.method === 'PATCH' && subMatch) {
    try {
      const body = await _readBody(req);
      const plan = await updateSubTask(rootDir, subMatch[1], subMatch[2], body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── POST /api/auto-dispatch/plan/:planId/execute ──
  const execMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)\/execute$/);
  if (req.method === 'POST' && execMatch) {
    try {
      await markPlanStarted(rootDir, execMatch[1]);
      // Actual execution is handled by auto-dispatch-manager via SSE
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Plan execution started' }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── GET /api/auto-dispatch/plan/incomplete ── (find unfinished plans)
  if (req.method === 'GET' && urlObj.pathname === '/api/auto-dispatch/plan/incomplete') {
    try {
      const plans = await findIncompletePlans(rootDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plans, count: plans.length }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── POST /api/auto-dispatch/plan/:planId/resume ──
  const resumeMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)\/resume$/);
  if (req.method === 'POST' && resumeMatch) {
    try {
      const { plan, resumedCount } = await resumePlan(rootDir, resumeMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan, resumedCount }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── DELETE /api/auto-dispatch/plan/:planId ──
  const delMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)$/);
  if (req.method === 'DELETE' && delMatch) {
    try {
      await deletePlan(rootDir, delMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  // ── PATCH /api/auto-dispatch/plan/:planId/status ──
  const statusMatch = urlObj.pathname.match(/^\/api\/auto-dispatch\/plan\/([^/]+)\/status$/);
  if (req.method === 'PATCH' && statusMatch) {
    try {
      const body = await _readBody(req);
      const plan = await updatePlanStatus(rootDir, statusMatch[1], body.status);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      return true;
    }
  }

  return false; // Not handled
}

function _readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

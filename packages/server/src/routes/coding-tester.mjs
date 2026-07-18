/**
 * coding-tester.mjs — Tester Agent API Routes
 *
 * POST /api/coding-tester/run      — 啟動 Tester 任務（SSE stream）
 * POST /api/coding-tester/abort    — 中斷（可選 rollback）
 * POST /api/coding-tester/rollback — 獨立 rollback
 * GET  /api/coding-tester/status   — 狀態
 * GET  /api/coding-tester/snapshot — 當前 snapshot
 */

import { runTester, abortTesterExecution, getTesterSnapshot } from '../lib/agents/tester/orchestrator.mjs';
import { readBody } from './shared.mjs';
import { execSync } from 'node:child_process';

let running = false;
let lastResult = null;
let lastError = null;
let currentProjectRoot = null;

export default async function testerRoutes(req, res) {
  const url = req.url || '';

  // POST /api/coding-tester/run
  if (req.method === 'POST' && url.includes('/api/coding-tester/run')) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const { task, model, targetFiles, skipCommit = false } = body;

      if (!task) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task is required' }));
        return true;
      }

      if (running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tester is already running' }));
        return true;
      }

      const pathMatch = url.match(/[?&]path=([^&]+)/);
      const projectRoot = pathMatch ? decodeURIComponent(pathMatch[1]) : process.env.PAAW_ROOT || process.cwd();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const sendEvent = (type, data) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent('start', { task, model: model || 'default', projectRoot });

      running = true;
      lastError = null;
      currentProjectRoot = projectRoot;

      try {
        const result = await runTester({
          task, projectRoot, model, targetFiles, skipCommit,
          onProgress: (progress) => sendEvent('progress', progress),
        });
        lastResult = result;
        sendEvent('complete', result);
      } catch (err) {
        lastError = err.message;
        sendEvent('error', { message: err.message });
      } finally {
        running = false;
        currentProjectRoot = null;
      }

      res.end();
      return true;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // POST /api/coding-tester/abort
  if (req.method === 'POST' && url.includes('/api/coding-tester/abort')) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const { rollback = false } = body;

      if (!running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tester is not running' }));
        return true;
      }

      abortTesterExecution();

      if (rollback && currentProjectRoot) {
        const snapshot = getTesterSnapshot();
        if (snapshot) {
          try {
            execSync(`git reset --hard ${snapshot}`, { cwd: currentProjectRoot, encoding: 'utf-8', timeout: 10000 });
            execSync('git clean -fd', { cwd: currentProjectRoot, encoding: 'utf-8', timeout: 10000 });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ aborted: true, rolledBack: true, snapshot }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ aborted: true, rolledBack: false, error: err.message }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ aborted: true, rolledBack: false, reason: 'no snapshot' }));
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ aborted: true, rolledBack: false }));
      }
      return true;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // POST /api/coding-tester/rollback
  if (req.method === 'POST' && url.includes('/api/coding-tester/rollback')) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const { snapshot: customSnapshot } = body;

      const pathMatch = url.match(/[?&]path=([^&]+)/);
      const projectRoot = pathMatch ? decodeURIComponent(pathMatch[1]) : currentProjectRoot || process.env.PAAW_ROOT || process.cwd();

      const snapshot = customSnapshot || getTesterSnapshot();
      if (!snapshot) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No snapshot to rollback to' }));
        return true;
      }

      if (running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot rollback while task is running. Abort first.' }));
        return true;
      }

      try {
        execSync(`git cat-file -t ${snapshot}`, { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid snapshot: ${snapshot}` }));
        return true;
      }

      execSync(`git reset --hard ${snapshot}`, { cwd: projectRoot, encoding: 'utf-8', timeout: 10000 });
      execSync('git clean -fd', { cwd: projectRoot, encoding: 'utf-8', timeout: 10000 });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rolledBack: true, snapshot, message: `已還原到 ${snapshot}` }));
      return true;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // GET /api/coding-tester/snapshot
  if (req.method === 'GET' && url.includes('/api/coding-tester/snapshot')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ snapshot: getTesterSnapshot(), running }));
    return true;
  }

  // GET /api/coding-tester/status
  if (req.method === 'GET' && url.includes('/api/coding-tester/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running,
      lastResult: lastResult ? {
        status: lastResult.status,
        task: lastResult.task,
        testFilesWritten: lastResult.testFilesWritten,
        testPassed: lastResult.testPassed,
        commitHash: lastResult.commitHash,
      } : null,
      lastError,
    }));
    return true;
  }

  return false;
}

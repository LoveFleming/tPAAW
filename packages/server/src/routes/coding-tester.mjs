/**
 * coding-tester.mjs — Tester Agent API Routes
 *
 * POST /api/coding-tester/run    — 啟動 Tester 任務（SSE stream）
 * GET  /api/coding-tester/status — 檢查狀態
 */

import { runTester } from '../lib/agents/tester/orchestrator.mjs';
import { readBody } from './shared.mjs';

let running = false;
let lastResult = null;
let lastError = null;

export default async function testerRoutes(req, res) {
  const url = req.url || '';

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

/**
 * coding-developer.mjs — Developer Agent API Routes
 *
 * POST /api/coding-developer/run    — 啟動 Developer 任務（SSE stream）
 * GET  /api/coding-developer/status — 檢查 Developer 是否正在跑
 */

import { runDeveloper } from '../lib/agents/developer/orchestrator.mjs';
import { readBody } from './shared.mjs';

let running = false;
let lastResult = null;
let lastError = null;

export default async function developerRoutes(req, res) {
  const url = req.url || '';

  // POST /api/coding-developer/run
  if (req.method === 'POST' && url.includes('/api/coding-developer/run')) {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const { task, model, skipCommit = false } = body;

      if (!task) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task is required' }));
        return true;
      }

      if (running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Developer is already running' }));
        return true;
      }

      // Parse project root from query string
      const pathMatch = url.match(/[?&]path=([^&]+)/);
      const projectRoot = pathMatch ? decodeURIComponent(pathMatch[1]) : process.env.PAAW_ROOT || process.cwd();

      // SSE headers
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
        const result = await runDeveloper({
          task,
          projectRoot,
          model,
          skipCommit,
          onProgress: (progress) => {
            sendEvent('progress', progress);
          },
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

  // GET /api/coding-developer/status
  if (req.method === 'GET' && url.includes('/api/coding-developer/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running,
      lastResult: lastResult ? {
        status: lastResult.status,
        task: lastResult.task,
        filesChanged: lastResult.filesChanged,
        buildPassed: lastResult.buildPassed,
        testsPassed: lastResult.testsPassed,
        commitHash: lastResult.commitHash,
      } : null,
      lastError,
    }));
    return true;
  }

  return false; // Not our route
}

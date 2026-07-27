/**
 * Agent Execution Logs API
 *
 * GET  /api/agent-logs           — list recent tasks
 * GET  /api/agent-logs/:taskId   — full detail (all steps)
 * POST /api/agent-logs/purge     — cleanup old logs
 */

import { listAgentTasks, getAgentTaskDetail, cleanupOldAgentLogs } from "../lib/agent-exec-logger.mjs";
import { readBody } from "./shared.mjs";

export default async function agentLogsRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  // GET /api/agent-logs — list
  if (url === "/api/agent-logs" && method === "GET") {
    try {
      const limit = Math.min(parseInt(q.get("limit") || "50", 10), 200);
      const agentId = q.get("agent") || null;
      const status = q.get("status") || null;
      const tasks = await listAgentTasks(limit, agentId ? { agentId } : status ? { status } : {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: tasks, total: tasks.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/agent-logs/:taskId — detail
  const detailMatch = url.match(/^\/api\/agent-logs\/([\w\-]+)$/);
  if (detailMatch && method === "GET") {
    try {
      const taskId = detailMatch[1];
      const detail = await getAgentTaskDetail(taskId);
      if (!detail) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Task not found" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(detail));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/agent-logs/purge — cleanup
  if (url === "/api/agent-logs/purge" && method === "POST") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const days = body.days || 7;
      const deleted = await cleanupOldAgentLogs(days);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted, retentionDays: days }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

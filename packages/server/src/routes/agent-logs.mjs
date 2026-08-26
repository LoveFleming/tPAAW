/**
 * Agent Execution Logs API
 *
 * GET  /api/agent-logs           — list recent tasks（含 ruName / usage / costUsd）
 * GET  /api/agent-logs/ru-summary — per-RU token/cost 統計
 * GET  /api/agent-logs/:taskId   — full detail (all steps)
 * POST /api/agent-logs/purge     — cleanup old logs
 */

import { listAgentTasks, getAgentTaskDetail, cleanupOldAgentLogs, getRuCostHistory, backfillIndexCwd, LOG_DIR, INDEX_FILE } from "../lib/agent-exec-logger.mjs";
import { resolveRuName } from "../lib/ru-resolver.mjs";
import { readBody } from "./shared.mjs";
import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";

export default async function agentLogsRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  // GET /api/agent-logs/ru-debug — RU 解析診斷：看每筆 task 的 cwd 原始值與解析結果
  // ?test=<path> 可直接測任意路徑；?backfill=1 手動觸發回填
  if (url === "/api/agent-logs/ru-debug" && method === "GET") {
    const out = { serverTime: new Date().toISOString() };
    const testPath = q.get("test");
    if (testPath !== null) out.test = { input: testPath, resolved: resolveRuName(testPath) };
    if (q.get("backfill") === "1") out.backfilled = await backfillIndexCwd();
    try {
      const tasks = await listAgentTasks(30);
      out.samples = tasks.slice(0, 20).map(t => ({
        taskId: t.taskId, agentId: t.agentId, cwd: t.cwd ?? null,
        resolvedRu: resolveRuName(t.cwd),
      }));
      out.nullCwdCount = tasks.filter(t => !t.cwd).length;
    } catch (e) { out.listError = e.message; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out, null, 2));
    return;
  }

  // GET /api/agent-logs — list
  if (url === "/api/agent-logs" && method === "GET") {
    try {
      const limit = Math.min(parseInt(q.get("limit") || "50", 10), 200);
      const agentId = q.get("agent") || null;
      const status = q.get("status") || null;
      const ru = q.get("ru") || null;
      let tasks = await listAgentTasks(limit, agentId ? { agentId } : status ? { status } : {});
      // 附加 RU name（cwd → project）
      tasks = tasks.map(t => ({ ...t, ruName: resolveRuName(t.cwd) }));
      if (ru) tasks = tasks.filter(t => t.ruName === ru);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: tasks, total: tasks.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/agent-logs/ru-summary — per-RU cost aggregation（live index + 持久化歷史）
  if (url === "/api/agent-logs/ru-summary" && method === "GET") {
    try {
      const tasks = await listAgentTasks(200, {});
      const byRu = {};
      const _agg = (ruName, task) => {
        if (!byRu[ruName]) byRu[ruName] = { ruName, tasks: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} };
        const agg = byRu[ruName];
        agg.tasks += 1;
        agg.tokensIn += task.usage?.prompt || 0;
        agg.tokensOut += task.usage?.completion || 0;
        agg.costUsd += task.costUsd || 0;
        for (const m of (task.models || [])) {
          if (!agg.byModel[m.model]) agg.byModel[m.model] = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
          agg.byModel[m.model].tokensIn += m.prompt || 0;
          agg.byModel[m.model].tokensOut += m.completion || 0;
          agg.byModel[m.model].costUsd += m.costUsd || 0;
        }
      };
      for (const t of tasks) _agg(resolveRuName(t.cwd), t);
      // 合併已 purge 的歷史累計
      const hist = await getRuCostHistory();
      for (const h of Object.values(hist)) {
        if (!byRu[h.ruName]) byRu[h.ruName] = { ruName: h.ruName, tasks: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} };
        const agg = byRu[h.ruName];
        agg.tasks += h.tasks || 0;
        agg.tokensIn += h.tokensIn || 0;
        agg.tokensOut += h.tokensOut || 0;
        agg.costUsd += h.costUsd || 0;
        for (const [model, s] of Object.entries(h.byModel || {})) {
          if (!agg.byModel[model]) agg.byModel[model] = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
          agg.byModel[model].tokensIn += s.tokensIn || 0;
          agg.byModel[model].tokensOut += s.tokensOut || 0;
          agg.byModel[model].costUsd += s.costUsd || 0;
        }
      }
      const rows = Object.values(byRu).sort((a, b) => b.costUsd - a.costUsd);
      const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows, totalCostUsd: totalCost }));
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

  // DELETE /api/agent-logs/ru/:ruName — delete all logs for a release unit
  const ruDeleteMatch = url.match(/^\/api\/agent-logs\/ru\/(.+)$/);
  if (ruDeleteMatch && method === "DELETE") {
    try {
      const targetRu = decodeURIComponent(ruDeleteMatch[1]);
      if (!targetRu || targetRu === "-") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid RU name" }));
        return true;
      }
      // Filter index entries: keep only those whose cwd resolves to a different RU
      let entries = [];
      try { entries = JSON.parse(await readFile(INDEX_FILE, "utf-8")); } catch {}
      const toDelete = entries.filter(e => resolveRuName(e.cwd) === targetRu);
      entries = entries.filter(e => resolveRuName(e.cwd) !== targetRu);
      // Delete .jsonl files for removed entries
      for (const e of toDelete) {
        try { await unlink(join(LOG_DIR, `${e.taskId}.jsonl`)); } catch {}
      }
      // Remove from ru-cost-history.json
      const histFile = join(LOG_DIR, "ru-cost-history.json");
      try {
        const hist = JSON.parse(await readFile(histFile, "utf-8"));
        if (hist[targetRu]) {
          delete hist[targetRu];
          await writeFile(histFile, JSON.stringify(hist, null, 2), "utf-8");
        }
      } catch {}
      // Save updated index
      await writeFile(INDEX_FILE, JSON.stringify(entries, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted: toDelete.length, ruName: targetRu }));
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

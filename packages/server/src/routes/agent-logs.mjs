/**
 * Agent Execution Logs API
 *
 * GET  /api/agent-logs           — list recent tasks（含 ruName / usage / costUsd）
 * GET  /api/agent-logs/ru-summary — per-RU token/cost 統計
 * GET  /api/agent-logs/:taskId   — full detail (all steps)
 * POST /api/agent-logs/purge     — cleanup old logs
 */

import { listAgentTasks, getAgentTaskDetail, cleanupOldAgentLogs, getRuCostHistory, backfillIndexCwd, getUsageEvents, LOG_DIR, INDEX_FILE } from "../lib/agent-exec-logger.mjs";
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
        if (!byRu[ruName]) byRu[ruName] = { ruName, tasks: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, byModel: {} };
        const agg = byRu[ruName];
        agg.tasks += 1;
        agg.tokensIn += task.usage?.prompt || 0;
        agg.tokensOut += task.usage?.completion || 0;
        agg.costUsd += task.costUsd || 0;
        agg.durationMs += task.durationMs || 0; // 2026-09-06 Fleming：RU 統計加 AI 總耗時
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
        if (!byRu[h.ruName]) byRu[h.ruName] = { ruName: h.ruName, tasks: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, byModel: {} };
        const agg = byRu[h.ruName];
        agg.tasks += h.tasks || 0;
        agg.tokensIn += h.tokensIn || 0;
        agg.tokensOut += h.tokensOut || 0;
        agg.costUsd += h.costUsd || 0;
        agg.durationMs += h.durationMs || 0;
        for (const [model, s] of Object.entries(h.byModel || {})) {
          if (!agg.byModel[model]) agg.byModel[model] = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
          agg.byModel[model].tokensIn += s.tokensIn || 0;
          agg.byModel[model].tokensOut += s.tokensOut || 0;
          agg.byModel[model].costUsd += s.costUsd || 0;
        }
      }
      const rows = Object.values(byRu).sort((a, b) => b.costUsd - a.costUsd);
      const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
      const totalDurationMs = rows.reduce((s, r) => s + (r.durationMs || 0), 0);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rows, totalCostUsd: totalCost, totalDurationMs }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/agent-logs/usage-report — 執行報表（2026-09-16）：RU × 日 × Agent 的 requests/tokens/cost/duration
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD（含端點，空 = 不限）&ru=&agent=（可選過濾）
  if (url === "/api/agent-logs/usage-report" && method === "GET") {
    try {
      const events = await getUsageEvents();
      const from = q.get("from") || null;
      const to = q.get("to") || null;
      const ruF = q.get("ru") || null;
      const agentF = q.get("agent") || null;

      // 日期用 server 本地時區分組（Mac mini = Asia/Taipei）
      const localDate = (iso) => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };

      const agents = [...new Set(events.map(e => e.agentId))].sort();
      const rus = [...new Set(events.map(e => e.ruName))].sort();

      const filtered = events.filter(e => {
        const d = localDate(e.startTime);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (ruF && e.ruName !== ruF) return false;
        if (agentF && e.agentId !== agentF) return false;
        return true;
      });

      const _newAgg = () => ({ requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, errors: 0 });
      const _add = (agg, e) => {
        agg.requests += 1;
        agg.tokensIn += e.usage?.prompt || 0;
        agg.tokensOut += e.usage?.completion || 0;
        agg.costUsd += e.costUsd || 0;
        agg.durationMs += e.durationMs || 0;
        if (e.status && e.status !== "completed") agg.errors += 1;
      };

      const totals = _newAgg();
      const byDayMap = new Map();
      const byRuMap = new Map();
      const byAgentMap = new Map();
      const byRuAgentMap = new Map(); // key: ru \u001f agent

      for (const e of filtered) {
        const d = localDate(e.startTime);
        _add(totals, e);

        if (!byDayMap.has(d)) byDayMap.set(d, { date: d, ..._newAgg(), byAgent: {} });
        const day = byDayMap.get(d);
        _add(day, e);
        if (!day.byAgent[e.agentId]) day.byAgent[e.agentId] = _newAgg();
        _add(day.byAgent[e.agentId], e);

        if (!byRuMap.has(e.ruName)) byRuMap.set(e.ruName, { ruName: e.ruName, ..._newAgg() });
        _add(byRuMap.get(e.ruName), e);

        if (!byAgentMap.has(e.agentId)) byAgentMap.set(e.agentId, { agentId: e.agentId, ..._newAgg() });
        _add(byAgentMap.get(e.agentId), e);

        const raKey = `${e.ruName}\u001f${e.agentId}`;
        if (!byRuAgentMap.has(raKey)) byRuAgentMap.set(raKey, { ruName: e.ruName, agentId: e.agentId, ..._newAgg() });
        _add(byRuAgentMap.get(raKey), e);
      }

      const _sortCost = (a, b) => b.costUsd - a.costUsd;
      const byDay = Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      const byRu = Array.from(byRuMap.values()).sort(_sortCost);
      const byAgent = Array.from(byAgentMap.values()).sort(_sortCost);
      const byRuAgent = Array.from(byRuAgentMap.values())
        .sort((a, b) => a.ruName.localeCompare(b.ruName) || _sortCost(a, b));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        generatedAt: new Date().toISOString(),
        from: from || byDay[0]?.date || null,
        to: to || byDay[byDay.length - 1]?.date || null,
        filters: { ru: ruF, agent: agentF },
        options: { agents, rus },
        totals,
        byDay,
        byRu,
        byAgent,
        byRuAgent,
      }));
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

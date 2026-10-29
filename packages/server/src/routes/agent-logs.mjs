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

// 保留天數合法範圍 — 與 log-retention PUT 的 1-3650 檢查一致
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

// 內部錯誤對外一律回通用訊息（細節只進 server log）——避免洩漏檔案路徑/模組名
const INTERNAL_ERROR_MSG = "Internal error";

/** 讀取 index.json，區分「檔案不存在」與「內容損壞」——後者不可靜默當空陣列，
 *  否則 DELETE RU 會把整份 index 覆寫成 []、造成所有任務摘要遺失（資料完整性）。 */
async function readIndexEntries() {
  let raw;
  try {
    raw = await readFile(INDEX_FILE, "utf-8");
  } catch (e) {
    if (e && e.code === "ENOENT") return { entries: [], corrupt: false };
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    return { entries: Array.isArray(parsed) ? parsed : [], corrupt: false };
  } catch {
    return { entries: [], corrupt: true };
  }
}

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
      const limit = Math.min(parseInt(q.get("limit") || "50", 10), 100000);
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
      console.error("[agent-logs] request failed:", String(err?.message || err).replace(/\n/g, " "));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: INTERNAL_ERROR_MSG }));
    }
    return true;
  }

  // GET /api/agent-logs/ru-summary — per-RU cost aggregation（live index + 持久化歷史）
  if (url === "/api/agent-logs/ru-summary" && method === "GET") {
    try {
      const tasks = await listAgentTasks(100000, {});
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
      console.error("[agent-logs] request failed:", String(err?.message || err).replace(/\n/g, " "));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: INTERNAL_ERROR_MSG }));
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
      console.error("[agent-logs] request failed:", String(err?.message || err).replace(/\n/g, " "));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: INTERNAL_ERROR_MSG }));
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
      // 壞檔保護：index.json 內容損壞時不可當空陣列覆寫，否則整份 index 會被清空（資料遺失）
      const { entries: loaded, corrupt } = await readIndexEntries();
      if (corrupt) {
        console.error(`[agent-logs] refuse DELETE ru/${targetRu}: index.json is corrupt`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Log index is corrupted; refusing to modify" }));
        return true;
      }
      let entries = loaded;
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
      console.error("[agent-logs] request failed:", String(err?.message || err).replace(/\n/g, " "));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: INTERNAL_ERROR_MSG }));
    }
    return true;
  }

  // POST /api/agent-logs/purge — cleanup
  if (url === "/api/agent-logs/purge" && method === "POST") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      // 驗證 days：型別須為數字、範圍 1-3650（0 代表永不刪 → 走設定端，不在此誤用）。與 log-retention PUT 一致
      const rawDays = body.days === undefined || body.days === null ? 7 : body.days;
      const days = Number(rawDays);
      if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `days must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}` }));
        return true;
      }
      const deleted = await cleanupOldAgentLogs(days);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted, retentionDays: days }));
    } catch (err) {
      console.error("[agent-logs] request failed:", String(err?.message || err).replace(/\n/g, " "));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: INTERNAL_ERROR_MSG }));
    }
    return true;
  }

  return false;
}

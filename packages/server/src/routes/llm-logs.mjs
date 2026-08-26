/**
 * LLM Logs API — 查詢所有 LLM 呼叫記錄
 *
 * GET /api/llm-logs           — list recent logs (paginated)
 * GET /api/llm-logs/stats     — aggregate stats (today/total)
 * DELETE /api/llm-logs        — clear logs (before date)
 */

import { readdirSync, readFileSync, unlinkSync, statSync, mkdirSync } from "fs";
import { join, resolve } from "path";

import { DATA_HOME } from "../data-home.mjs";
const LOG_DIR = resolve(DATA_HOME, "logs", "llm");

function ensureLogDir() {
  mkdirSync(LOG_DIR, { recursive: true });
}

/** Auto-cleanup logs older than retentionDays (default 7) */
export function cleanupOldLogs(retentionDays = 7) {
  try {
    const files = readdirSync(LOG_DIR).filter(f => f.endsWith(".jsonl"));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let deleted = 0;
    for (const f of files) {
      const dateStr = f.replace(".jsonl", "");
      if (dateStr < cutoffStr) {
        unlinkSync(join(LOG_DIR, f));
        deleted++;
      }
    }
    if (deleted > 0) console.log(`[llm-logs] Cleaned up ${deleted} files older than ${retentionDays} days (before ${cutoffStr})`);
    return deleted;
  } catch (e) {
    console.error(`[llm-logs] Cleanup error: ${e.message}`);
    return 0;
  }
}

// Ensure dir on module load（purge 交給 log-retention 政策 — cron /api/logs/purge）
ensureLogDir();

/** Infer agentId from caller field for old logs that lack agentId */
function _callerToAgentId(caller) {
  if (!caller) return null;
  const map = {
    "auto-dispatch": "auto-dispatch",
    "tool-engine": "assistant",
    "chat": "assistant",
    "coding": "coding",
    "vibe-fs": "assistant",
    "notes": "assistant",
    "mindmap": "assistant",
    "skill-builder": "skill-builder",
    "vibe-sessions": "assistant",
    "distill": "distill",
    "cron-distill": "cron",
    "overnight": "overnight",
    "a2a": "a2a-server",
    "a2a-helpdesk": "a2a-helpdesk",
  };
  return map[caller] || caller;
}

function parseLogs(dateStr) {
  const logPath = join(LOG_DIR, `${dateStr}.jsonl`);
  try {
    const raw = readFileSync(logPath, "utf-8");
    return raw.split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function parseAllLogs(days = 7) {
  ensureLogDir();
  const files = readdirSync(LOG_DIR).filter(f => f.endsWith(".jsonl")).sort().reverse();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const allLogs = [];
  for (const f of files) {
    const dateStr = f.replace(".jsonl", "");
    if (dateStr < cutoffStr) continue;
    allLogs.push(...parseLogs(dateStr));
  }
  return allLogs;
}

/** Pair request + response logs by id */
function pairLogs(logs) {
  const byId = {};
  for (const log of logs) {
    if (!log.id) continue;
    if (!byId[log.id]) byId[log.id] = { request: null, response: null };
    byId[log.id][log.phase] = log;
  }
  return Object.values(byId)
    .filter(p => p.request)
    .map(p => {
      const toolCalls = p.response?.toolCalls || [];
      const allowedTools = p.request.toolNames || [];
      // Audit: every tool call must be in the allowed tool list
      // If allowedTools is empty (old logs without toolNames), audit is N/A
      const hasAllowList = allowedTools.length > 0;
      const violations = hasAllowList
        ? toolCalls.filter(tc => tc.name && !allowedTools.includes(tc.name))
        : [];
      const auditOk = toolCalls.length === 0 ? null         // no tool calls → N/A
        : !hasAllowList ? null                                // no allow list → N/A
        : violations.length === 0;                            // has list + no violations → true
      const auditViolations = violations.map(v => ({
        tool: v.name,
        reason: `不在允許清單 [${allowedTools.slice(0, 10).join(", ")}${allowedTools.length > 10 ? ", ..." : ""}] 中`,
      }));
      return {
        id: p.request.id,
        ts: p.request.ts,
        agentId: p.request.agentId || p.response?.agentId || _callerToAgentId(p.request.caller || p.response?.caller) || "unknown",
        model: p.request.model || p.response?.model || "?",
        stream: p.request.stream ?? false,
        messageCount: p.request.messageCount ?? 0,
        toolNames: allowedTools,
        durationMs: p.response?.durationMs ?? null,
        finishReason: p.response?.finishReason ?? null,
        contentLen: p.response?.contentLen ?? 0,
        contentPreview: p.response?.contentPreview || "",
        toolCalls,
        auditOk,
        auditViolations,
        auditNA: auditOk === null,
        usage: p.response?.usage || null,
        error: p.response?.error || null,
        caller: p.request.caller || p.response?.caller || null,
      };
    })
    .sort((a, b) => b.ts.localeCompare(a.ts)); // newest first
}

export default async function llmLogsRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;
  // GET /api/llm-logs — list paired logs
  if (url === "/api/llm-logs" && method === "GET") {
    try {
      const days = Math.min(parseInt(q.get("days") || "7", 10), 90);
      const agentFilter = q.get("agent") || null;
      const limit = Math.min(parseInt(q.get("limit") || "200", 10), 1000);
      const offset = parseInt(q.get("offset") || "0", 10);

      const allLogs = parseAllLogs(days);
      const paired = pairLogs(allLogs);

      let filtered = paired;
      if (agentFilter) filtered = filtered.filter(l => l.agentId === agentFilter);

      const total = filtered.length;
      const items = filtered.slice(offset, offset + limit);

      // Compute summary
      const success = filtered.filter(l => !l.error).length;
      const errors = filtered.filter(l => l.error).length;
      const totalDurationMs = filtered.reduce((s, l) => s + (l.durationMs || 0), 0);
      const totalTokens = filtered.reduce((s, l) => s + ((l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0)), 0);
      const totalPromptTokens = filtered.reduce((s, l) => s + (l.usage?.prompt_tokens || 0), 0);
      const totalCompletionTokens = filtered.reduce((s, l) => s + (l.usage?.completion_tokens || 0), 0);

      // By model breakdown
      const byModel = {};
      for (const l of filtered) {
        if (!byModel[l.model]) byModel[l.model] = { count: 0, tokens: 0, errors: 0, durationMs: 0 };
        byModel[l.model].count++;
        byModel[l.model].tokens += (l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0);
        byModel[l.model].errors += l.error ? 1 : 0;
        byModel[l.model].durationMs += l.durationMs || 0;
      }

      // By agent breakdown
      const byAgent = {};
      for (const l of filtered) {
        if (!byAgent[l.agentId]) byAgent[l.agentId] = { count: 0, tokens: 0, errors: 0 };
        byAgent[l.agentId].count++;
        byAgent[l.agentId].tokens += (l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0);
        byAgent[l.agentId].errors += l.error ? 1 : 0;
      }

      // Tool audit summary
      const auditOkCount = filtered.filter(l => l.auditOk === true).length;
      const auditFailCount = filtered.filter(l => l.auditOk === false).length;
      const auditNACount = filtered.filter(l => l.auditOk === null).length;
      const allViolations = filtered.flatMap(l => l.auditViolations || []);
      const violationCounts = {};
      for (const v of allViolations) {
        violationCounts[v.tool] = (violationCounts[v.tool] || 0) + 1;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        items,
        total,
        offset,
        limit,
        days,
        summary: { success, errors, totalDurationMs, totalTokens, totalPromptTokens, totalCompletionTokens, byModel, byAgent, auditOk: auditOkCount, auditFail: auditFailCount, auditNA: auditNACount, violations: violationCounts },
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // GET /api/llm-logs/stats — quick stats
  if (url === "/api/llm-logs/stats" && method === "GET") {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const todayLogs = parseLogs(today);
      const todayPaired = pairLogs(todayLogs);
      const todayTokens = todayPaired.reduce((s, l) => s + ((l.usage?.prompt_tokens || 0) + (l.usage?.completion_tokens || 0)), 0);
      const todayCalls = todayPaired.length;
      const todayErrors = todayPaired.filter(l => l.error).length;

      // Available log dates
      ensureLogDir();
      const dates = readdirSync(LOG_DIR).filter(f => f.endsWith(".jsonl")).map(f => f.replace(".jsonl", "")).sort().reverse();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ today: { calls: todayCalls, errors: todayErrors, tokens: todayTokens }, availableDates: dates }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // DELETE /api/llm-logs — delete logs before a date
  if (url === "/api/llm-logs" && method === "DELETE") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const before = body.before || new Date().toISOString().slice(0, 10);
      ensureLogDir();
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith(".jsonl"));
      let deleted = 0;
      for (const f of files) {
        const dateStr = f.replace(".jsonl", "");
        if (dateStr < before) {
          unlinkSync(join(LOG_DIR, f));
          deleted++;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted, before }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/llm-logs/purge — manually trigger cleanup
  if (url === "/api/llm-logs/purge" && method === "POST") {
    try {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const days = body.days || 7;
      const deleted = cleanupOldLogs(days);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted, retentionDays: days }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false; // not handled
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

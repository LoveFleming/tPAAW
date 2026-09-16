/**
 * Agent Execution Logger
 * 
 * Records every step of an agent task (LLM calls, tool executions, thinking phases)
 * with timestamps and durations for performance analysis.
 * 
 * Storage:
 *   data/agent-logs/{taskId}.jsonl   — full trace per task
 *   data/agent-logs/index.json       — recent task summaries (last 200)
 */

import { mkdir, appendFile, readFile, writeFile, readdir, stat, open } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import { join, resolve, dirname } from "path";
import { DATA_HOME } from "../data-home.mjs";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { stepCostUsd } from "./ru-resolver.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const LOG_DIR = join(DATA_HOME, "logs", "agent");
export const INDEX_FILE = join(LOG_DIR, "index.json");
const MAX_INDEX = 200;

// ── Usage Report Events（2026-09-16 執行報表）──
// append-only、每個完成 task 一行、永不刪（purge/index trim 都不碰這裡）
// 放 report/ 子目錄：cleanupOldAgentLogs 只掃 LOG_DIR 頂層 *.jsonl，不會誤刪
const REPORT_DIR = join(LOG_DIR, "report");
const USAGE_EVENTS_FILE = join(REPORT_DIR, "usage-events.jsonl");

function ensureDir() {
  if (!existsSync(LOG_DIR)) mkdir(LOG_DIR, { recursive: true }).catch(() => {});
}

/**
 * Start a new agent task log.
 * Returns a logger object with step/end methods.
 */
export function startAgentLog(taskInfo) {
  ensureDir();
  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();
  const logFile = join(LOG_DIR, `${taskId}.jsonl`);
  const steps = [];

  const log = (entry) => {
    const line = JSON.stringify({ ...entry, _ts: Date.now() - startTime }) + "\n";
    appendFile(logFile, line).catch(() => {});
  };

  // Log task start
  log({
    phase: "task_start",
    taskInfo: {
      taskId,
      agentId: taskInfo.agentId || "unknown",
      prompt: undefined, // no longer recording prompt
      model: taskInfo.model || "",
      cwd: taskInfo.cwd || "",
      maxTurns: taskInfo.maxTurns || 0,
    },
  });

  return {
    taskId,

    /** Log an LLM call — call before, then llmResult() after */
    llmCall(info) {
      const stepId = `llm-${steps.length}`;
      const stepStart = Date.now();
      steps.push({ id: stepId, type: "llm", start: stepStart, ...info });
      log({ phase: "llm_start", stepId, ...info });
      return {
        done(result) {
          const duration = Date.now() - stepStart;
          const step = { ...steps[steps.length - 1], duration, ...result };
          steps[steps.length - 1] = step;
          log({ phase: "llm_end", stepId, duration, ...result });
          return duration;
        },
      };
    },

    /** Log a tool execution — call before, then toolDone() after */
    toolCall(info) {
      const stepId = `tool-${steps.length}`;
      const stepStart = Date.now();
      steps.push({ id: stepId, type: "tool", start: stepStart, ...info });
      log({ phase: "tool_start", stepId, ...info });
      return {
        done(result) {
          const duration = Date.now() - stepStart;
          const step = { ...steps[steps.length - 1], duration, ...result };
          steps[steps.length - 1] = step;
          log({ phase: "tool_end", stepId, duration, ...result });
          return duration;
        },
      };
    },

    /** Log a thinking/reasoning phase */
    thinking(content) {
      const stepId = `think-${steps.length}`;
      const stepStart = Date.now();
      steps.push({ id: stepId, type: "thinking", start: stepStart, content: (content || "").slice(0, 200) });
      log({ phase: "thinking", stepId, content: (content || "").slice(0, 500) });
      return {
        done() {
          const duration = Date.now() - stepStart;
          steps[steps.length - 1].duration = duration;
          log({ phase: "thinking_end", stepId, duration });
          return duration;
        },
      };
    },

    /** Log an error */
    error(info) {
      log({ phase: "error", ...info });
    },

    /** End the task */
    async end(result) {
      const totalDuration = Date.now() - startTime;

      // ── Accumulate token usage + cost from LLM steps (per model) ──
      const usage = { prompt: 0, completion: 0, total: 0 };
      const byModel = {};
      for (const s of steps) {
        if (s.type !== "llm" || !s.usage) continue;
        const inTok = s.usage.prompt_tokens || 0;
        const outTok = s.usage.completion_tokens || 0;
        usage.prompt += inTok;
        usage.completion += outTok;
        usage.total += (s.usage.total_tokens || (inTok + outTok));
        const modelKey = s.model || taskInfo.model || "unknown";
        if (!byModel[modelKey]) byModel[modelKey] = { model: modelKey, prompt: 0, completion: 0, costUsd: 0 };
        byModel[modelKey].prompt += inTok;
        byModel[modelKey].completion += outTok;
        byModel[modelKey].costUsd += stepCostUsd(modelKey, s.usage);
      }
      const costUsd = Object.values(byModel).reduce((s, m) => s + m.costUsd, 0);

      log({
        phase: "task_end",
        totalDuration,
        turns: result.turns || 0,
        status: result.status || "completed",
        error: result.error || null,
        usage,
        costUsd,
      });

      // Update index
      await _updateIndex({
        taskId,
        agentId: taskInfo.agentId || "unknown",
        prompt: undefined, // no longer recording prompt
        model: taskInfo.model || "",
        cwd: taskInfo.cwd || "",
        startTime: new Date(startTime).toISOString(),
        durationMs: totalDuration,
        turns: result.turns || 0,
        status: result.status || "completed",
        stepCount: steps.length,
        error: result.error || null,
        usage,
        costUsd,
        models: Object.values(byModel),
      });

      // ── 執行報表事件（append-only，永不被 purge）──
      let _ruName = "";
      try { const { resolveRuName } = await import("./ru-resolver.mjs"); _ruName = resolveRuName(taskInfo.cwd); } catch {}
      await _appendUsageEvent({
        taskId,
        agentId: taskInfo.agentId || "unknown",
        ruName: _ruName || "-",
        cwd: taskInfo.cwd || "",
        startTime: new Date(startTime).toISOString(),
        model: taskInfo.model || "",
        turns: result.turns || 0,
        status: result.status || "completed",
        durationMs: totalDuration,
        usage,
        costUsd,
      });

      return { taskId, totalDuration, stepCount: steps.length, usage, costUsd };
    },

    /** Get the step list (for inline return) */
    getSteps() { return steps; },
  };
}

/**
 * Update the index file with a task summary.
 */
async function _updateIndex(entry) {
  let entries = [];
  try {
    const raw = await readFile(INDEX_FILE, "utf-8");
    entries = JSON.parse(raw);
  } catch {}

  // Remove existing entry with same taskId
  entries = entries.filter(e => e.taskId !== entry.taskId);
  
  // Prepend new entry
  entries.unshift(entry);

  // Trim to max
  if (entries.length > MAX_INDEX) {
    // Delete old log files that are beyond the index
    const removed = entries.slice(MAX_INDEX);
    for (const r of removed) {
      try {
        const { unlink } = await import("fs/promises");
        await unlink(join(LOG_DIR, `${r.taskId}.jsonl`));
      } catch {}
    }
    entries = entries.slice(0, MAX_INDEX);
  }

  try {
    await writeFile(INDEX_FILE, JSON.stringify(entries, null, 2), "utf-8");
  } catch (e) {
    console.error("[agent-exec-logger] Failed to update index:", e.message);
  }
}

/**
 * Append one usage event（best-effort，失敗不影響主流程）。
 */
async function _appendUsageEvent(entry) {
  try {
    if (!existsSync(REPORT_DIR)) await mkdir(REPORT_DIR, { recursive: true });
    await appendFile(USAGE_EVENTS_FILE, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    console.error("[agent-exec-logger] usage event append failed:", e.message);
  }
}

let _usageBackfilled = false;

/**
 * Backfill usage-events.jsonl：把現存 index.json + task-*.jsonl 的歷史任務補進事件檔。
 * 冪等（by taskId）；只在每個 process 第一次被叫時跑一次。
 * @returns {number} 補了幾筆
 */
export async function backfillUsageEvents() {
  if (_usageBackfilled) return 0;
  _usageBackfilled = true;
  try {
    let existing = new Set();
    try {
      const raw = await readFile(USAGE_EVENTS_FILE, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { existing.add(JSON.parse(line).taskId); } catch {}
      }
    } catch {}

    const events = [];
    let ruResolver = null;
    try { ruResolver = await import("./ru-resolver.mjs"); } catch {}
    const ruOf = (cwd) => { try { return ruResolver ? ruResolver.resolveRuName(cwd) : (cwd ? String(cwd).split(/[\\/]/).filter(Boolean).pop() || "-" : "-"); } catch { return "-"; } };

    // 1) index.json entries（有完整 summary）
    try {
      const entries = JSON.parse(await readFile(INDEX_FILE, "utf-8"));
      for (const e of entries) {
        if (!e || !e.taskId || existing.has(e.taskId)) continue;
        events.push({
          taskId: e.taskId, agentId: e.agentId || "unknown", ruName: ruOf(e.cwd), cwd: e.cwd || "",
          startTime: e.startTime || "", model: e.model || "", turns: e.turns || 0,
          status: e.status || "completed", durationMs: e.durationMs || 0,
          usage: e.usage || { prompt: 0, completion: 0, total: 0 }, costUsd: e.costUsd || 0,
        });
        existing.add(e.taskId);
      }
    } catch {}

    // 2) task-*.jsonl 檔（含已被 index trim 掉、或 abort 前有 task_end 的）
    try {
      const files = (await readdir(LOG_DIR)).filter(f => /^task-.*\.jsonl$/.test(f));
      for (const f of files) {
        const taskId = f.replace(/\.jsonl$/, "");
        if (existing.has(taskId)) continue;
        const ms = Number(taskId.split("-")[1]);
        if (!Number.isFinite(ms)) continue;
        let start = null, end = null;
        try {
          const rl = createInterface({ input: createReadStream(join(LOG_DIR, f)), crlfDelay: Infinity });
          for await (const line of rl) {
            if (!line.trim()) continue;
            try {
              const o = JSON.parse(line);
              if (o.phase === "task_start" && !start) start = o.taskInfo || {};
              if (o.phase === "task_end") end = o;
            } catch {}
          }
        } catch {}
        if (!start || !end) continue; // 沒跑完的（crash/abort 無 end）跳過 — 無 usage 可記
        events.push({
          taskId, agentId: start.agentId || "unknown", ruName: ruOf(start.cwd), cwd: start.cwd || "",
          startTime: new Date(ms).toISOString(), model: start.model || "", turns: end.turns || 0,
          status: end.status || "completed", durationMs: end.totalDuration || 0,
          usage: end.usage || { prompt: 0, completion: 0, total: 0 }, costUsd: end.costUsd || 0,
        });
        existing.add(taskId);
      }
    } catch {}

    if (events.length > 0) {
      events.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      await _appendUsageEventBulk(events);
    }
    return events.length;
  } catch (e) {
    console.error("[agent-exec-logger] usage backfill failed:", e.message);
    return 0;
  }
}

async function _appendUsageEventBulk(events) {
  if (!existsSync(REPORT_DIR)) await mkdir(REPORT_DIR, { recursive: true });
  await appendFile(USAGE_EVENTS_FILE, events.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");
}

/**
 * Read all usage events（backfill 一次 + 與 live index 合併去重 — 即時跑的任務馬上進報表）。
 * @returns {Promise<Array>} events sorted by startTime asc
 */
export async function getUsageEvents() {
  await backfillUsageEvents();
  const byId = new Map();
  try {
    const raw = await readFile(USAGE_EVENTS_FILE, "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (o.taskId) byId.set(o.taskId, o); } catch {}
    }
  } catch {}
  // live merge：index 有、events 檔沒有（剛結束、append 尚未落盤的邊角）
  let ruResolver = null;
  try { ruResolver = await import("./ru-resolver.mjs"); } catch {}
  try {
    const entries = JSON.parse(await readFile(INDEX_FILE, "utf-8"));
    for (const e of entries) {
      if (!e || !e.taskId || byId.has(e.taskId)) continue;
      let ru = "-";
      try { ru = ruResolver ? ruResolver.resolveRuName(e.cwd) : "-"; } catch {}
      byId.set(e.taskId, {
        taskId: e.taskId, agentId: e.agentId || "unknown", ruName: ru, cwd: e.cwd || "",
        startTime: e.startTime || "", model: e.model || "", turns: e.turns || 0,
        status: e.status || "completed", durationMs: e.durationMs || 0,
        usage: e.usage || { prompt: 0, completion: 0, total: 0 }, costUsd: e.costUsd || 0,
      });
    }
  } catch {}
  return Array.from(byId.values()).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
}

/**
 * Backfill missing cwd in index.json from each task's jsonl (task_start line).
 * 冪等：只補 cwd 缺空的 entries。data/logs 不在 git 裡，每台機器要自己跑一次
 * （server 啟動時自動執行；也可透過 /api/agent-logs/ru-debug?backfill=1 手動觸發）。
 * @returns {number} 補了幾筆
 */
export async function backfillIndexCwd() {
  let entries;
  try { entries = JSON.parse(await readFile(INDEX_FILE, "utf-8")); } catch { return 0; }
  if (!Array.isArray(entries)) return 0;
  let fixed = 0;
  for (const e of entries) {
    if (e.cwd) continue;
    try {
      const fh = await open(join(LOG_DIR, `${e.taskId}.jsonl`), "r");
      try {
        const first = await fh.readFile({ encoding: "utf-8" });
        // 只讀第一行就停（大檔不整讀）
        const line = first.slice(0, first.indexOf("\n"));
        const info = JSON.parse(line)?.taskInfo || {};
        if (info.cwd) { e.cwd = info.cwd; fixed++; }
      } finally { await fh.close(); }
    } catch {}
  }
  if (fixed > 0) {
    try { await writeFile(INDEX_FILE, JSON.stringify(entries, null, 2), "utf-8"); } catch {}
  }
  return fixed;
}

/**
 * List recent agent tasks (from index).
 */
export async function listAgentTasks(limit = 50, filter = {}) {
  try {
    const raw = await readFile(INDEX_FILE, "utf-8");
    let entries = JSON.parse(raw);
    if (filter.agentId) entries = entries.filter(e => e.agentId === filter.agentId);
    if (filter.status) entries = entries.filter(e => e.status === filter.status);
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Accumulate expired task usage into persistent per-RU cost history.
 * data/agent-logs/ru-cost-history.json — purge 後仍保留的成本統計。
 */
async function _accumulateRuCostHistory(expiredEntries) {
  const { resolveRuName } = await import("./ru-resolver.mjs");
  const histFile = join(LOG_DIR, "ru-cost-history.json");
  let hist = {};
  try { hist = JSON.parse(await readFile(histFile, "utf-8")); } catch {}
  for (const e of expiredEntries) {
    const ru = resolveRuName(e.cwd);
    if (!hist[ru]) hist[ru] = { ruName: ru, tasks: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, byModel: {} };
    const h = hist[ru];
    h.tasks += 1;
    h.tokensIn += e.usage?.prompt || 0;
    h.tokensOut += e.usage?.completion || 0;
    h.costUsd += e.costUsd || 0;
    h.durationMs = (h.durationMs || 0) + (e.durationMs || 0); // 2026-09-06：AI 總耗時也進歷史累計
    for (const m of (e.models || [])) {
      if (!h.byModel[m.model]) h.byModel[m.model] = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
      h.byModel[m.model].tokensIn += m.prompt || 0;
      h.byModel[m.model].tokensOut += m.completion || 0;
      h.byModel[m.model].costUsd += m.costUsd || 0;
    }
  }
  await writeFile(histFile, JSON.stringify(hist, null, 2), "utf-8");
}

/**
 * Read persistent per-RU cost history (survives log purge).
 */
export async function getRuCostHistory() {
  const histFile = join(LOG_DIR, "ru-cost-history.json");
  try { return JSON.parse(await readFile(histFile, "utf-8")); } catch { return {}; }
}

/**
 * Get full detail of a specific task (read JSONL file).
 */
export async function getAgentTaskDetail(taskId) {
  const logFile = join(LOG_DIR, `${taskId}.jsonl`);
  if (!existsSync(logFile)) return null;

  const steps = [];
  const rl = createInterface({ input: createReadStream(logFile), crlfDelay: Infinity });
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      steps.push(JSON.parse(line));
    } catch {}
  }

  return { taskId, steps };
}

/**
 * Auto-cleanup old logs (called on server startup).
 */
export async function cleanupOldAgentLogs(retentionDays = 7) {
  try {
    const files = await readdir(LOG_DIR);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const filePath = join(LOG_DIR, f);
      const s = await stat(filePath);
      if (s.mtimeMs < cutoff) {
        const { unlink } = await import("fs/promises");
        await unlink(filePath);
        deleted++;
      }
    }

    // Also clean index entries — 但先把 usage/cost 累計進持久化歷史（避免 7 天後成本統計歸零）
    try {
      const raw = await readFile(INDEX_FILE, "utf-8");
      let entries = JSON.parse(raw);
      const cutoffDate = new Date(cutoff).toISOString();
      const before = entries.length;
      const expired = entries.filter(e => e.startTime <= cutoffDate && (e.usage || e.costUsd));
      if (expired.length > 0) await _accumulateRuCostHistory(expired);
      entries = entries.filter(e => e.startTime > cutoffDate);
      if (entries.length < before) {
        await writeFile(INDEX_FILE, JSON.stringify(entries, null, 2), "utf-8");
      }
    } catch {}

    if (deleted > 0) console.log(`[agent-exec-logger] Cleaned up ${deleted} task logs older than ${retentionDays} days`);
    return deleted;
  } catch (e) {
    console.error("[agent-exec-logger] Cleanup error:", e.message);
    return 0;
  }
}

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

import { mkdir, appendFile, readFile, writeFile, readdir, stat } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function _getRoot() {
  return process.env.PAAW_ROOT || resolve(__dirname, "../../../../");
}

const LOG_DIR = join(_getRoot(), "data", "logs", "agent");
const INDEX_FILE = join(LOG_DIR, "index.json");
const MAX_INDEX = 200;

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
      prompt: (taskInfo.prompt || "").slice(0, 500),
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
      log({
        phase: "task_end",
        totalDuration,
        turns: result.turns || 0,
        status: result.status || "completed",
        error: result.error || null,
      });

      // Update index
      await _updateIndex({
        taskId,
        agentId: taskInfo.agentId || "unknown",
        prompt: (taskInfo.prompt || "").slice(0, 100),
        model: taskInfo.model || "",
        startTime: new Date(startTime).toISOString(),
        durationMs: totalDuration,
        turns: result.turns || 0,
        status: result.status || "completed",
        stepCount: steps.length,
        error: result.error || null,
      });

      return { taskId, totalDuration, stepCount: steps.length };
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

    // Also clean index entries
    try {
      const raw = await readFile(INDEX_FILE, "utf-8");
      let entries = JSON.parse(raw);
      const cutoffDate = new Date(cutoff).toISOString();
      const before = entries.length;
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

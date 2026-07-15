/**
 * Action Log — 跨 agent 動作紀錄（交接簿）
 *
 * 存在 .paaw/coding-memory/actions.jsonl
 * 每條紀錄：誰做了什麼、結果如何、影響哪些檔案
 *
 * Agent 完成 task 後用 action_log_add 寫入
 * Agent dispatch 時透過 contextProviders 讀取
 */

import { appendFile, readFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getActionLogPath(cwd) {
  const root = cwd || resolve(__dirname, "../../../..");
  const dir = join(root, ".paaw", "coding-memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "actions.jsonl");
}

function getAgentMemoryDir(cwd) {
  const root = cwd || resolve(__dirname, "../../../..");
  const dir = join(root, ".paaw", "agent-memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Append an action log entry
 * @param {Object} entry
 * @param {string} entry.agent - agent ID (e.g. "architect", "helpdesk")
 * @param {string} entry.action - action type: review|fix|decide|support|create|refactor
 * @param {string} entry.summary - one-line summary
 * @param {string} [entry.details] - detailed description
 * @param {string[]} [entry.affectedFiles] - files touched
 * @param {string} entry.result - fixed|suggestions|adr|clarified|created
 * @param {string} [entry.priority] - high|medium|low
 * @param {string} [cwd] - project root
 */
export async function addActionLog(entry, cwd) {
  const logPath = getActionLogPath(cwd);
  const record = {
    ts: new Date().toISOString(),
    agent: entry.agent || "unknown",
    action: entry.action || "unknown",
    summary: entry.summary || "",
    details: entry.details || "",
    affectedFiles: entry.affectedFiles || [],
    result: entry.result || "created",
    priority: entry.priority || "medium",
  };
  await appendFile(logPath, JSON.stringify(record) + "\n");
  return record;
}

/**
 * Read action log entries
 * @param {Object} opts
 * @param {string} [opts.cwd] - project root
 * @param {string} [opts.agent] - filter by agent ID
 * @param {string[]} [opts.actions] - filter by action types
 * @param {number} [opts.limit] - max entries (default 20)
 * @param {number} [opts.maxChars] - max total chars (default 4000)
 * @returns {Promise<{ entries: Object[], text: string }>}
 */
export async function listActionLog(opts = {}) {
  const { cwd, agent, actions, limit = 20, maxChars = 4000 } = opts;
  const logPath = getActionLogPath(cwd);

  if (!existsSync(logPath)) return { entries: [], text: "" };

  const raw = await readFile(logPath, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);

  let entries = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      // Filter
      if (agent && record.agent !== agent) continue;
      if (actions && actions.length && !actions.includes(record.action)) continue;
      entries.push(record);
    } catch {}
  }

  // Most recent first
  entries.reverse();
  entries = entries.slice(0, limit);

  // Build compact text for LLM context
  let totalChars = 0;
  const textEntries = [];
  for (const e of entries) {
    const line = `[${e.ts?.slice(11, 16) || "?"}] ${e.agent}/${e.action}: ${e.summary}${e.affectedFiles.length ? " → " + e.affectedFiles.join(", ") : ""} [${e.result}]`;
    if (totalChars + line.length > maxChars) break;
    textEntries.push(line);
    totalChars += line.length;
  }

  return { entries, text: textEntries.join("\n") };
}

/**
 * Save agent long-term memory
 * @param {string} agentId - e.g. "architect", "helpdesk"
 * @param {string} content - markdown content
 * @param {string} [cwd] - project root
 */
export async function saveAgentMemory(agentId, content, cwd) {
  const dir = getAgentMemoryDir(cwd);
  const { writeFile } = await import("fs/promises");
  await writeFile(join(dir, `${agentId}.md`), content, "utf-8");
}

/**
 * Load agent long-term memory
 * @param {string} agentId
 * @param {string} [cwd]
 * @param {number} [maxChars] - max chars to return (default 2000)
 * @returns {Promise<string>}
 */
export async function loadAgentMemory(agentId, cwd, maxChars = 6000) {
  const dir = getAgentMemoryDir(cwd);
  const filePath = join(dir, `${agentId}.md`);
  if (!existsSync(filePath)) return "";
  const { readFile: rf } = await import("fs/promises");
  const content = await rf(filePath, "utf-8");
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n... (truncated)";
}

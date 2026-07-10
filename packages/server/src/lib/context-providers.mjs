/**
 * Context Providers — per-domain context builders
 *
 * 每個 provider 是一個 async function，返回一個 object：
 *   { "標題": "內容", "標題2": "內容2", ... }
 *
 * buildSystemPrompt 會把每個 key-value 展開成 ## 標題\n內容
 *
 * Provider 可以讀：
 *   - .paaw/ 目錄（PROJECT.md, DECISIONS.md, CODING-STANDARDS.md）
 *   - data/helpdesk/（KNOWLEDGE.md）
 *   - 任何 PAAW data 目錄
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../..");

// ── Helpers ──

async function safeRead(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function safeReadTruncated(filePath, maxLen = 8000) {
  const content = await safeRead(filePath);
  if (!content) return null;
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n... (truncated)";
}

// ── Providers ──

/**
 * Project context — .paaw/PROJECT.md + .paaw/CODING-STANDARDS.md
 * 適用：architect, coding agent, test agent
 */
async function projectProvider({ cwd } = {}) {
  const projectRoot = cwd || PAAW_ROOT;
  const paawDir = join(projectRoot, ".paaw");

  const projectMd = await safeReadTruncated(join(paawDir, "PROJECT.md"));
  const standardsMd = await safeReadTruncated(join(paawDir, "CODING-STANDARDS.md"));

  const result = {};
  if (projectMd) result["專案概覽"] = projectMd;
  if (standardsMd) result["編碼規範"] = standardsMd;
  return result;
}

/**
 * Decisions context — .paaw/DECISIONS.md (ADR records)
 * 適用：architect
 */
async function decisionsProvider({ cwd } = {}) {
  const projectRoot = cwd || PAAW_ROOT;
  const paawDir = join(projectRoot, ".paaw");

  const decisionsMd = await safeReadTruncated(join(paawDir, "DECISIONS.md"));
  if (!decisionsMd) return {};
  return { "技術決策記錄 (ADR)": decisionsMd };
}

/**
 * Helpdesk context — knowledge base + recent tickets
 * 適用：helpdesk agent
 */
async function helpdeskProvider() {
  const result = {};

  const knowledge = await safeReadTruncated(join(PAAW_ROOT, "data", "helpdesk", "KNOWLEDGE.md"));
  if (knowledge) result["知識庫"] = knowledge;

  // Recent helpdesk tickets (last 5)
  try {
    const ticketsFile = join(PAAW_ROOT, "data", "helpdesk", "tickets.json");
    const ticketsRaw = await safeRead(ticketsFile);
    if (ticketsRaw) {
      const tickets = JSON.parse(ticketsRaw);
      const recent = tickets.slice(-5).map(t =>
        `- [${t.status}] ${t.subject || t.ticketId} (${t.agentName || "unknown"})`
      ).join("\n");
      if (recent) result["近期 Tickets"] = recent;
    }
  } catch {}

  return result;
}

// ── Export registry ──

export const contextProviders = {
  project: projectProvider,
  decisions: decisionsProvider,
  helpdesk: helpdeskProvider,
};

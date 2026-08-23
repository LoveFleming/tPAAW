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
import { PaawProject } from "./paaw-project.mjs";
import { DATA_HOME } from "../data-home.mjs";

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
  const paaw = new PaawProject(projectRoot);
  const projectMd = await paaw.readFile("PROJECT.md");
  const standardsMd = await paaw.readFile("CODING-STANDARDS.md");

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
  const paaw = new PaawProject(projectRoot);
  const decisionsMd = await paaw.readFile("DECISIONS.md");
  if (!decisionsMd) return {};
  return { "技術決策記錄 (ADR)": decisionsMd };
}

/**
 * Helpdesk context — knowledge base + recent tickets
 * 適用：helpdesk agent
 */
async function helpdeskProvider() {
  const result = {};

  const knowledge = await safeReadTruncated(join(DATA_HOME, "helpdesk", "KNOWLEDGE.md"));
  if (knowledge) result["知識庫"] = knowledge;

  // Recent helpdesk tickets (last 5)
  try {
    const ticketsFile = join(DATA_HOME, "helpdesk", "tickets.json");
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

async function codeIntelligenceProvider({ cwd } = {}) {
  const projectRoot = cwd || PAAW_ROOT;
  const ciDir = join(projectRoot, ".paaw", "code-intelligence");

  if (!existsSync(ciDir)) return {};

  const { readFileSync: readSync } = await import("fs");
  const result = {};

  // 1. File map — compact: path + exports + language
  try {
    const fileMap = JSON.parse(readSync(join(ciDir, "file-map.json"), "utf-8"));
    if (fileMap.files?.length > 0) {
      const lines = ["專案檔案結構（修改前請先 read_file 確認現有內容）：\n"];
      for (const f of fileMap.files) {
        const exports = (f.exports || []).map(e => e.name).filter(Boolean).join(", ");
        const line = exports ? `  ${f.file} → ${exports}` : `  ${f.file}`;
        lines.push(line);
      }
      lines.push("");
      lines.push(`共 ${fileMap.stats?.totalFiles || fileMap.files.length} 個檔案，修改任何檔案前務必先用 read_file 讀取確認。`);
      result["檔案結構 Map"] = lines.join("\n");
    }
  } catch {}

  // 2. Symbol index — compact: name → file mapping
  try {
    const symbolIndex = JSON.parse(readSync(join(ciDir, "symbol-index.json"), "utf-8"));
    if (symbolIndex.byName) {
      const important = [];
      for (const [name, entries] of Object.entries(symbolIndex.byName)) {
        for (const entry of entries) {
          if (entry.type === "route" || entry.type === "component" || entry.kind === "class") {
            important.push(`  ${name} (${entry.type}/${entry.kind}) → ${entry.file}`);
          }
        }
      }
      if (important.length > 0) {
        const lines = ["重要 Symbol 索引（找函式/元件在哪個檔案）：\n"];
        lines.push(...important.slice(0, 100));
        lines.push("");
        lines.push(`共 ${symbolIndex.stats?.total || 0} 個 symbol，上面列出 routes/components/classes。其他用 grep 搜尋。`);
        result["Symbol 索引"] = lines.join("\n");
      }
    }
  } catch {}

  // 3. API routes (from api-function-map)
  try {
    const apiMap = JSON.parse(readSync(join(ciDir, "api-function-map.json"), "utf-8"));
    if (apiMap.routes?.length > 0) {
      const lines = ["API 路由表：\n"];
      for (const r of apiMap.routes) {
        const handler = r.handlerFile ? ` → ${r.handlerFile}` : "";
        lines.push(`  ${r.method} ${r.path}${handler}`);
      }
      result["API 路由表"] = lines.join("\n");
    }
  } catch {}

  return result;
}

// ── Export registry ──

export const contextProviders = {
  project: projectProvider,
  decisions: decisionsProvider,
  helpdesk: helpdeskProvider,
  codeIntelligence: codeIntelligenceProvider,
};

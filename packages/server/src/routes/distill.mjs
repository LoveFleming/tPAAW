/**
 * Memory Distillation Engine — 記憶蒸餾引擎
 *
 * Pipeline: Collectors → Registry → Distillers → Knowledge Store
 *
 * Collectors: 各種記錄來源 (chat, vibe, cron, manual, future: email, git...)
 * Registry:   統一管理所有 raw logs (JSONL per day per source)
 * Distillers: 用 LLM 精煉 raw logs → structured knowledge (markdown)
 * Store:      寫入 knowledge/ 目錄，供 Knowledge Tree / 搜尋使用
 *
 * API:
 *   GET  /api/distill/config           — 取得設定 + 統計
 *   PUT  /api/distill/config           — 更新設定
 *   POST /api/distill/run              — 手動觸發蒸餾
 *   POST /api/distill/run/:source      — 只蒸餾特定來源
 *   GET  /api/distill/sources          — 列出所有 collector 來源
 *   GET  /api/distill/logs             — 列出 raw log 檔案
 *   GET  /api/distill/logs/:file       — 讀取特定 raw log
 *   GET  /api/distill/knowledge        — 列出已蒸餾的知識
 *   GET  /api/distill/knowledge/:file  — 讀取特定知識
 *   DELETE /api/distill/logs/:file     — 刪除 raw log
 *   DELETE /api/distill/knowledge/:file — 刪除知識
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, statSync, unlinkSync } from "fs";
import { readdir, readFile, writeFile, mkdir, unlink, stat } from "fs/promises";
import { resolve, join } from "path";
import { PATHS, readBody, json, urlPath } from "./context.mjs";

// ── Paths ──
const PAAW_ROOT = PATHS.PAAW_ROOT;
const DISTILL_DIR     = resolve(PAAW_ROOT, "data/distill");
const RAW_DIR         = resolve(DISTILL_DIR, "raw");
const KNOWLEDGE_DIR   = resolve(DISTILL_DIR, "knowledge");
const CONFIG_FILE     = resolve(DISTILL_DIR, "config.json");
const PROVIDERS_FILE  = resolve(PAAW_ROOT, "data/config/providers.json");
const CHAT_DIR        = PATHS.CHAT_DIR;
const VIBE_DIR        = resolve(PAAW_ROOT, "logs/vibe-sessions");
const DISTILL_SETTINGS_DIR = resolve(PAAW_ROOT, "data/ai-settings/distill");

// ── Read distill system prompt from AI settings ──
function safeReadDistillPrompt() {
  try { return readFileSync(resolve(DISTILL_SETTINGS_DIR, "system-prompt.md"), "utf-8"); } catch { return ""; }
}

// ── Default Config ──
// Per-source distill prompts are loaded from data/ai-settings/distill/{source}.md
// Fallback to inline defaults if file doesn't exist
const DISTILL_PROMPTS_DIR = resolve(PAAW_ROOT, "data/ai-settings/distill");

function loadDistillPrompt(source) {
  // Load from data/ai-settings/distill/{source}.md
  try { return readFileSync(resolve(DISTILL_PROMPTS_DIR, `${source}.md`), "utf-8").trim(); } catch {}
  // Fallback: generic distill prompt
  return `請分析以下紀錄，精煉出：\n1. **任務摘要**\n2. **關鍵決策**\n3. **技術要點**\n4. **問題與解法**\n5. **成果**\n6. **可復用模式**\n\n用 Markdown 格式輸出。`;
}

const DEFAULT_CONFIG = {
  enabled: true,
  autoDistill: true,
  autoDistillSchedule: "0 2 * * *",   // daily at 2am
  keepRawDays: 30,
  maxLogSizeForLLM: 50000,
  sources: {
    chat:       { enabled: true, label: "💬 Chat 對話", description: "記錄所有跟 Chat AI 的對話", color: "#3B82F6", maxEntriesPerDistill: 100 },
    vibe:       { enabled: true, label: "⚡ Coding CLI", description: "記錄 AI CLI 終端機的輸出", color: "#8B5CF6", maxEntriesPerDistill: 50 },
    cron:       { enabled: true, label: "⏰ Cron 執行紀錄", description: "記錄排程任務的執行結果", color: "#F59E0B", maxEntriesPerDistill: 200 },
    "vibe-coding": { enabled: true, label: "💻 Coding IDE", description: "記錄 IDE 中的 coding 行為", color: "#8B5CF6", maxEntriesPerDistill: 300 },
  },
};

// ── Config Management ──
export function loadConfig() {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf8");
    return deepMerge(structuredClone(DEFAULT_CONFIG), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig(cfg) {
  mkdirSync(resolve(CONFIG_FILE, ".."), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ── Collector: Record a raw interaction ──
export function record(source, data) {
  const config = loadConfig();
  if (!config.enabled) return;
  // Allow known sources with enabled check, AND unknown sources (always record)
  if (config.sources[source] !== undefined && !config.sources[source]?.enabled) return;

  mkdirSync(resolve(RAW_DIR, source), { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const ts = new Date().toISOString();
  const entry = { ts, ...data };
  const logFile = resolve(RAW_DIR, source, `${dateStr}.jsonl`);
  appendFileSync(logFile, JSON.stringify(entry) + "\n");
}

// ── Collector: Record chat interaction (called from chat.mjs) ──
export function recordChatInteraction({ user, assistant, model, provider, tools }) {
  record("chat", {
    user: typeof user === "string" ? user.slice(0, 1000) : JSON.stringify(user).slice(0, 1000),
    assistant: String(assistant || "").slice(0, 3000),
    model: model || "",
    provider: provider || "",
    tools: tools || [],
  });
}

// ── Collector: Record vibe coding output ──
export function recordVibeOutput({ sessionId, cli, cwd, output }) {
  record("vibe", {
    sessionId,
    cli: cli || "unknown",
    cwd: cwd || "",
    output: String(output || "").slice(0, 5000),
  });
}

// ── Collector: Record cron execution ──
export function recordCronExecution({ jobName, success, result, duration }) {
  record("cron", {
    jobName,
    success: !!success,
    result: String(result || "").slice(0, 2000),
    duration: duration || 0,
  });
}

// ── LLM Call Helper (with retry + sanitize) ──
import { callLLMWithRetry, isMeaningfulContent } from "../lib/llm-utils.mjs";

async function callLLM(systemPrompt, userPrompt, maxTokens = 4096, modelOverride) {
  try {
    const providerConfig = JSON.parse(readFileSync(PROVIDERS_FILE, "utf8"));
    let providerId = providerConfig.active;
    let model = modelOverride || providerConfig.defaultModel || "glm-5.1";
    // Parse "providerId/modelId" format
    if (modelOverride && modelOverride.includes("/")) {
      const [pid, mid] = modelOverride.split("/", 2);
      providerId = pid;
      model = mid;
    }
    const provider = providerConfig.providers[providerId];
    if (!provider?.apiKey || provider.apiKey === "na") {
      console.error("[distill] No API key configured");
      return null;
    }

    const apiUrl = `${provider.baseURL.replace(/\/+$/, "")}/chat/completions`;

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(providerId === "openrouter" ? { "HTTP-Referer": "https://paaw.ai", "X-Title": "PAAW" } : {}),
    };

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
    };

    const result = await callLLMWithRetry(apiUrl, headers, body, {
      maxRetries: 3,
      timeoutMs: 60_000,
      validateContent: true,
      sanitize: true,
    });

    if (!isMeaningfulContent(result.content)) {
      console.error(`[distill] LLM returned empty/whitespace content after ${result.attempts} attempts`);
      return null;
    }
    return result.content;
  } catch (err) {
    console.error(`[distill] LLM call failed after retries: ${err.message}`);
  }
  return null;
}

// ── Build content from raw entries ──
function buildContentFromEntries(source, entries) {
  let content = "";
  for (const e of entries) {
    switch (source) {
      case "chat":
        content += `## 💬 Chat (${e.ts})\n`;
        if (e.user) content += `**User:** ${e.user}\n\n`;
        if (e.assistant) content += `**Assistant:** ${e.assistant}\n\n`;
        if (e.model) content += `**Model:** ${e.model}\n`;
        if (e.tools?.length) content += `**Tools:** ${e.tools.join(", ")}\n`;
        content += "\n";
        break;
      case "vibe":
        content += `## ⚡ Coding CLI (${e.ts})\n`;
        content += `CLI: ${e.cli} | CWD: ${e.cwd}\n\n`;
        content += `\`\`\`\n${e.output}\n\`\`\`\n\n`;
        break;
      case "cron":
        content += `## ⏰ Cron (${e.ts})\n`;
        content += `Job: ${e.jobName} | ${e.success ? "✅" : "❌"} | ${e.duration}ms\n`;
        if (e.result) content += `Result: ${e.result}\n`;
        content += "\n";
        break;
      default:
        content += `## ${source} (${e.ts})\n${JSON.stringify(e, null, 2)}\n\n`;
    }
  }
  return content;
}

// ── Distill: Process raw logs for a source on a date ──
async function distillSourceDate(source, dateStr, config, modelOverride) {
  const sourceConfig = config.sources[source];
  if (!sourceConfig) return null;

  const logFile = resolve(RAW_DIR, source, `${dateStr}.jsonl`);
  if (!existsSync(logFile)) return null;

  const raw = readFileSync(logFile, "utf8").trim();
  if (!raw) return null;

  const entries = raw.split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (entries.length === 0) return null;

  console.log(`[distill] ${source}/${dateStr}: ${entries.length} entries`);

  // Build content
  const capped = entries.slice(-(sourceConfig.maxEntriesPerDistill || 100));
  let content = `# ${sourceConfig.label} 紀錄 — ${dateStr}\n\n`;
  content += buildContentFromEntries(source, capped);

  // Trim to max size
  if (content.length > (config.maxLogSizeForLLM || 50000)) {
    content = content.slice(0, config.maxLogSizeForLLM || 50000) + "\n\n... (截斷)";
  }

  // Call LLM — build full system context (knowledge + workspace + distill prompt)
  let distillSystemPrompt = loadDistillPrompt(source);
  try {
    const distillBase = safeReadDistillPrompt();
    if (distillBase) distillSystemPrompt = distillBase + "\n\n" + distillSystemPrompt;
  } catch {}
  // Prepend base context (knowledge paths + workspace dirs)
  try {
    const { contextEngine } = await import("../context-engine.mjs");
    const ctx = await contextEngine.build({ target: "distill" });
    if (ctx.systemPrompt) distillSystemPrompt = ctx.systemPrompt + "\n\n" + distillSystemPrompt;
  } catch {}

  const distilled = await callLLM(
    distillSystemPrompt,
    `以下是一天的紀錄，請蒸餾成知識：\n\n${content}`,
    4096,
    modelOverride,
  );

  // Build result markdown
  const header = `# ${sourceConfig.label} — ${dateStr}\n\n` +
    `> 📊 原始紀錄 ${entries.length} 筆 | 蒸餾時間: ${new Date().toISOString()}\n\n---\n\n`;

  const md = distilled
    ? header + distilled
    : header + `> ⚠️ 蒸餾失敗，保留摘要\n\n${content.slice(0, 3000)}`;

  // Save to knowledge
  mkdirSync(resolve(KNOWLEDGE_DIR, source), { recursive: true });
  const outFile = resolve(KNOWLEDGE_DIR, source, `${dateStr}.md`);
  writeFileSync(outFile, md);
  console.log(`[distill] Saved: ${outFile} (${md.length} chars)`);

  return { source, date: dateStr, entries: entries.length, chars: md.length, file: outFile };
}

// ── Distill All: Process all unprocessed logs ──
export async function distillAll(sourceFilter, modelOverride) {
  const config = loadConfig();
  if (!config.enabled) return { error: "Distillation is disabled" };

  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(KNOWLEDGE_DIR, { recursive: true });

  const results = [];
  const sources = sourceFilter ? [sourceFilter] : Object.keys(config.sources).filter(s => config.sources[s]?.enabled);

  for (const source of sources) {
    const sourceDir = resolve(RAW_DIR, source);
    if (!existsSync(sourceDir)) continue;

    const files = readdirSync(sourceDir).filter(f => f.endsWith(".jsonl")).sort();

    for (const file of files) {
      const dateStr = file.replace(".jsonl", "");

      // Skip if already distilled
      const outFile = resolve(KNOWLEDGE_DIR, source, `${dateStr}.md`);
      if (existsSync(outFile)) continue;

      const result = await distillSourceDate(source, dateStr, config, modelOverride);
      if (result) results.push(result);
    }
  }

  return results;
}

// ── Stats ──
function getStats() {
  const config = loadConfig();
  const stats = { sources: {}, totalRawEntries: 0, totalRawSize: 0, totalKnowledgeFiles: 0 };

  for (const source of Object.keys(config.sources)) {
    const sourceDir = resolve(RAW_DIR, source);
    const knowledgeDir = resolve(KNOWLEDGE_DIR, source);
    let rawFiles = 0, rawEntries = 0, rawSize = 0, knowledgeFiles = 0;

    if (existsSync(sourceDir)) {
      const files = readdirSync(sourceDir).filter(f => f.endsWith(".jsonl"));
      rawFiles = files.length;
      for (const f of files) {
        try {
          rawSize += statSync(resolve(sourceDir, f)).size;
          rawEntries += readFileSync(resolve(sourceDir, f), "utf8").trim().split("\n").filter(Boolean).length;
        } catch {}
      }
    }

    if (existsSync(knowledgeDir)) {
      knowledgeFiles = readdirSync(knowledgeDir).filter(f => f.endsWith(".md")).length;
    }

    stats.sources[source] = { rawFiles, rawEntries, rawSize, knowledgeFiles };
    stats.totalRawEntries += rawEntries;
    stats.totalRawSize += rawSize;
    stats.totalKnowledgeFiles += knowledgeFiles;
  }

  return stats;
}

// ── HTTP Router ──
export default async function distillRouter(req, res) {
  const path = urlPath(req);
  const method = req.method;

  // GET /api/distill/config
  if (method === "GET" && path === "/api/distill/config") {
    const config = loadConfig();
    return json(res, { ...config, stats: getStats() });
  }

  // PUT /api/distill/config
  if (method === "PUT" && path === "/api/distill/config") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: "Invalid JSON" }, 400); }
    const current = loadConfig();
    const updated = deepMerge(current, body);
    saveConfig(updated);
    return json(res, updated);
  }

  // GET /api/distill/sources
  if (method === "GET" && path === "/api/distill/sources") {
    const config = loadConfig();
    return json(res, config.sources);
  }

  // POST /api/distill/run — distill all
  if (method === "POST" && path === "/api/distill/run") {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const results = await distillAll(null, body.model);
    return json(res, { ok: true, results });
  }

  // POST /api/distill/run/:source — distill specific source
  const runSourceMatch = path.match(/^\/api\/distill\/run\/([\w-]+)$/);
  if (method === "POST" && runSourceMatch) {
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    const results = await distillAll(runSourceMatch[1], body.model);
    return json(res, { ok: true, results });
  }

  // GET /api/distill/logs — list all raw logs
  if (method === "GET" && path === "/api/distill/logs") {
    const config = loadConfig();
    const logs = [];
    for (const source of Object.keys(config.sources)) {
      const sourceDir = resolve(RAW_DIR, source);
      if (!existsSync(sourceDir)) continue;
      for (const f of readdirSync(sourceDir).filter(f => f.endsWith(".jsonl")).sort()) {
        try {
          const s = statSync(resolve(sourceDir, f));
          const entries = readFileSync(resolve(sourceDir, f), "utf8").trim().split("\n").filter(Boolean).length;
          logs.push({ source, file: f, date: f.replace(".jsonl", ""), size: s.size, entries, modified: s.mtime.toISOString() });
        } catch {}
      }
    }
    return json(res, logs);
  }

  // GET /api/distill/logs/:source/:file — read raw log
  const logFileMatch = path.match(/^\/api\/distill\/logs\/([\w-]+)\/([\w.-]+)$/);
  if (method === "GET" && logFileMatch) {
    const [, source, file] = logFileMatch;
    const logPath = resolve(RAW_DIR, source, file);
    if (!existsSync(logPath)) return json(res, { error: "Not found" }, 404);
    try {
      const raw = readFileSync(logPath, "utf8");
      const entries = raw.trim().split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return json(res, { source, file, entries, count: entries.length });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // DELETE /api/distill/logs/:source/:file
  const logDelMatch = path.match(/^\/api\/distill\/logs\/([\w-]+)\/([\w.-]+)$/);
  if (method === "DELETE" && logDelMatch) {
    const [, source, file] = logDelMatch;
    try { unlinkSync(resolve(RAW_DIR, source, file)); } catch {}
    return json(res, { ok: true });
  }

  // GET /api/distill/knowledge — list all distilled knowledge
  if (method === "GET" && path === "/api/distill/knowledge") {
    const config = loadConfig();
    const knowledge = [];
    for (const source of Object.keys(config.sources)) {
      const kDir = resolve(KNOWLEDGE_DIR, source);
      if (!existsSync(kDir)) continue;
      for (const f of readdirSync(kDir).filter(f => f.endsWith(".md")).sort()) {
        try {
          const s = statSync(resolve(kDir, f));
          const preview = readFileSync(resolve(kDir, f), "utf8").slice(0, 200);
          knowledge.push({ source, file: f, date: f.replace(".md", ""), size: s.size, preview, modified: s.mtime.toISOString() });
        } catch {}
      }
    }
    return json(res, knowledge);
  }

  // GET /api/distill/knowledge/:source/:file — read knowledge
  const kFileMatch = path.match(/^\/api\/distill\/knowledge\/([\w-]+)\/([\w.-]+)$/);
  if (method === "GET" && kFileMatch) {
    const [, source, file] = kFileMatch;
    const kPath = resolve(KNOWLEDGE_DIR, source, file);
    if (!existsSync(kPath)) return json(res, { error: "Not found" }, 404);
    try {
      const content = readFileSync(kPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(content);
      return true;
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  // DELETE /api/distill/knowledge/:source/:file
  const kDelMatch = path.match(/^\/api\/distill\/knowledge\/([\w-]+)\/([\w.-]+)$/);
  if (method === "DELETE" && kDelMatch) {
    const [, source, file] = kDelMatch;
    try { unlinkSync(resolve(KNOWLEDGE_DIR, source, file)); } catch {}
    return json(res, { ok: true });
  }

  // POST /api/distill/record — manually record an interaction
  if (method === "POST" && path === "/api/distill/record") {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, { error: "Invalid JSON" }, 400); }
    const { source: src, ...data } = body;
    if (!src) return json(res, { error: "Missing source" }, 400);
    record(src, data);
    return json(res, { ok: true });
  }

  return false; // not handled
}

// ── Simple cron matcher (same as paaw-server) ──
export function matchesCron(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mMin, mHour, mDay, mMon, mDow] = parts;
  const check = (val, spec) => {
    if (spec === "*") return true;
    for (const s of spec.split(",")) {
      if (s.includes("-")) {
        const [lo, hi] = s.split("-").map(Number);
        if (val >= lo && val <= hi) return true;
      } else if (parseInt(s) === val) return true;
    }
    return false;
  };
  return check(date.getMinutes(), mMin) && check(date.getHours(), mHour) && check(date.getDate(), mDay) && check(date.getMonth() + 1, mMon) && check(date.getDay(), mDow);
}

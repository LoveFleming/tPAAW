/**
 * Log Retention API — 日誌保留政策（Fleming 政策：LLM + Agent 紀錄一年、其餘 7 天）
 *
 * GET  /api/logs/retention — 讀保留設定
 * PUT  /api/logs/retention — 寫設定（llmDays / agentDays / otherDays）
 * POST /api/logs/purge     — 依政策立即清理（每日 cron system-daily-log-purge 也打這）
 *
 * 涵蓋（全在 DATA_HOME/logs 下 — 跨版本留存）：
 *   llm/*.jsonl    → llmDays（檔名日期比對）
 *   agent/*.jsonl  → agentDays（mtime）
 *   其他子目錄（cli、cron…）→ otherDays（mtime 遞迴）
 */

import { readFile, writeFile, mkdir, readdir, stat, unlink, rmdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join } from "path";
import { readBody } from "./shared.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { cleanupOldLogs } from "./llm-logs.mjs";
import { cleanupOldAgentLogs } from "../lib/agent-exec-logger.mjs";

const CONFIG_FILE = resolve(DATA_HOME, "config/log-retention.json");
const LOGS_ROOT = resolve(DATA_HOME, "logs");
const DEFAULTS = { llmDays: 365, agentDays: 365, otherDays: 7 };

async function loadRetention() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_FILE, "utf-8"));
    return {
      llmDays: Number(raw.llmDays) || DEFAULTS.llmDays,
      agentDays: Number(raw.agentDays) || DEFAULTS.agentDays,
      otherDays: Number(raw.otherDays) || DEFAULTS.otherDays,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

async function saveRetention(cfg) {
  await mkdir(resolve(CONFIG_FILE, ".."), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8");
}

/** 遞迴刪 mtime 超過 days 的檔案；清完的空目錄一併移除 */
async function purgeDirByMtime(dir, days) {
  let deleted = 0;
  if (!existsSync(dir)) return deleted;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  async function walk(d) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) {
        await walk(full);
        try { await rmdir(full); } catch { /* 非空保留 */ }
      } else {
        try {
          const s = await stat(full);
          if (s.mtimeMs < cutoff) { await unlink(full); deleted++; }
        } catch { /* 檔案消失就算了 */ }
      }
    }
  }
  await walk(dir);
  return deleted;
}

/** DATA_HOME/logs 下 llm/agent 以外的子目錄 + 頂層散檔 */
async function purgeOtherLogs(days) {
  let deleted = 0;
  if (!existsSync(LOGS_ROOT)) return deleted;
  const entries = await readdir(LOGS_ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "llm" || e.name === "agent") continue;
    const full = join(LOGS_ROOT, e.name);
    if (e.isDirectory()) {
      deleted += await purgeDirByMtime(full, days);
    } else {
      try {
        const s = await stat(full);
        if (s.mtimeMs < Date.now() - days * 24 * 60 * 60 * 1000) { await unlink(full); deleted++; }
      } catch {}
    }
  }
  return deleted;
}

export async function runLogPurge() {
  const cfg = await loadRetention();
  const llmDeleted = cleanupOldLogs(cfg.llmDays);
  const agentDeleted = await cleanupOldAgentLogs(cfg.agentDays);
  const otherDeleted = await purgeOtherLogs(cfg.otherDays);
  return { cfg, llmDeleted, agentDeleted, otherDeleted };
}

export default async function logRetentionRoutes(req, res) {
  const method = req.method;
  const url = (req.url || "").split("?")[0];
  const jsonOut = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (url === "/api/logs/retention" && method === "GET") {
    jsonOut(200, { retention: await loadRetention() });
    return true;
  }

  if (url === "/api/logs/retention" && method === "PUT") {
    try {
      const body = JSON.parse(await readBody(req));
      const cfg = await loadRetention();
      for (const k of ["llmDays", "agentDays", "otherDays"]) {
        if (body[k] !== undefined) {
          const n = Math.floor(Number(body[k]));
          if (!Number.isFinite(n) || n < 1 || n > 3650) return jsonOut(400, { error: `${k} must be 1-3650` }), true;
          cfg[k] = n;
        }
      }
      await saveRetention(cfg);
      jsonOut(200, { ok: true, retention: cfg });
    } catch (err) {
      jsonOut(500, { error: err.message });
    }
    return true;
  }

  if (url === "/api/logs/purge" && method === "POST") {
    try {
      const r = await runLogPurge();
      jsonOut(200, {
        ok: true,
        retention: r.cfg,
        deleted: r.llmDeleted + r.agentDeleted + r.otherDeleted,
        detail: { llm: r.llmDeleted, agent: r.agentDeleted, other: r.otherDeleted },
      });
    } catch (err) {
      jsonOut(500, { error: err.message });
    }
    return true;
  }

  return false;
}

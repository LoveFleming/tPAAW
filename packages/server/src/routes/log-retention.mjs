/**
 * Log Retention API — 日誌保留政策
 * Fleming 2026-09-06 定調（推翻 8 月的留一年）：
 *   LLM 呼叫記錄 + agent 執行記錄是成本核算資產（RU 用了多少 token）→ 永不刪（days=0）
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
import { DATA_HOME, LOG_HOME } from "../data-home.mjs";
import { cleanupOldLogs } from "./llm-logs.mjs";
import { cleanupOldAgentLogs } from "../lib/agent-exec-logger.mjs";

const CONFIG_FILE = resolve(DATA_HOME, "config/log-retention.json");
const LOGS_ROOT = resolve(DATA_HOME, "logs"); // 資產級記錄（llm/agent — 永不刪）
// runtime log 根（2026-09-06 架構：log/ = 純垃圾桶，data/logs 只剩資產）
const RUNTIME_LOG_ROOT = LOG_HOME;
const DEFAULTS = { llmDays: 0, agentDays: 0, otherDays: 7 }; // 0 = 永不刪（成本核算資產）

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
/** runtime log（LOG_HOME/）purge — 跳過 janitor 管理區 + 活檔 */
const JANITOR_MANAGED = new Set([
  "llm", "agent",              // 資產級（不在 log/ 但防呆）
  "tmp", "cache",              // session/janitor 管
  "semgrep", "app-console", "versions", // janitor per-RU 組數管理
  "server-console.log", "server-console.log.old", // tee 活檔（5MB 自輪替）
]);

async function purgeOtherLogs(days) {
  let deleted = 0;
  if (!existsSync(RUNTIME_LOG_ROOT)) return deleted;
  const entries = await readdir(RUNTIME_LOG_ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (JANITOR_MANAGED.has(e.name)) continue;
    const full = join(RUNTIME_LOG_ROOT, e.name);
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

/** llm/*.jsonl 依「明確日期」purge（Fleming 2026-09-06：留一年，用 API by 日期 purge）
 *  before = "YYYY-MM-DD" → 檔名日期 < before 的全刪（不受 llmDays 政策限制） */
async function purgeLlmBefore(before) {
  const llmDir = join(LOGS_ROOT, "llm");
  let deleted = 0;
  if (!existsSync(llmDir) || !/^\d{4}-\d{2}-\d{2}$/.test(before)) return deleted;
  const files = await readdir(llmDir).catch(() => []);
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (m && m[1] < before) {
      try { await unlink(join(llmDir, f)); deleted++; } catch {}
    }
  }
  return deleted;
}

export async function runLogPurge(options = {}) {
  const cfg = await loadRetention();
  let llmDeleted = 0;
  if (options.before) {
    llmDeleted = await purgeLlmBefore(options.before); // 明確日期 > 政策（人為主動）
  } else if (cfg.llmDays > 0) {
    llmDeleted = cleanupOldLogs(cfg.llmDays);          // 0 = 永不刪（成本核算資產）
  }
  const agentDeleted = cfg.agentDays > 0 ? await cleanupOldAgentLogs(cfg.agentDays) : 0;
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
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { body = {}; }
      const r = await runLogPurge(body.before ? { before: String(body.before) } : {});
      // Janitor：per-RU runtime 垃圾（semgrep/app-console/versions/uploads）— 2026-09-06
      let janitor = null;
      try {
        const { runJanitor } = await import("../lib/janitor.mjs");
        janitor = await runJanitor();
      } catch (err) { janitor = { error: err.message }; }
      jsonOut(200, {
        ok: true,
        retention: r.cfg,
        deleted: r.llmDeleted + r.agentDeleted + r.otherDeleted,
        detail: { llm: r.llmDeleted, agent: r.agentDeleted, other: r.otherDeleted },
        janitor,
      });
    } catch (err) {
      jsonOut(500, { error: err.message });
    }
    return true;
  }

  return false;
}

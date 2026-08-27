/**
 * PAAW Server — Slim Entry Point
 *
 * All route logic lives in ./routes/*.mjs modules.
 * WebSocket lives in ./websocket/ws-handler.mjs.
 * Cron/scheduler lives in ./scheduler/cron-jobs.mjs.
 *
 * Original: 4620 lines (monolith)
 * Refactored: ~120 lines (dispatch + listen)
 */

import "./lib/epipe-guard.mjs"; // EPIPE 防護 — 必須第一個 import（ESM import 先於 module body 執行）
import { createServer } from "http";
import { appendFileSync, mkdirSync } from "fs";
import {
  PORT, PAAW_ROOT,
  readdir, readFile, writeFile, mkdir,
  resolve, dirname, join,
} from "./routes/shared.mjs";
import { setupWebSocket } from "./websocket/ws-handler.mjs";
import { DATA_HOME } from "./data-home.mjs";

// ── Process-level crash protection ──
// Node 15+ terminates on unhandledRejection by default.
// These handlers LOG the error + write crash log to disk,
// preventing "整個 server 當掉" from a single stray async error.
// （EPIPE 防護在 lib/epipe-guard.mjs，第一個 import）
const _crashWriteLast = new Map(); // error signature → last write ts（防風暴寫爆磁碟）
function _writeCrashLog(kind, detail) {
  try {
    const ts = new Date().toISOString();
    const sig = `${kind}:${String(detail).slice(0, 200)}`;
    if (Date.now() - (_crashWriteLast.get(sig) || 0) < 5000) return; // 同簽名 5 秒內只寫一筆
    _crashWriteLast.set(sig, Date.now());
    const crashDir = join(DATA_HOME, "logs", "crash");
    mkdirSync(crashDir, { recursive: true });
    appendFileSync(join(crashDir, `crash-${ts.replace(/[:.]/g, "-")}.log`),
      `[${kind}] ${ts}\n${detail}\n\n`);
  } catch { /* best effort */ }
}
process.on('unhandledRejection', (reason, promise) => {
  try { console.error(`🚨 [PAAW] UNHANDLED REJECTION — server stays alive:`, reason); } catch {}
  _writeCrashLog('UNHANDLED REJECTION', reason?.stack || String(reason));
});
process.on('uncaughtException', (err) => {
  try { console.error(`🚨 [PAAW] UNCAUGHT EXCEPTION — server stays alive:`, err?.stack || err); } catch {}
  _writeCrashLog('UNCAUGHT EXCEPTION', err?.stack || String(err));
});

// ── Startup import check — catch missing exports (runs in background) ──
import("./lib/import-check.mjs").catch(() => {}); // non-blocking, best-effort

// ── Backfill agent-logs index cwd（data/logs 不連 git，每台機器首次啟動要自救一次）──
import("./lib/agent-exec-logger.mjs").then(m => m.backfillIndexCwd?.())
  .then(n => { if (n > 0) console.log(`[agent-logs] backfilled cwd for ${n} entries`); })
  .catch(() => {});

// ── Start bridge AFTER .env is loaded (shared.mjs already loaded via static import) ──
// Bridge no longer auto-listens on import; we start it explicitly here.
const shouldStartBridge = process.env.BRIDGE_PORT && process.env.BRIDGE_PORT !== "0";
if (shouldStartBridge) {
  import("./lib/bridge/paaw-bridge.mjs").then(mod => {
    mod.startBridge();
  }).catch(err => {
    console.warn("[PAAW] Bridge failed to start:", err.message);
  });
}

// ── Lazy-loaded route modules (existing) ──
const ROUTE_MODULES = [
  "./routes/skill.mjs",
  "./routes/ai-settings.mjs",
  "./routes/workflow.mjs",
  "./routes/chat.mjs",
  "./routes/distill.mjs",
  // ── New modules (split from monolith) ──
  "./routes/vibe-fs.mjs",
  "./routes/vibe-sessions.mjs",
  "./routes/api-tester.mjs",
  "./routes/skills-api.mjs",
  "./routes/apps.mjs",
  "./routes/crew.mjs",
  "./routes/assistant.mjs",
  "./routes/pocket.mjs",
  "./routes/mindmap.mjs",
  "./routes/notes.mjs",
  "./routes/backup.mjs",
  "./routes/projects.mjs",
  "./routes/a2a.mjs",
  "./routes/helpdesk.mjs",
  "./routes/coding.mjs",
  "./routes/coding-issues.mjs",
  "./routes/coding-tasks.mjs",
  "./routes/coding-memory.mjs",
  "./routes/coding-features.mjs",
  "./routes/coding-auto-dispatch.mjs",
  "./routes/coding-auto-dispatch-config.mjs",
  "./routes/execution-plan-routes.mjs",
  "./routes/coding-auto-dispatch-prompts.mjs",
  "./routes/coding-em-config.mjs",
  "./routes/coding-doc-coverage.mjs",
  "./routes/coding-staged-changes.mjs",
  "./routes/coding-health.mjs",
  "./routes/coding-evidence.mjs",
  "./routes/coding-releases.mjs",
  "./routes/coding-handover.mjs",
  "./routes/coding-ops.mjs",
  "./routes/coding-reports.mjs",
  "./routes/release-unit.mjs",
  "./routes/llm-logs.mjs",
  "./routes/agent-logs.mjs",
  "./routes/log-retention.mjs",
  "./routes/plugins.mjs",
  "./routes/agentic-bindings.mjs",
];

// Pre-import all route modules (avoids repeated dynamic import overhead)
const _loaded = {};
async function loadRoutes() {
  for (const p of ROUTE_MODULES) {
    try { _loaded[p] = await import(p); }
    catch (err) {
      if (err.code !== "ERR_MODULE_NOT_FOUND") console.error(`[Route] Failed to load ${p}:`, err.message);
    }
  }
  try { _loaded["./scheduler/cron-jobs.mjs"] = await import("./scheduler/cron-jobs.mjs"); }
  catch (err) { console.error("[Scheduler] Failed to load:", err.message); }
}

// ── HTTP Server ──
const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Express-style response helpers（4e4e597f 起部分 route 用 res.status().json()；
  // raw http 沒這兩個方法，統一在這裡裝飾，向後相容 writeHead 用法）
  if (typeof res.status !== "function") {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
      return res;
    };
  }

  // Try each route module in order
  for (const p of ROUTE_MODULES) {
    const mod = _loaded[p];
    if (!mod?.default) continue;
    try {
      if (await mod.default(req, res)) return;
    } catch (err) {
      console.error(`[Route] ${p} error:`, err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error", detail: err.message }));
      }
      return; // ← stop processing, don't fall through to next route/404
    }
  }

  // Scheduler module (cron + agent loop + vibe sessions APIs)
  const sched = _loaded["./scheduler/cron-jobs.mjs"];
  if (sched?.default) {
    try {
      if (await sched.default(req, res)) return;
    } catch (err) {
      console.error("[Scheduler] error:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error", detail: err.message }));
      }
      return;
    }
  }

  // ── Static frontend (production) — serve UI dist from PAAW server ──
  if (!res.headersSent && req.method === "GET") {
    const UI_DIST = resolve(PAAW_ROOT, "packages/ui/dist");
    const { existsSync: _exists } = await import("fs");
    if (_exists(UI_DIST)) {
      let reqPath = req.url?.split("?")[0] || "/";
      // Don't serve static for /api/ routes
      if (!reqPath.startsWith("/api/") && !reqPath.startsWith("/.well-known/")) {
        // Security: prevent path traversal — use a strict containment guard.
        // resolve() expands "..", so a naive startsWith(UI_DIST) prefix check
        // can be bypassed with UI_DIST/../secret. safeResolve throws on escape.
        let filePath;
        try {
          const { safeResolve } = await import("./lib/coding-security.mjs");
          filePath = reqPath === "/" ? resolve(UI_DIST, "index.html") : safeResolve(UI_DIST, reqPath.slice(1).replace(/^\/+/, ""));
        } catch {
          // traversal blocked or missing module → fall through to 404
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found", path: req.url }));
          return;
        }
        if (!_exists(filePath)) {
          filePath = resolve(UI_DIST, "index.html");
        }
        try {
          const { extname } = await import("path");
          const ext = extname(filePath);
          const mimeTypes = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".webp": "image/webp",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".map": "application/json",
          };
          const content = await readFile(filePath);
          res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
          res.end(content);
          return;
        } catch {}
      }
    }
  }

  // 404
  if (!res.headersSent) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", path: req.url }));
  }
});

// ── Start ──
await loadRoutes();

// ── Initialize shared tool registry ──
try {
  const { initAllTools } = await import("./lib/tool-registry-init.mjs");
  await initAllTools();
  console.log("[PAAW] Tool registry initialized");
} catch (err) {
  console.warn("[PAAW] Tool registry init failed (non-blocking):", err.message);
}

setupWebSocket();   // WebSocket on port 4098

// EADDRINUSE 清楚報錯 + 乾淨退出，不要炸 exception 風暴
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    try { console.error(`❌ [PAAW] Port ${PORT} 已被佔用 — 已有另一個 paaw-server 實體在跑，本實體退出。`); } catch {}
    process.exit(1);
  }
  try { console.error("❌ [PAAW] HTTP server error:", err); } catch {}
});

// Flight recorder — 黑盒子：任何死法都留死亡時間 + heap 曲線（data/logs/server-heartbeat.log）
import { startFlightRecorder } from "./lib/flight-recorder.mjs";
startFlightRecorder(DATA_HOME);

server.listen(PORT, async () => {
  // Ensure required directories exist
  await mkdir(resolve(DATA_HOME, "knowledge"), { recursive: true });

  // Sync daily backup cron job (schedule/enabled follow backup config)
  try {
    const { syncBackupCronJob } = await import("./routes/backup.mjs");
    await syncBackupCronJob();
  } catch (err) {
    console.error(`[PAAW] Failed to create backup cron job:`, err.message);
  }

  // Ensure daily LLM log purge cron job exists
  try {
    const cronPath = resolve(DATA_HOME, "cron/cron-jobs.json");
    let cronJobs = [];
    try { cronJobs = JSON.parse(await readFile(cronPath, "utf-8")); } catch {}
    const existingPurge = cronJobs.find(j => j.id === "system-daily-log-purge");
    if (!existingPurge) {
      cronJobs.push({
        id: "system-daily-log-purge",
        name: "🧹 清理舊日誌（依保留政策）",
        type: "reminder",
        reminderText: "",
        skillId: "",
        schedule: "0 3 * * *",
        prompt: "",
        params: {},
        outputTarget: "none",
        outputPath: "",
        enabled: true,
        createdAt: new Date().toISOString(),
        lastRun: null,
        lastStatus: null,
        _systemLogPurge: true,
      });
      await writeFile(cronPath, JSON.stringify(cronJobs, null, 2), "utf-8");
      console.log(`[PAAW] Daily LLM log purge cron job created (03:00 daily)`);
    }
  } catch (err) {
    console.error(`[PAAW] Failed to create log purge cron job:`, err.message);
  }

  console.log(`[PAAW] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[PAAW] ${ROUTE_MODULES.length} route modules + scheduler loaded`);

  // ── Check for interrupted execution plans ──
  try {
    const { markInterruptedPlans } = await import('./lib/execution-plan.mjs');
    const { existsSync } = await import('fs');
    const projectPaths = new Set([PAAW_ROOT]); // Always check PAAW root
    // From workspaces.json
    try {
      const workspacesPath = join(DATA_HOME, 'workspaces.json');
      if (existsSync(workspacesPath)) {
        const ws = JSON.parse(await readFile(workspacesPath, 'utf-8'));
        if (Array.isArray(ws)) ws.forEach(w => { if (w.path) projectPaths.add(w.path); });
        if (ws.directories) ws.directories.forEach((p) => projectPaths.add(p));
      }
    } catch {}
    // From recent-projects.json
    try {
      const recentPath = join(DATA_HOME, 'config', 'recent-projects.json');
      if (existsSync(recentPath)) {
        const recent = JSON.parse(await readFile(recentPath, 'utf-8'));
        if (Array.isArray(recent)) recent.forEach((r) => { if (r.path) projectPaths.add(r.path); });
      }
    } catch {}
    // Also check recent projects from .paaw/tasks/TASKS.json locations
    for (const pp of projectPaths) {
      try {
        const marked = await markInterruptedPlans(pp);
        if (marked > 0) console.log(`[PAAW] 📋 ${marked} interrupted plan(s) found in ${pp}`);
      } catch {}
    }
  } catch {}
});

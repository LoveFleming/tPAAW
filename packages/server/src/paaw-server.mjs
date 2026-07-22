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

import { createServer } from "http";
import {
  PORT, PAAW_ROOT,
  readdir, readFile, writeFile, mkdir,
  resolve, dirname,
} from "./routes/shared.mjs";
import { setupWebSocket } from "./websocket/ws-handler.mjs";

// ── Startup import check — catch missing exports (runs in background) ──
import("./lib/import-check.mjs").catch(() => {}); // non-blocking, best-effort

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
  "./routes/tools.mjs",
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
  "./routes/coding-night-shift.mjs",
  "./routes/coding-night-shift-config.mjs",
  "./routes/coding-night-shift-prompts.mjs",
  "./routes/coding-health.mjs",
  "./routes/coding-reports.mjs",
  "./routes/llm-logs.mjs",
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
        let filePath = resolve(UI_DIST, reqPath.slice(1));
        // Security: prevent path traversal
        if (!filePath.startsWith(UI_DIST)) filePath = resolve(UI_DIST, "index.html");
        if (!_exists(filePath) || reqPath === "/") filePath = resolve(UI_DIST, "index.html");
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
  const { initLoopATools } = await import("./lib/tool-registry-init.mjs");
  initLoopATools();
  console.log("[PAAW] Tool registry initialized");
} catch (err) {
  console.warn("[PAAW] Tool registry init failed (non-blocking):", err.message);
}

setupWebSocket();   // WebSocket on port 4098

server.listen(PORT, async () => {
  // Ensure required directories exist
  await mkdir(`${PAAW_ROOT}/data/knowledge`, { recursive: true });

  // Ensure daily backup cron job exists
  try {
    const cronPath = resolve(PAAW_ROOT, "data/cron/cron-jobs.json");
    await mkdir(dirname(cronPath), { recursive: true });
    let cronJobs = [];
    try { cronJobs = JSON.parse(await readFile(cronPath, "utf-8")); } catch {}
    const existingBackup = cronJobs.find(j => j.id === "system-daily-backup");
    if (!existingBackup) {
      // Load backup config for schedule hour
      let scheduleHour = 0;
      try {
        const bkConfig = JSON.parse(await readFile(resolve(PAAW_ROOT, "data/config/backup.json"), "utf-8"));
        scheduleHour = bkConfig.scheduleHour || 0;
      } catch {}
      cronJobs.push({
        id: "system-daily-backup",
        name: "📦 每日資料備份",
        type: "reminder",
        reminderText: `[系統排程] 每日資料備份正在執行。`,
        skillId: "",
        schedule: `0 ${scheduleHour} * * *`,
        prompt: "",
        params: {},
        outputTarget: "chat",
        outputPath: "",
        enabled: true,
        createdAt: new Date().toISOString(),
        lastRun: null,
        lastStatus: null,
        _systemBackup: true,
      });
      await writeFile(cronPath, JSON.stringify(cronJobs, null, 2), "utf-8");
      console.log(`[PAAW] Daily backup cron job created (schedule: 0 ${scheduleHour} * * *)`);
    }
  } catch (err) {
    console.error(`[PAAW] Failed to create backup cron job:`, err.message);
  }

  console.log(`[PAAW] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[PAAW] ${ROUTE_MODULES.length} route modules + scheduler loaded`);
});

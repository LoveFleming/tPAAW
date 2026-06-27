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
import { PORT, PAAW_ROOT, SYSTEM_DIR, mkdir } from "./routes/shared.mjs";
import { setupWebSocket } from "./websocket/ws-handler.mjs";

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
    }
  }

  // Scheduler module (cron + agent loop + vibe sessions APIs)
  const sched = _loaded["./scheduler/cron-jobs.mjs"];
  if (sched?.default) {
    try {
      if (await sched.default(req, res)) return;
    } catch (err) {
      console.error("[Scheduler] error:", err.message);
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
setupWebSocket();   // WebSocket on port 4098

server.listen(PORT, async () => {
  // Ensure required directories exist
  await mkdir(SYSTEM_DIR, { recursive: true });
  await mkdir(`${PAAW_ROOT}/data/knowledge`, { recursive: true });

  console.log(`[PAAW] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[PAAW] ${ROUTE_MODULES.length} route modules + scheduler loaded`);
});

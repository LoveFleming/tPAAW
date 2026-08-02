/**
 * Coding Night Shift — HTTP Routes
 *
 * POST   /api/coding-night-shift/start           — 啟動（body: { mode, model, since }）
 * POST   /api/coding-night-shift/reset            — Force reset stuck status
 * GET    /api/coding-night-shift/status           — 最新執行狀態
 * GET    /api/coding-night-shift/report           — 最新報告（markdown）
 * GET    /api/coding-night-shift/last-run         — 上次執行時間 + 模式
 *
 * 報告統一存到 .paaw/night-shift/reports/YYYY-MM-DD.md（共用）
 * 歷史報告 API: /api/coding-reports/*（coding-reports.mjs）
 *
 * 核心邏輯在 lib/overnight-manager.mjs（EM 模式 + Parallel 模式）
 * 共用邏輯在 lib/night-shift-shared.mjs
 */
import { readFileSync as readSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

const NIGHT_SHIFT_DIR = ".paaw/night-shift";
const STATUS_FILE = "status.json";
const REPORT_FILE = "report.md";

/**
 * Atomically read-modify-write status.json with a mutator function.
 *
 * This centralizes ALL status writes to prevent race conditions between
 * the async Night Shift run (sendSSE callback), the global timeout handler,
 * the error handler, and the /reset endpoint.
 *
 * Rules enforced:
 *   - If the current status is "interrupted", progress updates are silently
 *     skipped so they don't overwrite a user's reset.
 *   - The mutator receives the current status object and should return the
 *     modified object (or null to cancel the write).
 */
function updateStatusFile(statusPath, mutator) {
  try {
    if (!existsSync(statusPath)) return null;
    const current = JSON.parse(readSync(statusPath, "utf-8"));

    // If the session was interrupted, don't allow progress updates to clobber it.
    // Only the /reset endpoint writes "interrupted"; we respect it.
    if (current.status === "interrupted") return null;

    const updated = mutator(current);
    if (!updated) return null; // mutator can return null to cancel

    writeFileSync(statusPath, JSON.stringify(updated, null, 2));
    return updated;
  } catch (err) {
    console.error("[NightShift] updateStatusFile error:", err.message);
    return null;
  }
}

export default async function codingNightShiftRoute(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const method = req.method;

  const readBody = (req) => new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

  const sendJSON = (res, code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  let projRoot = urlObj.searchParams.get("path") || PAAW_ROOT;

  // ── POST /api/coding-night-shift/start ──
  if (urlObj.pathname === "/api/coding-night-shift/start" && method === "POST") {
    const nsDir = join(projRoot, NIGHT_SHIFT_DIR);
    if (!existsSync(nsDir)) mkdirSync(nsDir, { recursive: true });

    let reqBody = {};
    try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}

    // Load night shift config for mode + model
    let nsConfig = null;
    try {
      const nsConfigPath = join(projRoot, ".paaw", "night-shift", "config.json");
      if (existsSync(nsConfigPath)) {
        nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8"));
      }
    } catch {}

    const mode = reqBody.mode || nsConfig?.mode || "em";
    const modelOverride = reqBody.model || nsConfig?.model?.primary || undefined;
    const fallbackModels = nsConfig?.model?.fallbacks || [];
    const sinceDate = reqBody.since || urlObj.searchParams.get("since") || new Date().toISOString().split("T")[0];

    const startTime = Date.now();

    // Initialize status
    const status = {
      startedAt: new Date().toISOString(),
      status: "running",
      mode,
      agents: {},
      totalAgents: mode === "parallel" ? 6 : 0,
      completedAgents: 0,
    };
    writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(status, null, 2));

    // Respond immediately — run async
    sendJSON(res, 200, { ok: true, message: `Night shift started (mode: ${mode})`, startedAt: status.startedAt, mode });

    // ── Global timeout: 10 min ──
    const NIGHT_SHIFT_TIMEOUT_MS = (nsConfig?.projectPhase === 'bootstrap' || nsConfig?.projectPhase === 'mvp')
      ? 30 * 60 * 1000  // 30 min for early stage (dev-heavy)
      : 20 * 60 * 1000; // 20 min for stable/refactor
    const statusPath = join(nsDir, STATUS_FILE);
    const timeoutId = setTimeout(() => {
      const updated = updateStatusFile(statusPath, (current) => {
        if (current.status !== "running") return null; // already completed/failed/interrupted
        return {
          ...current,
          status: "failed",
          completedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          error: `Timed out after ${NIGHT_SHIFT_TIMEOUT_MS / 1000}s`,
        };
      });
      if (updated) {
        console.error(`[NightShift] Timed out after ${NIGHT_SHIFT_TIMEOUT_MS / 1000}s`);
      }
    }, NIGHT_SHIFT_TIMEOUT_MS);

    // ── Run via overnight-manager ──
    try {
      const { runNightShift } = await import("../lib/overnight-manager.mjs");

      // SSE-like: collect progress into status updates
      const sendSSE = (type, data) => {
        console.log(`[NightShift:${mode}] ${type}:`, typeof data === "string" ? data : JSON.stringify(data).slice(0, 200));

        if (type === "task_start" || type === "task_done" || type === "task_error") {
          updateStatusFile(statusPath, (current) => {
            const agentKey = data.agent || `task-${data.index}`;
            const agents = { ...(current.agents || {}) };
            agents[agentKey] = {
              status: type === "task_done" ? "completed" : type === "task_error" ? "failed" : "running",
              ...(data.preview ? { report: data.preview } : {}),
              ...(data.error ? { error: data.error } : {}),
            };
            return {
              ...current,
              agents,
              completedAgents: (type === "task_done" || type === "task_error")
                ? (current.completedAgents || 0) + 1
                : (current.completedAgents || 0),
            };
          });
        }
      };

      const result = await runNightShift({
        mode,
        rootDir: projRoot,
        baseUrl: `http://127.0.0.1:${req.socket.localPort || process.env.PAAW_PORT || 4097}`,
        since: sinceDate,
        modelOverride,
        fallbackModels,
        sendSSE,
        projectPhase: nsConfig?.projectPhase || 'bootstrap',
        existingPlanId: reqBody.planId || urlObj.searchParams.get('planId') || null,
      });

      // Update final status (only if not interrupted by user)
      updateStatusFile(statusPath, (current) => {
        if (current.status === "interrupted") return null; // user reset — respect it
        return {
          ...current,
          status: "completed",
          completedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          report: result.report,
        };
      });

      // Save latest report for quick access
      writeFileSync(join(nsDir, REPORT_FILE), result.report, "utf-8");

      const finalDuration = Date.now() - startTime;
      console.log(`[NightShift] Complete in ${finalDuration}ms (mode: ${mode})`);
    } catch (err) {
      console.error("[NightShift] Error:", err.message, err.stack?.slice(0, 300));
      updateStatusFile(statusPath, (current) => {
        if (current.status === "interrupted") return null; // user reset — respect it
        return {
          ...current,
          status: "failed",
          completedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          error: err.message,
        };
      });
    } finally {
      clearTimeout(timeoutId);
    }

    return true;
  }

  // ── POST /api/coding-night-shift/reset — Force reset stuck status ──
  if (urlObj.pathname === "/api/coding-night-shift/reset" && method === "POST") {
    const statusFile = join(projRoot, NIGHT_SHIFT_DIR, STATUS_FILE);
    if (existsSync(statusFile)) {
      try {
        const current = JSON.parse(readSync(statusFile, "utf-8"));
        current.status = "interrupted";
        current.completedAt = new Date().toISOString();
        current.error = "Manually reset by user";
        writeFileSync(statusFile, JSON.stringify(current, null, 2));
        sendJSON(res, 200, { ok: true, message: "Status reset" });
      } catch {
        sendJSON(res, 500, { error: "Failed to reset status" });
      }
    } else {
      sendJSON(res, 200, { ok: true, message: "No status file to reset" });
    }
    return true;
  }

  // ── GET /api/coding-night-shift/last-run ──
  if (urlObj.pathname === "/api/coding-night-shift/last-run" && method === "GET") {
    let lastRunAt = null;
    let lastRunBy = null;
    let lastRunMode = null;

    // Night Shift status.json
    const nsStatusFile = join(projRoot, NIGHT_SHIFT_DIR, STATUS_FILE);
    if (existsSync(nsStatusFile)) {
      try {
        const ns = JSON.parse(readSync(nsStatusFile, "utf-8"));
        if (ns.completedAt) { lastRunAt = ns.completedAt; lastRunBy = "night-shift"; lastRunMode = ns.mode; }
        else if (ns.startedAt) { lastRunAt = ns.startedAt; lastRunBy = "night-shift"; lastRunMode = ns.mode; }
      } catch {}
    }

    // Also check reports dir for latest
    const reportsDir = join(projRoot, ".paaw", "night-shift", "reports");
    if (existsSync(reportsDir)) {
      try {
        const { readdirSync } = await import("fs");
        const files = readdirSync(reportsDir).filter(f => f.endsWith(".md")).sort().reverse();
        if (files.length > 0) {
          const fileDate = files[0].replace(".md", "");
          const reportTime = new Date(fileDate + "T23:59:59").toISOString();
          if (!lastRunAt || reportTime > lastRunAt) {
            lastRunAt = reportTime;
            lastRunBy = "night-shift-reports";
          }
        }
      } catch {}
    }

    // Also check action-log for EM activity
    try {
      const { listActionLog } = await import("../lib/action-log.mjs");
      const logs = await listActionLog(projRoot, 20);
      const emLog = logs.find(e => e.agent === "em" && e.ts);
      if (emLog?.ts && (!lastRunAt || emLog.ts > lastRunAt)) {
        lastRunAt = emLog.ts;
        lastRunBy = "em-action-log";
      }
    } catch {}

    const since = lastRunAt ? lastRunAt.split("T")[0] : new Date().toISOString().split("T")[0];
    sendJSON(res, 200, { lastRunAt, lastRunBy, lastRunMode, since, hasRun: !!lastRunAt });
    return true;
  }

  // ── GET /api/coding-night-shift/status ──
  if (urlObj.pathname === "/api/coding-night-shift/status" && method === "GET") {
    const statusFile = join(projRoot, NIGHT_SHIFT_DIR, STATUS_FILE);
    if (!existsSync(statusFile)) {
      sendJSON(res, 200, { status: "never", message: "No night shift has been run yet." });
      return true;
    }
    try {
      const data = JSON.parse(readSync(statusFile, "utf-8"));
      sendJSON(res, 200, data);
    } catch {
      sendJSON(res, 200, { status: "error", message: "Failed to read status" });
    }
    return true;
  }

  // ── GET /api/coding-night-shift/report ──
  if (urlObj.pathname === "/api/coding-night-shift/report" && method === "GET") {
    const reportFile = join(projRoot, NIGHT_SHIFT_DIR, REPORT_FILE);
    if (!existsSync(reportFile)) {
      sendJSON(res, 200, { report: "" });
      return true;
    }
    const report = readSync(reportFile, "utf-8");
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(report);
    return true;
  }

  return false;
}

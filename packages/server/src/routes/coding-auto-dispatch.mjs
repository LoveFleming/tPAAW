/**
 * Coding Auto Dispatch — HTTP Routes
 *
 * POST   /api/coding-auto-dispatch/start           — 啟動（body: { mode, model, since }）
 * POST   /api/coding-auto-dispatch/preview         — task-driven 預覽（不執行；確認制派工用）
 * POST   /api/coding-auto-dispatch/stop            — 請求中斷（目前 task 完成後停止）
 * POST   /api/coding-auto-dispatch/reset            — Force reset stuck status
 * GET    /api/coding-auto-dispatch/status           — 最新執行狀態
 * GET    /api/coding-auto-dispatch/report           — 最新報告（markdown）
 * GET    /api/coding-auto-dispatch/last-run         — 上次執行時間 + 模式
 *
 * 報告統一存到 .paaw/auto-dispatch/reports/YYYY-MM-DD.md（共用）
 * 歷史報告 API: /api/coding-reports/*（coding-reports.mjs）
 *
 * 核心邏輯在 lib/auto-dispatch-manager.mjs（EM 模式 + Parallel 模式）
 * 共用邏輯在 lib/auto-dispatch-shared.mjs
 */
import { readFileSync as readSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

const AUTO_DISPATCH_DIR = ".paaw/auto-dispatch";
const STATUS_FILE = "status.json";
const REPORT_FILE = "report.md";

/**
 * Atomically read-modify-write status.json with a mutator function.
 *
 * This centralizes ALL status writes to prevent race conditions between
 * the async Auto Dispatch run (sendSSE callback), the global timeout handler,
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
    console.error("[AutoDispatch] updateStatusFile error:", err.message);
    return null;
  }
}

// 2026-08-30：同 project 並行 guard（module-level — server 重啟自動清空，殭屍可恢復）
const _activeRuns = new Set();

export default async function codingAutoDispatchRoute(req, res) {
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

  // ── POST /api/coding-auto-dispatch/start ──
  if (urlObj.pathname === "/api/coding-auto-dispatch/start" && method === "POST") {
    // 2026-08-30 單例 guard：同 project 不並行（防誤按兩次 start 重複派工）
    // server 重啟後 Set 清空 = 殭屍 plan 可被恢復續跑（resumePlan 已把 running 也納入重跑）
    if (_activeRuns.has(projRoot)) {
      sendJSON(res, 409, { ok: false, error: `此專案派工已在執行中（status.json 輪詢可看進度）— 若 UI 卡殭屍（重啟後殘留），先用 /api/coding-auto-dispatch/stop 重置再 start` });
      return true;
    }
    _activeRuns.add(projRoot);
    try {
    const nsDir = join(projRoot, AUTO_DISPATCH_DIR);
    if (!existsSync(nsDir)) mkdirSync(nsDir, { recursive: true });

    let reqBody = {};
    try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}

    // Load auto dispatch config for mode + model
    let nsConfig = null;
    try {
      const nsConfigPath = join(projRoot, ".paaw", "auto-dispatch", "config.json");
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

    // 2026-08-29 Fleming 定調：拿掉全域 timeout（20/30min）— task-driven 長時間執行
    // （上限 100 task × 每 task 2h）；安全機制改為：每 task 2h timeout（a2aCallAgent）+
    //   使用者中斷按鈕（/stop，task 間安全中斷點）
    const statusPath = join(nsDir, STATUS_FILE);

    // ── Run via auto-dispatch-manager ──
    try {
      const { runAutoDispatch } = await import("../lib/auto-dispatch-manager.mjs");

      // SSE-like: collect progress into status updates
      const sendSSE = (type, data) => {
        console.log(`[AutoDispatch:${mode}] ${type}:`, typeof data === "string" ? data : JSON.stringify(data).slice(0, 200));

        // 2026-08-29: 所有事件寫入 status.json events ring buffer — UI（EM Chat slim bar / 派工頁）
        // 輪詢 /status 就看得到進度，不用只靠 terminal console；task_* 事件同時更新 agents map
        updateStatusFile(statusPath, (current) => {
          const msg = String(data?.message || data?.preview || (typeof data === "string" ? data : "")).slice(0, 300);
          // 2026-08-29: task_*/done 事件附帶結構化 meta — EM Chat 輪詢 /status 可以直接組進度訊息
          let meta;
          if (type === "task_start" || type === "task_done" || type === "task_error") {
            meta = { index: data.index, total: data.total, agent: data.agent, subtaskId: data.subtaskId };
          } else if (type === "done") {
            meta = { totalTasks: data.totalTasks, succeeded: data.succeeded, failed: data.failed, ...(data.interrupted ? { interrupted: true } : {}) };
          }
          const events = [...(current.events || []), { ts: new Date().toISOString(), type, message: msg, ...(meta ? { meta } : {}) }].slice(-80);
          const patch = { events, lastEvent: events[events.length - 1] };
          if (type === "task_start" || type === "task_done" || type === "task_error") {
            const agentKey = data.agent || `task-${data.index}`;
            const agents = { ...(current.agents || {}) };
            agents[agentKey] = {
              status: type === "task_done" ? "completed" : type === "task_error" ? "failed" : "running",
              ...(data.preview ? { report: data.preview } : {}),
              ...(data.error ? { error: data.error } : {}),
            };
            patch.agents = agents;
            patch.completedAgents = (type === "task_done" || type === "task_error")
              ? (current.completedAgents || 0) + 1
              : (current.completedAgents || 0);
          }
          return { ...current, ...patch };
        });
      };

      const result = await runAutoDispatch({
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
          ...(current.stopRequested ? { interruptedByUser: true } : {}),
          report: result.report,
        };
      });

      // Save latest report for quick access
      writeFileSync(join(nsDir, REPORT_FILE), result.report, "utf-8");

      const finalDuration = Date.now() - startTime;
      console.log(`[AutoDispatch] Complete in ${finalDuration}ms (mode: ${mode})`);
    } catch (err) {
      console.error("[AutoDispatch] Error:", err.message, err.stack?.slice(0, 300));
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
      // 釋放 guard：無論成功、失敗、異常 — 同 project 可重新 start
      _activeRuns.delete(projRoot);
    }
    } catch (outerErr) {
      // 前置步驟（config 載入/status 初始化）失敗也要釋放 guard + 回報
      console.error("[AutoDispatch] Start failed:", outerErr.message);
      if (!res.headersSent) sendJSON(res, 500, { ok: false, error: outerErr.message });
    } finally {
      _activeRuns.delete(projRoot);
    }

    return true;
  }

  // ── POST /api/coding-auto-dispatch/preview — task-driven 預覽（不執行；EM Chat 確認制派工用）──
  if (urlObj.pathname === "/api/coding-auto-dispatch/preview" && method === "POST") {
    try {
      let reqBody = {};
      try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}
      const root = urlObj.searchParams.get("path") || reqBody.cwd || projRoot;
      const { scanTasksForDispatch } = await import("../lib/auto-dispatch-shared.mjs");
      let maxTasks = 100;
      try {
        const { readEMConfig } = await import("../lib/em-config.mjs");
        maxTasks = readEMConfig(root)?.taskDecomposition?.maxSubtasks || 100;
      } catch {}
      const scan = scanTasksForDispatch(root, { maxTasks });
      sendJSON(res, 200, { ok: true, ...scan });
    } catch (err) {
      console.error("[AutoDispatch] preview error:", err.message);
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  // ── POST /api/coding-auto-dispatch/stop — 請求中斷（安全中斷點：目前 task 完成後停止，剩餘標 skipped）──
  if (urlObj.pathname === "/api/coding-auto-dispatch/stop" && method === "POST") {
    try {
      let reqBody = {};
      try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}
      const root = urlObj.searchParams.get("path") || reqBody.cwd || projRoot;
      const statusPath = join(root, AUTO_DISPATCH_DIR, STATUS_FILE);
      // 2026-08-30 殭屍救援：沒有活的 dispatch process 時，stop 直接把殭屍標 interrupted
      // （否則 stopRequested 掛著永遠等不到「task 完成後停止」的中斷點 — Fleming 實案例）
      if (!_activeRuns.has(root)) {
        const fixed = updateStatusFile(statusPath, (current) => {
          if (current.status !== "running" || _activeRuns.has(root)) return null;
          const events = [...(current.events || []), { ts: new Date().toISOString(), type: "info", message: "⚠️ 殭屍 running（無活 dispatch）— 中斷請求直接生效，已標 interrupted；重新 start 可續跑" }].slice(-80);
          return { ...current, status: "interrupted", completedAt: new Date().toISOString(), error: "Interrupted (orphaned run — server restarted)", events, lastEvent: events[events.length - 1] };
        });
        sendJSON(res, 200, fixed
          ? { ok: true, message: "Orphaned running status — already interrupted. Start again to resume the plan." }
          : { ok: false, message: "Not running" });
        return true;
      }
      const updated = updateStatusFile(statusPath, (current) => {
        if (current.status !== "running") return null;
        const events = [...(current.events || []), { ts: new Date().toISOString(), type: "info", message: "⏹️ 使用者請求中斷 — 將於目前 task 完成後停止" }].slice(-80);
        return { ...current, stopRequested: true, stoppedAt: new Date().toISOString(), events, lastEvent: events[events.length - 1] };
      });
      sendJSON(res, 200, updated
        ? { ok: true, message: "Interrupt requested — will stop after current task" }
        : { ok: false, message: "Not running" });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
    return true;
  }

  // ── POST /api/coding-auto-dispatch/reset — Force reset stuck status ──
  if (urlObj.pathname === "/api/coding-auto-dispatch/reset" && method === "POST") {
    const statusFile = join(projRoot, AUTO_DISPATCH_DIR, STATUS_FILE);
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

  // ── GET /api/coding-auto-dispatch/last-run ──
  if (urlObj.pathname === "/api/coding-auto-dispatch/last-run" && method === "GET") {
    let lastRunAt = null;
    let lastRunBy = null;
    let lastRunMode = null;

    // Auto Dispatch status.json
    const nsStatusFile = join(projRoot, AUTO_DISPATCH_DIR, STATUS_FILE);
    if (existsSync(nsStatusFile)) {
      try {
        const ns = JSON.parse(readSync(nsStatusFile, "utf-8"));
        if (ns.completedAt) { lastRunAt = ns.completedAt; lastRunBy = "auto-dispatch"; lastRunMode = ns.mode; }
        else if (ns.startedAt) { lastRunAt = ns.startedAt; lastRunBy = "auto-dispatch"; lastRunMode = ns.mode; }
      } catch {}
    }

    // Also check reports dir for latest
    const reportsDir = join(projRoot, ".paaw", "auto-dispatch", "reports");
    if (existsSync(reportsDir)) {
      try {
        const { readdirSync } = await import("fs");
        const files = readdirSync(reportsDir).filter(f => f.endsWith(".md")).sort().reverse();
        if (files.length > 0) {
          const fileDate = files[0].replace(".md", "");
          const reportTime = new Date(fileDate + "T23:59:59").toISOString();
          if (!lastRunAt || reportTime > lastRunAt) {
            lastRunAt = reportTime;
            lastRunBy = "auto-dispatch-reports";
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

  // ── GET /api/coding-auto-dispatch/status ──
  if (urlObj.pathname === "/api/coding-auto-dispatch/status" && method === "GET") {
    const statusFile = join(projRoot, AUTO_DISPATCH_DIR, STATUS_FILE);
    if (!existsSync(statusFile)) {
      sendJSON(res, 200, { status: "never", message: "No auto dispatch has been run yet." });
      return true;
    }
    try {
      const data = JSON.parse(readSync(statusFile, "utf-8"));
      // 2026-08-30 孤兒偵測：status 說 running 但本 process 没有活的 dispatch（重啟後殭屍）
      // → 自動降為 interrupted，UI 下一次輪詢（≤4s）就停止閃爕「中斷」/解鎖 input；
      // plan 檔不受影響，下次 start 照常續跑（findIncompletePlans 看 plans/*.json）
      if (data.status === "running" && !_activeRuns.has(projRoot)) {
        const fixed = updateStatusFile(statusFile, (current) => {
          if (current.status !== "running" || _activeRuns.has(projRoot)) return null; // 重驗（避免競態）
          const events = [...(current.events || []), { ts: new Date().toISOString(), type: "info", message: "⚠️ 偵測到殭屍狀態（server 重啟後殘留 running）— 已自動標記 interrupted，重新 start 可續跑" }].slice(-80);
          return { ...current, status: "interrupted", completedAt: new Date().toISOString(), error: "Server restarted while dispatch was running", events, lastEvent: events[events.length - 1] };
        });
        if (fixed) sendJSON(res, 200, fixed);
        else sendJSON(res, 200, JSON.parse(readSync(statusFile, "utf-8")));
        return true;
      }
      sendJSON(res, 200, data);
    } catch {
      sendJSON(res, 200, { status: "error", message: "Failed to read status" });
    }
    return true;
  }

  // ── GET /api/coding-auto-dispatch/report ──
  if (urlObj.pathname === "/api/coding-auto-dispatch/report" && method === "GET") {
    const reportFile = join(projRoot, AUTO_DISPATCH_DIR, REPORT_FILE);
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

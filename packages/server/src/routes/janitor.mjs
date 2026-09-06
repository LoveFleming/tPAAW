/**
 * Janitor API — 磁碟清理設定 + 執行 + 日誌（2026-09-06 Fleming 要求 UI 可設定）
 *
 * GET  /api/janitor     — { config, logTail }（設定 + janitor.log 尾端）
 * PUT  /api/janitor     — 寫 data/config/janitor.json（白名單鍵驗證）
 * POST /api/janitor/run — 立即執行一輪（回完整報告；與每日 cron 同一入口邏輯）
 */
import { readBody } from "./shared.mjs";
import { json, urlPath } from "./context.mjs";
import { loadConfig, saveConfig, runJanitor, tailJanitorLog, DEFAULTS } from "../lib/janitor.mjs";

export default async function janitorRoutes(req, res) {
  const path = urlPath(req);
  const method = req.method;

  // ── GET /api/janitor — 設定 + 日誌尾端 ──
  if (method === "GET" && path === "/api/janitor") {
    try {
      const [config, logTail] = await Promise.all([loadConfig(), tailJanitorLog(200)]);
      json(res, { ok: true, config, defaults: DEFAULTS, logTail });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // ── PUT /api/janitor — 寫設定 ──
  if (method === "PUT" && path === "/api/janitor") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const config = await saveConfig(body || {});
      json(res, { ok: true, config });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // ── POST /api/janitor/run — 立即執行 ──
  if (method === "POST" && path === "/api/janitor/run") {
    try {
      const report = await runJanitor();
      const logTail = await tailJanitorLog(50);
      json(res, { ok: true, report, logTail });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  return false;
}

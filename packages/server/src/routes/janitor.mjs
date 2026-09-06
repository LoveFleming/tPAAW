/**
 * Janitor / runtime-log API（2026-09-06 Fleming：log/ 目錄架構 + UI 可設定）
 *
 * GET  /api/janitor          — { config, defaults, logTail }（設定 + janitor.log 尾端）
 * PUT  /api/janitor          — 寫 data/config/janitor.json（白名單鍵驗證）
 * POST /api/janitor/run      — 立即執行一輪（回完整報告）
 * GET  /api/logs/console     — 📜 Console 檢視器（src=server|app；offset 輪詢）
 *                              server = log/server-console.log（paaw-server tee）
 *                              app    = log/app-console/<ru>/app-console-YYYY-MM-DD.log（最新一份）
 */
import { readBody } from "./shared.mjs";
import { json, urlPath } from "./context.mjs";
import { existsSync, statSync, openSync, readdirSync, readSync, closeSync } from "fs";
import { join } from "path";
import { loadConfig, saveConfig, runJanitor, tailJanitorLog, DEFAULTS } from "../lib/janitor.mjs";
import { LOG_HOME, logSlug } from "../data-home.mjs";
import { PAAW_ROOT } from "./shared.mjs";

export default async function janitorRoutes(req, res) {
  const path = urlPath(req);
  const method = req.method;
  const q = Object.fromEntries(new URLSearchParams((req.url || "").split("?")[1] || ""));

  // ── GET /api/logs/console — Terminal 📜 Console 檢視器（offset 輪詢）──
  if (method === "GET" && path === "/api/logs/console") {
    const src = q.src === "app" ? "app" : "server";
    let file;
    if (src === "app") {
      // log4j 式日期檔名：讀最新的 app-console-YYYY-MM-DD.log（log/ 中央目錄）
      const logsDir = join(LOG_HOME, "app-console", logSlug(q.cwd || PAAW_ROOT));
      let target = join(logsDir, "app-console.log");
      try {
        const dated = readdirSync(logsDir).filter(f => /^app-console-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
        if (dated.length > 0) target = join(logsDir, dated[dated.length - 1]);
      } catch { /* 目錄不存在走 fallback */ }
      file = target;
    } else {
      file = join(LOG_HOME, "server-console.log");
    }
    try {
      let data = "";
      let size = 0;
      const exists = existsSync(file);
      if (exists) {
        const st = statSync(file);
        size = st.size;
        const offset = Math.max(0, Math.min(parseInt(q.offset || "0", 10) || 0, st.size));
        const len = Math.min(st.size - offset, 512 * 1024); // 單次最多 512KB
        if (len > 0) {
          const fd = openSync(file, "r");
          try {
            const buf = Buffer.alloc(len);
            readSync(fd, buf, 0, len, offset);
            data = buf.toString("utf-8");
          } finally { try { closeSync(fd); } catch {} }
        }
        return json(res, { src, file, exists: true, size, nextOffset: offset + Buffer.byteLength(data, "utf-8"), data });
      }
      return json(res, { src, file, exists: false, size: 0, nextOffset: 0, data: "" });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

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

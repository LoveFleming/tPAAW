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
      let rotated = false;
      const exists = existsSync(file);
      if (exists) {
        const st = statSync(file);
        let size = st.size;
        let offset = Math.max(0, parseInt(q.offset || "0", 10) || 0);
        // 2026-09-14 fix：offset 超過檔案大小 = 檔案輪替/縮小 → 跳到新檔尾（否則永遠讀不到新內容）
        if (offset > size) {
          rotated = true;
          offset = Math.max(0, size - 64 * 1024);
        }
        // 2026-09-14 fix：首次載入直接跳檔尾（tail=1，最後 256KB）— 大 log 不用從頭慢慢追
        if (q.tail === "1" && offset === 0 && size > 256 * 1024) {
          offset = size - 256 * 1024;
        }
        offset = Math.min(offset, size);
        const len = Math.min(size - offset, 512 * 1024); // 單次最多 512KB
        let consumed = 0;
        if (len > 0) {
          const fd = openSync(file, "r");
          try {
            const buf = Buffer.alloc(len);
            readSync(fd, buf, 0, len, offset);
            // 2026-09-14 fix（真 bug）：位元組邊界切在多位元組字中間（中文/emoji）→
            //   舊碼 buf.toString 產生 �，且 nextOffset 用重編碼長度會跳 byte（錯位）。
            //   修：頭尾不完整序列各丢最多 1 字，offset 照全窗口推進（零錯位零無限迴圈）。
            let start = 0;
            // 頭：切在字中間（tail 跳尾/輪替後必中）→ 跳到下一個 lead byte
            while (start < len && (buf[start] & 0xc0) === 0x80) start++;
            // 尾：不完整序列 → 砍掉
            let end = len;
            for (let back = 1; back <= Math.min(3, end - start); back++) {
              const b = buf[end - back];
              if ((b & 0xc0) === 0x80) continue; // continuation byte → 往前找 lead
              if (b >= 0xc0) {
                const need = b >= 0xf0 ? (b >= 0xf8 ? 5 : 4) : b >= 0xe0 ? 3 : 2;
                if (back < need) end = len - back; // 尾序列不完整 → 砍掉
              }
              break;
            }
            data = buf.toString("utf-8", start, end);
            consumed = len; // 檔案 offset 照全窗口推進（丢的字元不重讀，防無限迴圈）
          } finally { try { closeSync(fd); } catch {} }
        }
        if (rotated) data = `\n──── log rotated（檔案換新，跳到最新 64KB）────\n${data}`;
        return json(res, { src, file, exists: true, size, rotated, nextOffset: offset + consumed, data });
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

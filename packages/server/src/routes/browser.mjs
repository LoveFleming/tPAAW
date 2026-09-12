/**
 * Browser API — 內建瀏覽器狀態 + 截圖 + 共用串流（IDE Browser tab 用）
 *
 * 2026-09-12 多實體：每個 endpoint 接受 ru（release unit 路徑）— query param 或 JSON body。
 * 不同 ru = 不同 browser instance（獨立 profile/分頁/串流）。沒帶 ru → default instance（向後相容）。
 *   GET  /api/browser/status?ru=      — 目前頁面狀態（url/title/ready/error/lastScreenshot）
 *   GET  /api/browser/screenshot?ru=  — 最新截圖 PNG bytes（?t=<ts> 防 cache）
 *   GET  /api/browser/stream?ru=      — SSE：Cowork 級串流（CDP screencast frames，即時畫面下行）
 *   POST /api/browser/navigate        — 手動導航（IDE 網址列用；與 agent 共用同一個 page）{url, ru?}
 *   POST /api/browser/input           — 輸入回注（人的滑鼠/滾輪/鍵盤/IME 文字 → agent 的 browser）{..., ru?}
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { DATA_HOME } from "../data-home.mjs";
import {
  browserState, PLAYWRIGHT_INSTALL_HINT, getBrowserPage, trackPage, takeScreenshot, assertSafeUrl,
  attachStreamClient, detachStreamClient, applyBrowserInput, kickScreencast,
  browserTabs, browserNewTab, browserSwitchTab, browserCloseTab, browserNavAction,
  browserDownloads, browserHandleDialog, resolveBrowserKey, browserShotDir,
  browserActions, recordBrowserAction,
} from "../lib/browser-session.mjs";
import { getBrowserSetupStatus } from "../lib/browser-setup.mjs";

function readBody(req) {
  return new Promise((r) => {
    let b = "";
    req.on("data", c => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on("end", () => r(b));
    req.on("error", () => r(""));
  });
}

export default async function browserRoute(req, res) {
  const method = req.method;
  const url = (req.url || "").split("?")[0];
  const q = new URL(req.url || "/", "http://localhost").searchParams;
  const key = resolveBrowserKey(q.get("ru"));

  // ── 可選元件：偵測系統 Google Chrome / Chromium（channel: "chrome"，不載自帶 chromium）──
  // GET /api/browser/setup — 回報 playwright 套件 + 系統 Chrome 是否就緒
  if (url === "/api/browser/setup" && method === "GET") {
    try {
      const setup = await getBrowserSetupStatus();
      json(res, 200, { ok: true, ...setup });
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // POST /api/browser/navigate {url, ru?} — 手動導航（IDE 網址列用；與 agent 共用同一個 page）
  if (url === "/api/browser/navigate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch {}
    const bKey = resolveBrowserKey(body.ru || q.get("ru"));
    const target0 = (body.url || "").trim();
    if (!target0) { json(res, 400, { error: "url required" }); return true; }
    const target = /^https?:\/\//i.test(target0) ? target0 : "https://" + target0;
    try {
      assertSafeUrl(target);
      const page = await getBrowserPage(bKey);
      trackPage(bKey, page);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
      const shot = await takeScreenshot(bKey, page);
      recordBrowserAction(bKey, { actor: "human", kind: "navigate", summary: `前往 ${target.slice(0, 120)}`, url: page.url() });
      kickScreencast(bKey); // viewer 立即看到新頁面（best effort，不 await）
      const s = browserState(bKey);
      json(res, 200, { ...s, screenshot: shot });
    } catch (e) {
      // 下載啟動不是錯：goto 遇到 attachment 會 throw "Download is starting"，檔案已進下載管線
      if (/Download is starting/i.test(String(e?.message || ""))) {
        json(res, 200, { ...browserState(bKey), downloadStarted: true });
      } else {
        json(res, 400, { error: e.message });
      }
    }
    return true;
  }

  // GET /api/browser/stream?ru= — SSE 共用串流（Cowork 級：人看 agent 瀏覽器即時畫面；per instance）
  if (url === "/api/browser/stream" && method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    if (res.socket?.setNoDelay) res.socket.setNoDelay(true);
    res.write(`retry: 2000\n\n`);
    res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
    attachStreamClient(key, res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
        if (typeof res.flush === "function") res.flush();
      } catch {}
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      detachStreamClient(key, res);
    });
    return true;
  }

  // ── 分頁管理（Cowork 級；per instance）──
  // GET /api/browser/tabs?ru= — 列出所有分頁 + activeId
  if (url === "/api/browser/tabs" && method === "GET") {
    try { getBrowserPage(key).catch(() => {}); json(res, 200, browserTabs(key)); }
    catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }
  // POST /api/browser/tabs {action:"new"|"switch"|"close", id?, url?, ru?}
  if (url === "/api/browser/tabs" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch {}
    const bKey = resolveBrowserKey(body.ru || q.get("ru"));
    try {
      if (body.action === "new") {
        const r = await browserNewTab(bKey, body.url || null);
        json(res, 200, { ok: true, ...r, ...browserTabs(bKey) });
      } else if (body.action === "switch") {
        json(res, 200, { ok: true, ...await browserSwitchTab(bKey, body.id) });
      } else if (body.action === "close") {
        json(res, 200, { ok: true, ...await browserCloseTab(bKey, body.id) });
      } else { json(res, 400, { error: "action must be new|switch|close" }); }
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  // POST /api/browser/back | forward | reload — 導航控制（?ru= 或 body.ru）
  for (const act of ["back", "forward", "reload"]) {
    if (url === `/api/browser/${act}` && method === "POST") {
      let bKey = key;
      try { const b = JSON.parse(await readBody(req) || "{}"); if (b.ru) bKey = resolveBrowserKey(b.ru); } catch {}
      try { json(res, 200, { ok: true, ...(await browserNavAction(bKey, act)) }); }
      catch (e) { json(res, 400, { error: e.message }); }
      return true;
    }
  }
  // GET /api/browser/downloads?ru= — 下載清單
  if (url === "/api/browser/downloads" && method === "GET") {
    json(res, 200, { ok: true, downloads: browserDownloads(key) });
    return true;
  }
  // POST /api/browser/dialog {id, action:"accept"|"dismiss", text?, ru?}
  if (url === "/api/browser/dialog" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch {}
    try { json(res, 200, await browserHandleDialog(resolveBrowserKey(body.ru || q.get("ru")), body.id, body.action, body.text)); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // ── 操作錄影回放（2026-09-12：agent 在背景操作，人隨時回來看它做了什麼）──
  // GET /api/browser/actions?ru=&limit= — 時間序動作紀錄（agent 🤖 / 人 👤）
  if (url === "/api/browser/actions" && method === "GET") {
    const limit = Math.min(parseInt(q.get("limit") || "100", 10) || 100, 200);
    json(res, 200, { ok: true, actions: browserActions(key, limit) });
    return true;
  }
  // GET /api/browser/shot?ru=&f=act-0001.png — 取指定步驟截圖（只允許同目錄檔名，防路徑穿越）
  if (url === "/api/browser/shot" && method === "GET") {
    const f = q.get("f") || "";
    if (!/^[\w.-]+\.(png|jpe?g)$/i.test(f) || f.includes("..")) { json(res, 400, { error: "bad file name" }); return true; }
    const { existsSync: _ex, readFileSync: _rd } = await import("fs");
    const p = join(browserShotDir(key), f);
    try {
      if (!_ex(p)) { json(res, 404, { error: "shot not found" }); return true; }
      const buf = _rd(p);
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": buf.length, "Cache-Control": "public, max-age=3600" });
      res.end(buf);
    } catch (e) { json(res, 500, { error: e.message }); }
    return true;
  }

  // GET /api/browser/clipboard?ru= — 讀瀏覽器的剪貼簿（GitHub copy 按鈕等寫入的內容 → 人按 📋 取回本機）
  if (url === "/api/browser/clipboard" && method === "GET") {
    try {
      const page = await getBrowserPage(key);
      trackPage(key, page);
      const text = await page.evaluate(() => (typeof navigator !== "undefined" && navigator.clipboard)
        ? navigator.clipboard.readText().catch(() => "")
        : "");
      json(res, 200, { ok: true, text: String(text ?? "") });
    } catch (err) {
      json(res, 500, { ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  // POST /api/browser/input — 輸入回注（人的操作直接進 agent 的 browser；per instance）
  if (url === "/api/browser/input" && method === "POST") {
    let body = null;
    try { body = JSON.parse(await readBody(req) || "null"); } catch {}
    if (!body) { json(res, 400, { error: "json body required" }); return true; }
    const bKey = resolveBrowserKey(body.ru || q.get("ru"));
    try {
      await applyBrowserInput(bKey, body);
      json(res, 200, { ok: true });
    } catch (e) {
      const s = browserState(bKey);
      json(res, 400, {
        error: e.message,
        installHint: s.available === false ? PLAYWRIGHT_INSTALL_HINT : null,
      });
    }
    return true;
  }

  // GET /api/browser/status?ru=
  if (url === "/api/browser/status" && method === "GET") {
    const s = browserState(key);
    json(res, 200, {
      ...s,
      installHint: s.available === false ? PLAYWRIGHT_INSTALL_HINT : null,
    });
    return true;
  }

  // GET /api/browser/screenshot?ru= — latest.png（per instance 目錄）
  if (url === "/api/browser/screenshot" && method === "GET") {
    const latest = join(browserShotDir(key), "latest.png");
    try {
      if (!existsSync(latest)) { json(res, 404, { error: "no screenshot yet" }); return true; }
      const buf = readFileSync(latest);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": buf.length,
        "Cache-Control": "no-store",
      });
      res.end(buf);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
    return true;
  }

  return false; // not handled
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Browser API — 內建瀏覽器狀態 + 截圖 + 共用串流（IDE Browser tab 用）
 *
 * GET  /api/browser/status      — 目前頁面狀態（url/title/ready/error/lastScreenshot）
 * GET  /api/browser/screenshot  — 最新截圖 PNG bytes（?t=<ts> 防 cache）
 * GET  /api/browser/stream      — SSE：Cowork 級共用串流（CDP screencast frames，即時畫面下行）
 * POST /api/browser/navigate    — 手動導航（IDE 網址列用；與 agent 共用同一個 page）
 * POST /api/browser/input       — 輸入回注（人的滑鼠/滾輪/鍵盤/IME 文字 → agent 的 browser）
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { DATA_HOME } from "../data-home.mjs";
import {
  browserState, PLAYWRIGHT_INSTALL_HINT, getBrowserPage, trackPage, takeScreenshot, assertSafeUrl,
  attachStreamClient, detachStreamClient, applyBrowserInput, kickScreencast,
} from "../lib/browser-session.mjs";

const SHOT_DIR = join(DATA_HOME, "logs", "browser");

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

  // POST /api/browser/navigate {url} — 手動導航（IDE 網址列用；與 agent 共用同一個 page）
  if (url === "/api/browser/navigate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch {}
    const target0 = (body.url || "").trim();
    if (!target0) { json(res, 400, { error: "url required" }); return true; }
    const target = /^https?:\/\//i.test(target0) ? target0 : "https://" + target0;
    try {
      assertSafeUrl(target);
      const page = await getBrowserPage(DATA_HOME);
      trackPage(page);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
      const shot = await takeScreenshot(DATA_HOME, page);
      kickScreencast(); // 共用模式的 viewer 立即看到新頁面（best effort，不 await）
      const s = browserState();
      json(res, 200, { ...s, screenshot: shot });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  // GET /api/browser/stream — SSE 共用串流（Cowork 級：人看 agent 瀏覽器即時畫面）
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
    attachStreamClient(res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
        if (typeof res.flush === "function") res.flush();
      } catch {}
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      detachStreamClient(res);
    });
    return true;
  }

  // GET /api/browser/clipboard — 讀共享瀏覽器的剪貼簿（GitHub copy 按鈕等寫入的內容 → 人按 📋 取回本機）
  if (url === "/api/browser/clipboard" && method === "GET") {
    try {
      const page = await getBrowserPage(DATA_HOME);
      trackPage(page);
      const text = await page.evaluate(() => (typeof navigator !== "undefined" && navigator.clipboard)
        ? navigator.clipboard.readText().catch(() => "")
        : "");
      json(res, 200, { ok: true, text: String(text ?? "") });
    } catch (err) {
      json(res, 500, { ok: false, error: err?.message || String(err) });
    }
    return true;
  }

  // POST /api/browser/input — 輸入回注（共用模式：人的操作直接進 agent 的 browser）
  if (url === "/api/browser/input" && method === "POST") {
    let body = null;
    try { body = JSON.parse(await readBody(req) || "null"); } catch {}
    if (!body) { json(res, 400, { error: "json body required" }); return true; }
    try {
      await applyBrowserInput(body);
      json(res, 200, { ok: true });
    } catch (e) {
      const s = browserState();
      json(res, 400, {
        error: e.message,
        installHint: s.available === false ? PLAYWRIGHT_INSTALL_HINT : null,
      });
    }
    return true;
  }

  // GET /api/browser/status
  if (url === "/api/browser/status" && method === "GET") {
    const s = browserState();
    json(res, 200, {
      ...s,
      installHint: s.available === false ? PLAYWRIGHT_INSTALL_HINT : null,
    });
    return true;
  }

  // GET /api/browser/screenshot — latest.png
  if (url === "/api/browser/screenshot" && method === "GET") {
    const latest = join(SHOT_DIR, "latest.png");
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

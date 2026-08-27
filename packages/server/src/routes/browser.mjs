/**
 * Browser API — 內建瀏覽器狀態 + 截圖（IDE Browser tab 用）
 *
 * GET /api/browser/status      — 目前頁面狀態（url/title/ready/error/lastScreenshot）
 * GET /api/browser/screenshot  — 最新截圖 PNG bytes（?t=<ts> 防 cache）
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { DATA_HOME } from "../data-home.mjs";
import { browserState, PLAYWRIGHT_INSTALL_HINT, getBrowserPage, trackPage, takeScreenshot, assertSafeUrl } from "../lib/browser-session.mjs";

const SHOT_DIR = join(DATA_HOME, "logs", "browser");

export default async function browserRoute(req, res) {
  const method = req.method;
  const url = (req.url || "").split("?")[0];

  // POST /api/browser/navigate {url} — 手動導航（IDE 網址列用；與 agent 共用同一個 page）
  if (url === "/api/browser/navigate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await new Promise((r) => { let b = ""; req.on("data", c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on("end", () => r(b)); req.on("error", () => r("")); }) || "{}"); } catch {}
    const target0 = (body.url || "").trim();
    if (!target0) { json(res, 400, { error: "url required" }); return true; }
    const target = /^https?:\/\//i.test(target0) ? target0 : "https://" + target0;
    try {
      assertSafeUrl(target);
      const page = await getBrowserPage(DATA_HOME);
      trackPage(page);
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
      const shot = await takeScreenshot(DATA_HOME, page);
      const s = browserState();
      json(res, 200, { ...s, screenshot: shot });
    } catch (e) {
      json(res, 400, { error: e.message });
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

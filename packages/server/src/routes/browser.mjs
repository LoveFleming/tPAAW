/**
 * Browser API — 內建瀏覽器狀態 + 截圖（IDE Browser tab 用）
 *
 * GET /api/browser/status      — 目前頁面狀態（url/title/ready/error/lastScreenshot）
 * GET /api/browser/screenshot  — 最新截圖 PNG bytes（?t=<ts> 防 cache）
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

import { DATA_HOME } from "../data-home.mjs";
import { browserState, PLAYWRIGHT_INSTALL_HINT } from "../lib/browser-session.mjs";

const SHOT_DIR = join(DATA_HOME, "logs", "browser");

export default async function browserRoute(req, res) {
  const method = req.method;
  const url = (req.url || "").split("?")[0];

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

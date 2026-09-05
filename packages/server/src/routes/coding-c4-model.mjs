/**
 * coding-c4-model.mjs — C4 Model API（2026-09-05）
 *
 *   GET  /c4-model?path=            — 讀 .paaw/c4-model.json（缺檔回 missing，不燒 token）
 *   POST /c4-model/rescan  { path } — 收集證據 + LLM 組裝（花 token）
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { organizeC4Model } from "../lib/c4-model-scan.mjs";
import { callProjectLLM } from "./coding.mjs";

function _json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function _readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"); } catch { return {}; }
}

export default async function c4ModelRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-project/c4-model")) return next?.() ?? false;

  if (url === "/api/coding-project/c4-model" && method === "GET") {
    const projectPath = q.get("path");
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;
    const p = join(resolve(projectPath), ".paaw", "c4-model.json");
    if (!existsSync(p)) return _json(res, 200, { ok: true, missing: true }) || true;
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      return _json(res, 200, { ok: true, ...data }) || true;
    } catch (e) {
      return _json(res, 200, { ok: true, missing: true, error: e.message }) || true;
    }
  }

  if (url === "/api/coding-project/c4-model/rescan" && method === "POST") {
    const body = await _readBody(req);
    if (!body.path || !existsSync(body.path)) return _json(res, 400, { error: "path required" }) || true;
    try {
      const result = await organizeC4Model(resolve(body.path), {
        callLLM: (llmBody) => callProjectLLM(llmBody, { caller: "architect", agentId: "architect", timeoutMs: 600_000, maxRetries: 2 }),
      });
      return _json(res, 200, { ok: true, ...result }) || true;
    } catch (e) {
      return _json(res, 500, { error: `c4 organize failed: ${e.message}` }) || true;
    }
  }

  return next?.() ?? false;
}

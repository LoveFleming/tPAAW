/**
 * coding-error-codes.mjs — Error Codes by Feature API（2026-09-05 v2）
 *
 * v2（Fleming 方向修正）：不認命名慣例 — 程式收集 error 訊號，LLM 語意整理。
 * 全新 RU 沒系統性慣例 → LLM 在 recommendation 建議導入 Error Code Rules v1。
 *
 *   GET  /error-codes?path=            — 讀 .paaw/error-codes.json（缺檔回 missing，不自動燒 token）
 *   POST /error-codes/rescan  { path } — 收集訊號 + LLM 整理（花 token）
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { organizeErrorCodes } from "../lib/error-code-scan.mjs";
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

export default async function errorCodesRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-project/error-codes")) return next?.() ?? false;

  if (url === "/api/coding-project/error-codes" && method === "GET") {
    const projectPath = q.get("path");
    if (!projectPath || !existsSync(projectPath)) return _json(res, 400, { error: "path required" }) || true;
    const p = join(resolve(projectPath), ".paaw", "error-codes.json");
    if (!existsSync(p)) return _json(res, 200, { ok: true, missing: true }) || true;
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      return _json(res, 200, { ok: true, ...data }) || true;
    } catch (e) {
      return _json(res, 200, { ok: true, missing: true, error: e.message }) || true;
    }
  }

  if (url === "/api/coding-project/error-codes/rescan" && method === "POST") {
    const body = await _readBody(req);
    if (!body.path || !existsSync(body.path)) return _json(res, 400, { error: "path required" }) || true;
    try {
      const result = await organizeErrorCodes(resolve(body.path), {
        callLLM: (llmBody) => callProjectLLM(llmBody, { caller: "em", agentId: "em", timeoutMs: 600_000, maxRetries: 2 }),
      });
      if (result.skipped) return _json(res, 200, { ok: true, skipped: true, reason: result.reason }) || true;
      return _json(res, 200, { ok: true, ...result }) || true;
    } catch (e) {
      return _json(res, 500, { error: `organize failed: ${e.message}` }) || true;
    }
  }

  return next?.() ?? false;
}

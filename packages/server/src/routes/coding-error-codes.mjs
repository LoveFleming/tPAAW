/**
 * coding-error-codes.mjs — Error Codes by Feature API（2026-09-05）
 *
 * CU 機器步驟的查詢/重掃/LLM 註解入口。
 *
 *   GET  /error-codes?path=            — 讀 .paaw/error-codes.json（缺檔自動掃一次）
 *   POST /error-codes/rescan  { path } — 重掃（零 token）
 *   POST /error-codes/annotate { path }— LLM 註解（只註解不增刪：output 只保留已存在 featureId）
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { scanErrorCodes } from "../lib/error-code-scan.mjs";
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

function _load(root) {
  const p = join(root, ".paaw", "error-codes.json");
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  }
  return scanErrorCodes(root); // 缺檔/壞檔 → 現場掃（便宜、冪等）
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
    const data = _load(resolve(projectPath));
    return _json(res, 200, { ok: true, ...data }) || true;
  }

  if (url === "/api/coding-project/error-codes/rescan" && method === "POST") {
    const body = await _readBody(req);
    if (!body.path || !existsSync(body.path)) return _json(res, 400, { error: "path required" }) || true;
    const result = scanErrorCodes(resolve(body.path));
    return _json(res, 200, { ok: true, ...result }) || true;
  }

  if (url === "/api/coding-project/error-codes/annotate" && method === "POST") {
    const body = await _readBody(req);
    if (!body.path || !existsSync(body.path)) return _json(res, 400, { error: "path required" }) || true;
    const root = resolve(body.path);
    const data = _load(root);
    if (!data.byFeature?.length) return _json(res, 400, { error: "沒有 error codes 可註解（先跑掃描）" }) || true;

    // 壓縮素材：每個 feature  unique codes + 檔案（context 全帶會爆 token）
    const compact = data.byFeature.map(g => ({
      featureId: g.featureId,
      featureName: g.featureName,
      codes: [...new Set(g.codes.map(c => c.code))].slice(0, 30),
      files: [...new Set(g.codes.map(c => c.file))].slice(0, 10),
      issues: [...new Set(g.codes.flatMap(c => c.issues || []))].slice(0, 8),
    }));

    const system = `你是 code review 助理。依 Error Code 命名規範（CODE_CLASS_AREA_FAMILY_DETAIL：SYS|BIZ|EXT / 分層 area / 穩定 family）為每個 feature 的 error codes 寫語意註解。
規則：
1. 只註解，不增刪任何 code — 你沒有新增建議權限
2. notes 引用實際 code（證據），不要發明不存在的 code
3. suggestions 只提命名一致性/語意改進，每 feature 最多 3 條
4. 回傳純 JSON：{"<featureId>": {"summary": "1-2 句語意摘要", "notes": ["..."], "suggestions": ["..."]}}
5. 繁體中文，技術術語保留英文`;

    let annotations = {};
    try {
      const llm = await callProjectLLM({
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ rules: data.rulesUsed, features: compact }) },
        ],
        temperature: 0.2,
        thinking: { type: "disabled" },
      }, { caller: "em", agentId: "em", timeoutMs: 120_000, maxRetries: 2 });

      let txt = String(llm?.content || "").trim();
      const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) txt = fence[1].trim();
      const parsed = JSON.parse(txt);
      // 驗證層：只保留掃描結果已存在的 featureId；型別清洗；上限
      const validIds = new Set(compact.map(f => f.featureId));
      for (const [fid, val] of Object.entries(parsed)) {
        if (!validIds.has(fid) || typeof val !== "object" || !val) continue;
        annotations[fid] = {
          summary: String(val.summary || "").slice(0, 400),
          notes: (Array.isArray(val.notes) ? val.notes : []).filter(n => typeof n === "string").slice(0, 8).map(n => n.slice(0, 300)),
          suggestions: (Array.isArray(val.suggestions) ? val.suggestions : []).filter(s => typeof s === "string").slice(0, 3).map(s => s.slice(0, 300)),
        };
      }
    } catch (e) {
      return _json(res, 500, { error: `annotate failed: ${e.message}` }) || true;
    }

    if (!Object.keys(annotations).length) return _json(res, 500, { error: "LLM 回傳無有效註解" }) || true;

    const p = join(root, ".paaw", "error-codes.json");
    writeFileSync(p, JSON.stringify({ ...data, annotations, annotatedAt: new Date().toISOString() }, null, 2));
    return _json(res, 200, { ok: true, annotated: Object.keys(annotations).length }) || true;
  }

  return next?.() ?? false;
}

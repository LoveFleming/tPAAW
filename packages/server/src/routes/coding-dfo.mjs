/**
 * coding-dfo.mjs — DFO（Design for Operation）API Routes（2026-11-20 Fleming）
 *
 * DFO = Handover + Troubleshooting 合併的維運設計文件，owner Greta（coding.ops）。
 * 版本控制：.paaw/dfo/dfo.json 現行版 + versions/v{N}.json 不可變快照（lib/dfo.mjs）。
 *
 * Routes:
 *   GET  /api/coding-dfo?path=                 — 讀現行版（無 → { exists: false }）
 *   GET  /api/coding-dfo/versions?path=        — 版本清單
 *   GET  /api/coding-dfo/versions/:v?path=     — 讀指定版（:v=all 表示最新）
 *   POST /api/coding-dfo/generate              — 🔄 AI 全量更新（參考舊版+CU 知識庫+git log；一次 LLM）
 *   POST /api/coding-dfo/section               — 寫單節（dfo_write 工具/UI 用；sections schema 驗證）
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { readDfo, readDfoVersion, listDfoVersions, writeDfo, validateDfo, DFO_SECTIONS, dfoDir, dfoFrozenReason } from "../lib/dfo.mjs";
import { createPaawProject } from "../lib/paaw-project.mjs";
import { callProjectLLM, CU_LLM_OPTS, parseQuery } from "./coding-helpers.mjs";
import { scanProjectFiles } from "./coding-health.mjs";

const execAsync = promisify(_exec);
const __dirname = fileURLToPath(new URL(".", import.meta.url));

function readBody(req) {
  return new Promise((resolveBody) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 20_000_000) req.destroy(); });
    req.on("end", () => resolveBody(raw));
    req.on("error", () => resolveBody(""));
  });
}

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

/** prompt 載入：.paaw override > packages 內建 */
function loadDfoPrompt(root) {
  const override = join(root, ".paaw", "prompts", "code-understanding", "gen-dfo.md");
  if (existsSync(override)) { try { return readFileSync(override, "utf-8"); } catch {} }
  return readFileSync(join(__dirname, "..", "prompts", "code-understanding", "gen-dfo.md"), "utf-8");
}

export default async function dfoRoutes(req, res) {
  const url = req.url.split("?")[0];
  const method = req.method;
  const q = parseQuery(req.url);
  const root = q.path ? resolve(q.path) : null;
  if (!root && !url.startsWith("/api/coding-dfo")) return false; // POST 端點可從 body.cwd 取 root

  try {
    // GET /api/coding-dfo — 現行版
    if (url === "/api/coding-dfo" && method === "GET") {
      const dfo = readDfo(root);
      return json(res, 200, dfo
        ? { exists: true, dfo, versions: listDfoVersions(root), frozen: await dfoFrozenReason(root) }
        : { exists: false, versions: listDfoVersions(root), sections: DFO_SECTIONS });
    }

    // GET /api/coding-dfo/versions — 清單
    if (url === "/api/coding-dfo/versions" && method === "GET") {
      return json(res, 200, { versions: listDfoVersions(root) });
    }

    // GET /api/coding-dfo/versions/:v — 指定版（all=最新）
    const verMatch = url.match(/^\/api\/coding-dfo\/versions\/([^/?]+)$/);
    if (verMatch && method === "GET") {
      const v = verMatch[1] === "all" ? null : verMatch[1];
      const dfo = readDfoVersion(root, v);
      if (!dfo) return json(res, 404, { error: `版本不存在：${verMatch[1]}` });
      return json(res, 200, { dfo });
    }

    // POST /api/coding-dfo/generate — 🔄 AI 全量更新（一次 LLM，JSON 回應）
    if (url === "/api/coding-dfo/generate" && method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const genRoot = body.cwd || body.path ? resolve(String(body.cwd || body.path)) : root; // UI 傳 cwd（2026-11-20 實測抓到的 404）
      if (!genRoot) return json(res, 400, { error: "缺少 path（query）或 cwd（body）" });
      const modelOverride = body.model || null;
      // 凍結檢查：現行版屬於已關閉的 RR → 不可改（2026-11-21 Fleming）
      const frozen = await dfoFrozenReason(genRoot);
      if (frozen) return json(res, 403, { error: frozen });
      const rrLabel = body.rr ? String(body.rr).trim() : null; // 版本代號 = RR id（首次無 RR = initial）
      // 蒐證：現行 DFO + CU 知識庫 + git log + package.json + 檔案樹
      const paaw = createPaawProject(genRoot);
      const current = readDfo(genRoot);
      const ctxParts = [];
      if (current) {
        ctxParts.push(`--- 現行 DFO（v${current.version}，${current.updatedAt} by ${current.updatedBy}）— 延續性基礎 ---\n${JSON.stringify(current.sections.map(s => ({ id: s.id, markdown: s.markdown })), null, 1)}`);
      } else {
        ctxParts.push("--- 現行 DFO：無（首次生成，全新寫）---");
      }
      // 2026-11-21 Fleming：全文餵入，不切字數 —「有什麼讀什麼」才不會遺漏
      for (const [file, label] of [["scan.json", "SCAN（專案盤點）"], ["error-codes.json", "ERROR CODES（byFeature + unmapped 全清單）"], ["c4-model.json", "C4 MODEL（system/containers/externalSystems/relationships）"]]) {
        try {
          const c = await paaw.readFile(file);
          if (c && c.trim()) ctxParts.push(`--- ${label} ---\n${c}`);
        } catch {}
      }
      try {
        const feats = await paaw.readFile("features/FEATURES.json");
        if (feats && feats.trim()) ctxParts.push(`--- FEATURES ---\n${feats}`);
      } catch {}
      // 2026-11-21 Fleming：除了 code 也要參考 task / ADR / changelog / 人的備註 — 文件才會寫得正確
      try {
        const { docEvidenceBlock } = await import("../lib/doc-evidence.mjs");
        const ev = docEvidenceBlock(genRoot);
        if (ev.trim()) ctxParts.push(`--- 專案脈絡：TASKS / ADR / CHANGELOG / KNOWN ISSUES / 人的備註 ---\n${ev}`);
      } catch {}
      try {
        const pkg = readFileSync(join(genRoot, "package.json"), "utf-8");
        ctxParts.push(`--- package.json ---\n${pkg}`);
      } catch {}
      try {
        const { stdout } = await execAsync("git log --oneline -100", { cwd: genRoot, timeout: 15000 });
        ctxParts.push(`--- git log（最近 30 commit）---\n${stdout}`);
      } catch {}
      try {
        const tree = await scanProjectFiles(genRoot);
        ctxParts.push(`--- 檔案樹（完整）---\n${String(tree)}`);
      } catch {}

      const prompt = `${loadDfoPrompt(genRoot)}\n\n${ctxParts.join("\n\n")}`;
      const result = await callProjectLLM({
        model: modelOverride || undefined,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        thinking: { type: "disabled" },
      }, { ...CU_LLM_OPTS, timeoutMs: 600_000, maxRetries: 2 });

      const content = (result.content || "").trim();
      if (!content) return json(res, 500, { error: "AI 回應為空，DFO 未更新" });
      // 解析 JSON（容錯 code fence）
      let parsed;
      const cleaned = content.replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) return json(res, 500, { error: "AI 回應不是合法 JSON，DFO 未更新（可重試）" });
        try { parsed = JSON.parse(m[0]); } catch { return json(res, 500, { error: "AI 回應 JSON 解析失敗，DFO 未更新（可重試）" }); }
      }
      if (!Array.isArray(parsed.sections)) return json(res, 500, { error: "AI 回應缺少 sections 陣列" });
      // 寫入（writeDfo 內部：schema 驗證 + SKIP 區塊機械保留 + 版本快照）
      try {
        const dfo = writeDfo(genRoot, parsed.sections, "greta:generate", rrLabel);
        return json(res, 200, { ok: true, version: dfo.version, updatedAt: dfo.updatedAt, sections: dfo.sections.map(s => ({ id: s.id, chars: s.markdown.length })) });
      } catch (e) {
        return json(res, 400, { error: `DFO 寫入被 schema 擋下：${e.message}` });
      }
    }

    // POST /api/coding-dfo/section — 寫單節（dfo_write 工具 / UI）
    if (url === "/api/coding-dfo/section" && method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const secRoot = body.cwd || body.path ? resolve(String(body.cwd || body.path)) : root;
      if (!secRoot) return json(res, 400, { error: "缺少 path（query）或 cwd（body）" });
      const id = body.id, markdown = String(body.markdown || "").trim();
      if (!DFO_SECTIONS.some(s => s.id === id)) return json(res, 400, { error: `不合法 section id：${id}（合法：${DFO_SECTIONS.map(s => s.id).join(", ")}）` });
      if (!markdown) return json(res, 400, { error: "markdown 不可為空" });
      const frozenSec = await dfoFrozenReason(secRoot);
      if (frozenSec) return json(res, 403, { error: frozenSec });
      const dfo = writeDfo(secRoot, [{ id, markdown }], body.updatedBy || `user:${"manual"}`);
      return json(res, 200, { ok: true, version: dfo.version, updatedAt: dfo.updatedAt });
    }

    return false;
  } catch (err) {
    if (url.startsWith("/api/coding-dfo")) return json(res, 500, { error: err.message });
    return next();
  }
}

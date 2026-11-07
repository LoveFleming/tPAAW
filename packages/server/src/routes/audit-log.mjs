/**
 * audit-log.mjs — 安全審計紀錄 API Routes（2026-10-11 Fleming）
 *
 * 「AI 犯傻」審計事件由 audit-log.mjs 落盤在 {ASSET_LOGS_ROOT}/audit/audit-YYYY-MM-DD.jsonl
 * （事實來源；同時即時送 ES paaw-audit-*）。本 route 把這些檔案公開成可讀報表 —
 * 讓 PAAW 內就能看審計紀錄，不必依賴 Elasticsearch。
 *
 * 鐵律：純唯讀。只讀 audit/ 目錄、檔名嚴格驗證（防路徑穿越）。
 *
 * Routes:
 *   GET /api/audit-log/dates                  → 有哪些日期的 audit 檔
 *   GET /api/audit-log?date=&kinds=&severity=&limit=&q=  → 當日事件 + 統計
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { ASSET_LOGS_ROOT } from "../data-home.mjs";

const AUDIT_DIR = join(ASSET_LOGS_ROOT, "audit");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function listDates() {
  if (!existsSync(AUDIT_DIR)) return [];
  let files = [];
  try { files = await readdir(AUDIT_DIR); } catch { return []; }
  return files
    .map(f => (f.match(/^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/) || [])[1])
    .filter(Boolean)
    .sort()
    .reverse(); // 新→舊
}

export default async function auditLogRoutes(req, res) {
  const urlObj = new URL(req.url || "", "http://localhost");
  const pathname = urlObj.pathname;

  const json = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
  };

  // ── GET /api/audit-log/dates ──
  if (req.method === "GET" && pathname === "/api/audit-log/dates") {
    const dates = await listDates();
    return json(200, { ok: true, dates, latest: dates[0] || null });
  }

  // ── GET /api/audit-log?date=&kinds=&severity=&limit=&q= ──
  if (req.method === "GET" && pathname === "/api/audit-log") {
    const dates = await listDates();
    let date = urlObj.searchParams.get("date") || dates[0] || "";
    if (date && !DATE_RE.test(date)) return json(400, { ok: false, error: "Invalid date" });
    if (!date) return json(200, { ok: true, date: null, exists: false, count: 0, events: [], stats: null, dates });

    const file = `audit-${date}.jsonl`;
    const p = join(AUDIT_DIR, file);
    if (!existsSync(p)) return json(200, { ok: true, date, exists: false, count: 0, events: [], stats: null, dates });
    if (basename(p) !== file) return json(400, { ok: false, error: "Invalid path" });

    let text = "";
    try { text = await readFile(p, "utf-8"); }
    catch (err) { return json(500, { ok: false, error: String(err.message || err) }); }

    const kindsFilter = (urlObj.searchParams.get("kinds") || "").split(",").map(s => s.trim()).filter(Boolean);
    const sevFilter = (urlObj.searchParams.get("severity") || "").trim();
    const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
    const rawLimit = parseInt(urlObj.searchParams.get("limit") || "300", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 300, 1), 2000);

    const all = [];
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try { all.push(JSON.parse(s)); } catch { /* skip malformed */ }
    }

    // 統計（用全部事件，不受 filter 影響 — 讓使用者看到全貌）
    const byKind = {}, bySeverity = {}, byLayer = {}, byAgent = {};
    for (const e of all) {
      byKind[e.kind || "unknown"] = (byKind[e.kind || "unknown"] || 0) + 1;
      bySeverity[e.severity || "warn"] = (bySeverity[e.severity || "warn"] || 0) + 1;
      byLayer[e.layer || "unknown"] = (byLayer[e.layer || "unknown"] || 0) + 1;
      if (e.agentId) byAgent[e.agentId] = (byAgent[e.agentId] || 0) + 1;
    }

    // filter（新→舊）
    const filtered = all.filter(e => {
      if (kindsFilter.length && !kindsFilter.includes(e.kind)) return false;
      if (sevFilter && e.severity !== sevFilter) return false;
      if (q) {
        const hay = `${e.kind || ""} ${e.tool || ""} ${e.command || ""} ${e.reason || ""} ${e.agentId || ""} ${e.layer || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).reverse();

    return json(200, {
      ok: true,
      date,
      exists: true,
      total: all.length,
      count: filtered.length,
      events: filtered.slice(0, limit),
      truncated: filtered.length > limit,
      stats: { byKind, bySeverity, byLayer, byAgent },
      dates,
    });
  }

  return false;
}

/**
 * sheets — Excel 引擎（SheetJS）
 *   POST /api/sre/sheets/read  {service, file, maxRows?, sheet?} → 表格資料
 *   POST /api/sre/sheets/write {service, file, headers, rows}    → 產 xlsx 落櫃
 */
import { existsSync } from "fs";
import { join, basename } from "path";
import { readBody, PAAW_ROOT } from "./shared.mjs";

async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/sre/sheets")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const body = await parseBody(req);
    const _xlsx = await import("xlsx");
    const XLSX = _xlsx.default ?? _xlsx;
    const svc = String(body.service || body.project || body.category || "");
    const name = basename(String(body.file || ""));
    if (!svc || !name || name.includes("..")) return json(400, { error: "service / file 必填（合法名）" });
    const fp = join(PAAW_ROOT, "dossiers", svc, name);
    const sub = url.pathname.split("/").pop();

    if (sub === "read") {
      if (!existsSync(fp)) return json(404, { error: `檔案不存在：${svc}/${name}` });
      const wb = XLSX.readFile(fp);
      const sheetName = body.sheet && wb.SheetNames.includes(body.sheet) ? body.sheet : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      const maxRows = Math.min(Math.max(Number(body.maxRows) || 30, 1), 200);
      return json(200, {
        ok: true, service: svc, file: name, sheets: wb.SheetNames, sheet: sheetName,
        headers: rows[0] || [], rows: rows.slice(1, 1 + maxRows), totalRows: Math.max(0, rows.length - 1), truncated: rows.length - 1 > maxRows,
      });
    }

    if (sub === "write") {
      const headers = Array.isArray(body.headers) ? body.headers.map(String) : [];
      const data = Array.isArray(body.rows) ? body.rows.map(r => Array.isArray(r) ? r.map(v => (v === null || v === undefined) ? "" : v) : [String(r)]) : [];
      if (!headers.length) return json(400, { error: "headers 必填" });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(10, Math.min(30, String(h).length * 2 + 4)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = fp.endsWith(".xlsx") ? fp : `${fp}.xlsx`;
      XLSX.writeFile(wb, out);
      return json(200, { ok: true, service: svc, file: basename(out), rows: data.length });
    }

    return json(400, { error: "unknown sheets subroute" });
  } catch (e) {
    return json(400, { error: e.message });
  }
}

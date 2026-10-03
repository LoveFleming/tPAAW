/**
 * sheets — Excel 引擎（SheetJS）
 *   POST /api/secret/sheets/read  {category, file, maxRows?, sheet?} → 表格資料
 *   POST /api/secret/sheets/write {category, file, headers, rows}    → 產 xlsx 落櫃
 */
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { readBody, PAAW_ROOT } from "./shared.mjs";

/** readBody 回 raw string — 這裡 parse + 空 body 容錯（同 learning module 慣例） */
async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/secret/sheets")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const body = await parseBody(req);
    const _xlsx = await import("xlsx");
      const XLSX = _xlsx.default ?? _xlsx; // CJS interop：named exports 偵測不全（readFile 會漏），default 才是全套
    const cat = String(body.category || "");
    const name = basename(String(body.file || ""));
    if (!cat || !name || name.includes("..")) return json(400, { error: "category / file 必填（合法名）" });
    const fp = join(PAAW_ROOT, "dossiers", cat, name);
    const sub = url.pathname.split("/").pop();

    if (sub === "read") {
      if (!existsSync(fp)) return json(404, { error: `檔案不存在：${cat}/${name}` });
      const wb = XLSX.readFile(fp);
      const sheetName = body.sheet && wb.SheetNames.includes(body.sheet) ? body.sheet : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      const maxRows = Math.min(Math.max(Number(body.maxRows) || 30, 1), 200);
      return json(200, {
        ok: true, category: cat, file: name, sheets: wb.SheetNames, sheet: sheetName,
        headers: rows[0] || [], rows: rows.slice(1, 1 + maxRows), totalRows: Math.max(0, rows.length - 1), truncated: rows.length - 1 > maxRows,
      });
    }

    if (sub === "write") {
      const headers = Array.isArray(body.headers) ? body.headers.map(String) : [];
      const data = Array.isArray(body.rows) ? body.rows.map(r => Array.isArray(r) ? r.map(v => (v === null || v === undefined) ? "" : v) : [String(r)]) : [];
      if (!headers.length) return json(400, { error: "headers 必填" });
      const aoa = [headers, ...data];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(10, Math.min(30, String(h).length * 2 + 4)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, fp.endsWith(".csv") ? fp.replace(/\.csv$/i, ".xlsx") : (fp.endsWith(".xlsx") ? fp : `${fp}.xlsx`));
      return json(200, { ok: true, category: cat, file: basename(fp.endsWith(".xlsx") ? fp : `${fp}.xlsx`), rows: data.length });
    }

    return json(400, { error: "unknown sheets subroute" });
  } catch (e) {
    return json(400, { error: e.message });
  }
}

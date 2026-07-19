/**
 * coding-reports.mjs — Night Shift 報告 API（統一版）
 *
 * GET    /api/coding-reports/list?path=...        — 列出所有報告
 * GET    /api/coding-reports/:date?path=...       — 取得單一報告內容
 * DELETE /api/coding-reports/:date?path=...       — 刪除報告
 *
 * 報告來源：
 *   - .paaw/night-shift/reports/ （新，EM + Parallel 共用）
 *   - .paaw/overnight-reports/   （舊，向後相容）
 *
 * 核心邏輯在 lib/night-shift-shared.mjs
 */

import { listNightShiftReports, readNightShiftReport, deleteNightShiftReport } from "../lib/night-shift-shared.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default async function codingReportsRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();

  const sendJSON = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // GET /api/coding-reports/list
  if (req.method === 'GET' && url.includes('/api/coding-reports/list')) {
    try {
      const reports = await listNightShiftReports(rootDir);
      sendJSON(200, { reports, total: reports.length });
    } catch (err) {
      sendJSON(500, { error: err.message });
    }
    return true;
  }

  // GET/DELETE /api/coding-reports/:date
  const dateMatch = url.match(/\/api\/coding-reports\/([\d-]+)/);
  if (dateMatch) {
    const date = dateMatch[1];

    // GET
    if (req.method === 'GET') {
      try {
        const content = await readNightShiftReport(rootDir, date);
        if (content === null) {
          sendJSON(404, { error: `Report ${date} not found` });
        } else {
          sendJSON(200, { date, content });
        }
      } catch (err) {
        sendJSON(500, { error: err.message });
      }
      return true;
    }

    // DELETE
    if (req.method === 'DELETE') {
      try {
        const deleted = await deleteNightShiftReport(rootDir, date);
        if (!deleted) {
          sendJSON(404, { error: `Report ${date} not found` });
        } else {
          sendJSON(200, { deleted: true, date });
        }
      } catch (err) {
        sendJSON(500, { error: err.message });
      }
      return true;
    }
  }

  return false;
}

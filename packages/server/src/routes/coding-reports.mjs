/**
 * coding-reports.mjs — EM Reports API
 *
 * GET /api/coding-reports/list?path=...        — 列出所有報告
 * GET /api/coding-reports/:date?path=...       — 取得單一報告內容
 * DELETE /api/coding-reports/:date?path=...    — 刪除報告
 */

import { readFile, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function codingReportsRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();
  const reportsDir = join(rootDir, '.paaw', 'overnight-reports');

  // GET /api/coding-reports/list
  if (req.method === 'GET' && url.includes('/api/coding-reports/list')) {
    try {
      if (!existsSync(reportsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reports: [] }));
        return true;
      }

      const files = await readdir(reportsDir);
      const reports = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const date = file.replace('.md', '');
        const fullPath = join(reportsDir, file);
        const stats = await stat(fullPath);

        // Read first few lines for summary
        let summary = '';
        let resultLine = '';
        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          // Extract result from header (e.g. "**結果：** ✅ 3 成功 / ❌ 1 失敗")
          const resultMatch = lines.find(l => l.includes('**結果'));
          if (resultMatch) resultLine = resultMatch.replace(/\*\*/g, '').trim();
          // First paragraph after project status as summary
          const summaryStart = lines.findIndex(l => l.startsWith('## 📊') || l.startsWith('## 專案'));
          if (summaryStart >= 0) {
            summary = lines.slice(summaryStart + 1, summaryStart + 4).join(' ').trim().slice(0, 200);
          }
        } catch {}

        reports.push({
          date,
          filename: file,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          result: resultLine,
          summary,
        });
      }

      // Sort by date descending
      reports.sort((a, b) => b.date.localeCompare(a.date));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reports, total: reports.length }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // GET /api/coding-reports/:date
  const dateMatch = url.match(/\/api\/coding-reports\/([\d-]+)/);
  if (req.method === 'GET' && dateMatch) {
    try {
      const date = dateMatch[1];
      const reportPath = join(reportsDir, `${date}.md`);

      if (!existsSync(reportPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Report ${date} not found` }));
        return true;
      }

      const content = await readFile(reportPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ date, content }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // DELETE /api/coding-reports/:date
  if (req.method === 'DELETE' && dateMatch) {
    try {
      const date = dateMatch[1];
      const reportPath = join(reportsDir, `${date}.md`);

      if (!existsSync(reportPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Report ${date} not found` }));
        return true;
      }

      await unlink(reportPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true, date }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  return false;
}

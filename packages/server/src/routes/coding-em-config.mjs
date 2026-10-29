/**
 * coding-em-config.mjs — EM Configuration API Routes
 *
 * GET   /api/coding-em/config?path=...        — Read EM config
 * PATCH /api/coding-em/config?path=...        — Update EM config (partial merge)
 * POST  /api/coding-em/config/reset?path=...  — Reset to defaults
 *
 * EM config is stored at: {project}/.paaw/em/config.json
 */

import { readEMConfig, updateEMConfig, resetEMConfig } from "../lib/em-config.mjs";

export default async function emConfigRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;
  const projectDir = urlObj.searchParams.get('path') || '';

  // ── GET /api/coding-em/config ──
  if (req.method === 'GET' && pathname === '/api/coding-em/config') {
    try {
      if (!projectDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "path" query parameter' }));
        return true;
      }
      const config = readEMConfig(projectDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // ── PATCH /api/coding-em/config ──
  if (req.method === 'PATCH' && pathname === '/api/coding-em/config') {
    try {
      if (!projectDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "path" query parameter' }));
        return true;
      }
      const { readBody } = await import('./shared.mjs');
      const body = JSON.parse(await readBody(req) || '{}');
      const updated = updateEMConfig(projectDir, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config: updated }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // ── POST /api/coding-em/config/reset ──
  if (req.method === 'POST' && pathname === '/api/coding-em/config/reset') {
    try {
      if (!projectDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "path" query parameter' }));
        return true;
      }
      const config = resetEMConfig(projectDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  return false;
}

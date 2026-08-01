/**
 * coding-staged-changes.mjs — Staged Changes Summary API Routes
 *
 * GET    /api/coding-staged/changes?path=...    — Read staged-changes.json
 * POST   /api/coding-staged/changes?path=...    — Write/update staged-changes.json
 * DELETE /api/coding-staged/changes?path=...    — Clear staged-changes.json (after commit)
 *
 * Staged changes summary is stored at: {project}/.paaw/staged-changes.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";

export default async function stagedChangesRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;
  const projectDir = urlObj.searchParams.get('path') || '';
  const filePath = join(projectDir, '.paaw', 'staged-changes.json');

  // ── GET /api/coding-staged/changes ──
  if (req.method === 'GET' && pathname === '/api/coding-staged/changes') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    if (!existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: false }));
      return true;
    }
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: true, ...data }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: false, error: err.message }));
    }
    return true;
  }

  // ── POST /api/coding-staged/changes ──
  if (req.method === 'POST' && pathname === '/api/coding-staged/changes') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(body, null, 2) + "\n");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── DELETE /api/coding-staged/changes ──
  if (req.method === 'DELETE' && pathname === '/api/coding-staged/changes') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}

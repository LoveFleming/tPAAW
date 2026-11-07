/**
 * coding-doc-coverage.mjs — Documentation Coverage API Routes
 *
 * GET   /api/coding-doc/coverage?path=...   — Read doc coverage status
 * POST  /api/coding-doc/coverage?path=...   — Update after doc writing
 * GET   /api/coding-doc/undocumented?path=... — Get undocumented commits
 *
 * Doc coverage is stored at: {project}/.paaw/doc-coverage.json
 */

import { readDocCoverage, writeDocCoverage, updateDocCoverage, getUndocumentedCommits } from "../lib/doc-coverage.mjs";
import { runGit } from "./vibe-fs.mjs";

export default async function docCoverageRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;
  const projectDir = urlObj.searchParams.get('path') || '';

  // ── GET /api/coding-doc/coverage ──
  if (req.method === 'GET' && pathname === '/api/coding-doc/coverage') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const coverage = readDocCoverage(projectDir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(coverage));
    return true;
  }

  // ── POST /api/coding-doc/coverage ──
  if (req.method === 'POST' && pathname === '/api/coding-doc/coverage') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { body = {}; }
    const { lastCommit, documentedCommits } = body;
    const updated = updateDocCoverage(projectDir, lastCommit, documentedCommits || []);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, coverage: updated }));
    return true;
  }

  // ── GET /api/coding-doc/undocumented ──
  if (req.method === 'GET' && pathname === '/api/coding-doc/undocumented') {
    if (!projectDir) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    try {
      const result = await getUndocumentedCommits(projectDir, runGit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return true;
  }

  return false;
}

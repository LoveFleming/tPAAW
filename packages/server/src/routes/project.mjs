/**
 * Project Route — .paaw/ project knowledge API
 *
 * Endpoints:
 *   GET    /api/project/context?path=...        — Get full .paaw/ context
 *   POST   /api/project/init?path=...           — Initialize .paaw/ directory
 *   GET    /api/project/tree?path=...           — Get .paaw/ directory tree
 *   GET    /api/project/sessions?path=...       — List sessions
 *   GET    /api/project/sessions/:filename?path=... — Read specific session
 *   GET    /api/project/standards?path=...      — List standards
 *   GET    /api/project/standards/:name?path=...— Read standard
 *   PUT    /api/project/standards/:name?path=...— Write standard
 *   GET    /api/project/decisions?path=...      — Read decisions
 *   POST   /api/project/decisions?path=...      — Add decision
 *   GET    /api/project/changelog?path=...      — Read changelog
 *   GET    /api/project/file?path=...&file=...  — Read any .paaw/ file
 *   PUT    /api/project/file?path=...&file=...  — Write any .paaw/ file
 *   POST   /api/project/generate-overview?path=... — Auto-generate PROJECT.md
 */

import { readFile, writeFile } from "fs/promises";
import { resolve, join } from "path";
import { createPaawProject } from "../lib/paaw-project.mjs";

// ── Query parser ──

function parseQuery(url) {
  const u = new URL(url, "http://localhost");
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// ── Route Handler ──

export default async function projectRoute(req, res) {
  const method = req.method;
  const url = req.url || "";
  const q = parseQuery(url);

  // All routes start with /api/project
  if (!url.startsWith("/api/project")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const root = resolve(projectPath);
  const paaw = createPaawProject(root);

  try {
    // ── GET /api/project/context ──
    if (url.startsWith("/api/project/context") && method === "GET") {
      const ctx = await paaw.loadContext();
      if (!ctx) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized", initialized: false }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, ...ctx }));
      return true;
    }

    // ── POST /api/project/init ──
    if (url.startsWith("/api/project/init") && method === "POST") {
      const result = await paaw.init();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/project/tree ──
    if (url.startsWith("/api/project/tree") && method === "GET") {
      const tree = await paaw.listTree();
      if (!tree) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return true;
    }

    // ── GET /api/project/sessions/:filename ──
    const sessionMatch = url.match(/^\/api\/project\/sessions\/([^?]+)/);
    if (sessionMatch && method === "GET") {
      const content = await paaw.readSession(decodeURIComponent(sessionMatch[1]));
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── GET /api/project/sessions ──
    if (url.startsWith("/api/project/sessions") && method === "GET") {
      const sessions = await paaw.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return true;
    }

    // ── GET /api/project/standards ──
    if (url.startsWith("/api/project/standards") && !url.match(/\/api\/project\/standards\/[^?]+/) && method === "GET") {
      const standards = await paaw.listStandards();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(standards));
      return true;
    }

    // ── GET/PUT /api/project/standards/:name ──
    const stdMatch = url.match(/^\/api\/project\/standards\/([^?]+)/);
    if (stdMatch) {
      const name = decodeURIComponent(stdMatch[1]);
      if (method === "GET") {
        const content = await paaw.readStandard(name);
        if (content === null) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Standard not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(content);
        }
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const result = await paaw.writeStandard(name, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return true;
      }
    }

    // ── GET /api/project/decisions ──
    if (url.startsWith("/api/project/decisions") && method === "GET") {
      const content = await paaw.readFile("DECISIONS.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── POST /api/project/decisions ──
    if (url.startsWith("/api/project/decisions") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await paaw.addDecision(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/project/changelog ──
    if (url.startsWith("/api/project/changelog") && method === "GET") {
      const content = await paaw.readFile("CHANGELOG.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── GET /api/project/file ──
    if (url.startsWith("/api/project/file") && method === "GET" && q.file) {
      const content = await paaw.readFile(q.file);
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── PUT /api/project/file ──
    if (url.startsWith("/api/project/file") && method === "PUT" && q.file) {
      const body = await readBody(req);
      const result = await paaw.writeFile(q.file, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── POST /api/project/generate-overview ──
    if (url.startsWith("/api/project/generate-overview") && method === "POST") {
      // Ensure .paaw/ exists first
      if (!paaw.exists) await paaw.init();
      const content = await paaw.generateProjectOverview();
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content);
      return true;
    }

  } catch (err) {
    console.error("[project route] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }

  return false;
}

// ── Read request body ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

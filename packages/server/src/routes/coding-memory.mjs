/**
 * Coding Memory Route — Agent long-term memory CRUD for .paaw/AGENT-MEMORY/
 *
 * Endpoints:
 *   GET    /api/coding-memory?path=...                    — List all agent memory files
 *   GET    /api/coding-memory/:agentId?path=...           — Read specific agent memory
 *   PUT    /api/coding-memory/:agentId?path=...           — Write/update agent memory
 *   DELETE /api/coding-memory/:agentId?path=...           — Delete agent memory
 *   POST   /api/coding-memory/:agentId/append?path=...    — Append to agent memory
 */

import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseQuery(rawUrl) {
  const qIdx = rawUrl.indexOf("?");
  if (qIdx < 0) return {};
  const params = {};
  for (const part of rawUrl.slice(qIdx + 1).split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return params;
}

function getMemoryDir(projectPath) {
  return join(projectPath, ".paaw", "AGENT-MEMORY");
}

export default async function codingMemoryRoute(req, res) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = parseQuery(rawUrl);

  if (!url.startsWith("/api/coding-memory")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const memDir = getMemoryDir(projectPath);

  // Ensure dir exists
  if (!existsSync(memDir)) {
    await mkdir(memDir, { recursive: true });
  }

  // ── GET /api/coding-memory (list all) ──
  if (url === "/api/coding-memory" && method === "GET") {
    try {
      const files = await readdir(memDir);
      const mdFiles = files.filter(f => f.endsWith(".md"));
      const memories = [];
      for (const f of mdFiles) {
        const agentId = f.replace(/\.md$/, "");
        try {
          const content = await readFile(join(memDir, f), "utf-8");
          memories.push({
            agentId,
            filename: f,
            size: content.length,
            preview: content.slice(0, 200),
            lines: content.split("\n").length,
            updatedAt: (await import("fs/promises")).then(({ stat }) => stat(join(memDir, f))).then(s => s.mtime.toISOString()).catch(() => null),
          });
        } catch {
          memories.push({ agentId, filename: f, size: 0, preview: "", lines: 0, updatedAt: null });
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ memories }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/coding-memory/:agentId ──
  const singleMatch = url.match(/^\/api\/coding-memory\/([^/?]+)$/);
  if (singleMatch && method === "GET") {
    const agentId = decodeURIComponent(singleMatch[1]);
    const filePath = join(memDir, `${agentId}.md`);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Memory file not found", agentId }));
      return true;
    }
    const content = await readFile(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agentId, content, size: content.length }));
    return true;
  }

  // ── PUT /api/coding-memory/:agentId (write/replace) ──
  if (singleMatch && method === "PUT") {
    const agentId = decodeURIComponent(singleMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const filePath = join(memDir, `${agentId}.md`);
    await writeFile(filePath, body.content || "", "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentId, size: (body.content || "").length }));
    return true;
  }

  // ── DELETE /api/coding-memory/:agentId ──
  if (singleMatch && method === "DELETE") {
    const agentId = decodeURIComponent(singleMatch[1]);
    const filePath = join(memDir, `${agentId}.md`);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Memory file not found" }));
      return true;
    }
    await unlink(filePath);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted: agentId }));
    return true;
  }

  // ── POST /api/coding-memory/:agentId/append ──
  const appendMatch = url.match(/^\/api\/coding-memory\/([^/?]+)\/append$/);
  if (appendMatch && method === "POST") {
    const agentId = decodeURIComponent(appendMatch[1]);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return true;
    }
    const filePath = join(memDir, `${agentId}.md`);
    let existing = "";
    if (existsSync(filePath)) {
      existing = await readFile(filePath, "utf-8");
    }
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    const newContent = existing + separator + (body.content || "");
    await writeFile(filePath, newContent, "utf-8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, agentId, size: newContent.length }));
    return true;
  }

  return false;
}

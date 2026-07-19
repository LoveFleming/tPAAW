/**
 * Coding Memory Route — Agent long-term memory CRUD for .paaw/agent-memory/
 *
 * Endpoints:
 *   GET    /api/coding-memory?path=...                    — List all agent memory files
 *   GET    /api/coding-memory/:agentId?path=...           — Read specific agent memory
 *   PUT    /api/coding-memory/:agentId?path=...           — Write/update agent memory
 *   DELETE /api/coding-memory/:agentId?path=...           — Delete agent memory
 *   POST   /api/coding-memory/:agentId/append?path=...    — Append to agent memory
 */

import { readFile, writeFile, readdir, unlink, mkdir, stat } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readBody } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Crew metadata cache ──
let _crewCache = null;
let _crewCacheTime = 0;

function loadCrewMetadata() {
  const CREWS_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "crews");
  const now = Date.now();
  if (_crewCache && now - _crewCacheTime < 10_000) return _crewCache;
  _crewCache = {};
  _crewCacheTime = now;
  try {
    const files = readdirSync(CREWS_DIR);
    for (const f of files) {
      if (f.startsWith("coding.") && f.endsWith(".json")) {
        try {
          const crew = JSON.parse(readSync(join(CREWS_DIR, f), "utf-8"));
          const agentId = crew.id?.replace(/^coding\./, "");
          if (agentId) {
            _crewCache[agentId] = {
              crewId: crew.id,
              title: crew.title || agentId,
              codename: crew.codename || "",
              imageUrl: crew.imageUrl || "",
              description: crew.description || "",
            };
          }
        } catch {}
      }
    }
  } catch {}
  return _crewCache;
}

import { readdirSync } from "fs";

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
  return join(projectPath, ".paaw", "agent-memory");
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
      const crews = loadCrewMetadata();
      const crewAgentIds = Object.keys(crews);
      const memDir_ = memDir;
      
      // Merge: all crew agents + any extra .md files in agent-memory/
      const existingFiles = existsSync(memDir_) ? (await readdir(memDir_)).filter(f => f.endsWith(".md")) : [];
      const existingAgentIds = new Set(existingFiles.map(f => f.replace(/\.md$/, "")));
      const allAgentIds = new Set([...crewAgentIds, ...existingAgentIds]);

      // Exclude EM 大總管 — it's a manager, not a coding agent with memory
      allAgentIds.delete("em");

      const memories = [];
      for (const agentId of allAgentIds) {
        const crew = crews[agentId] || null;
        const filePath = join(memDir_, `${agentId}.md`);
        const hasFile = existingAgentIds.has(agentId);
        let size = 0, preview = "", lines = 0, updatedAt = null;
        if (hasFile) {
          try {
            const content = await readFile(filePath, "utf-8");
            size = content.length;
            preview = content.slice(0, 300);
            lines = content.split("\n").length;
            try { updatedAt = (await stat(filePath)).mtime.toISOString(); } catch {}
          } catch {}
        }
        memories.push({
          agentId,
          crewId: crew?.crewId || null,
          title: crew?.title || agentId,
          codename: crew?.codename || "",
          imageUrl: crew?.imageUrl || "",
          description: crew?.description || "",
          hasMemory: hasFile,
          size,
          preview,
          lines,
          updatedAt,
        });
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

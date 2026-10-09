/**
 * Vibe Sessions + Chat + Git Reviews
 * Routes: /api/vibe-sessions, /api/vibe-chat, /api/vibe-git/reviews
 *
 * Combines the simple inline session/chat handlers with the more detailed
 * vibeSessionsApiHandler (logs-based) from the original monolith.
 */

import { readdir, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import {
  DATA_ROOT, PAAW_ROOT, VIBE_SESSIONS_DIR,
  readBody,
} from "./shared.mjs";

// ── AI Settings paths ──
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { stableStringify } from "../lib/stable-stringify.mjs";

async function readBodyStr(req) {
  return new Promise((ok) => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => ok(d));
    req.on("error", () => ok(""));
  });
}

export default async function vibeSessionsRoute(req, res) {
  // ══════════════════════════════════════════════════
  // Simple vibe-sessions (data/vibe-sessions.json)
  // ══════════════════════════════════════════════════

  // GET /api/vibe-sessions — logs-based listing (from vibeSessionsApiHandler)
  if (req.method === "GET" && req.url?.match(/^\/api\/vibe-sessions(?:\?.*)?$/)) {
    try {
      mkdirSync(VIBE_SESSIONS_DIR, { recursive: true });
      const files = readdirSync(VIBE_SESSIONS_DIR).filter(f => f.endsWith(".json"));
      const sessions = [];
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(resolve(VIBE_SESSIONS_DIR, f), "utf8"));
          const logFile = resolve(VIBE_SESSIONS_DIR, f.replace(".json", ".log"));
          let logSize = 0;
          try { logSize = statSync(logFile).size; } catch {}
          sessions.push({ ...meta, logSize });
        } catch {}
      }
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/vibe-sessions (create or replace all — simple version)
  if (req.method === "POST" && req.url === "/api/vibe-sessions") {
    let body;
    try { body = JSON.parse(await readBodyStr(req)); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
    writeFileSync(sessFile, JSON.stringify(body.sessions || body, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // DELETE /api/vibe-sessions?id=... OR /api/vibe-sessions/:id (logs-based)
  if (req.method === "DELETE" && req.url?.startsWith("/api/vibe-sessions")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const id = params.get("id");

    if (id) {
      // Simple delete from vibe-sessions.json
      const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
      try {
        let sessions = JSON.parse(readFileSync(sessFile, "utf-8"));
        sessions = sessions.filter(s => s.id !== id);
        writeFileSync(sessFile, JSON.stringify(sessions, null, 2));
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // Logs-based delete: /api/vibe-sessions/:id
    const delMatch = req.url?.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
    if (delMatch) {
      try {
        const sid = sanitizeId(delMatch[1]);
        const metaPath = resolve(VIBE_SESSIONS_DIR, `${sid}.json`);
        const logPath = resolve(VIBE_SESSIONS_DIR, `${sid}.log`);
        try { unlinkSync(metaPath); } catch {}
        try { unlinkSync(logPath); } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        if (err?.code === "PATH_TRAVERSAL") { sendPathTraversalError(res, err); return true; }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }

    // Delete all
    const sessFile = resolve(DATA_ROOT, "vibe-sessions.json");
    try { writeFileSync(sessFile, "[]"); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // GET /api/vibe-sessions/:id/log — raw log
  {
    const logMatch = req.url?.match(/^\/api\/vibe-sessions\/([\w.-]+)\/log(?:\?.*)?$/);
    if (req.method === "GET" && logMatch) {
      try {
        const id = sanitizeId(logMatch[1]);
        const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
        if (!existsSync(logPath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Log not found" }));
          return true;
        }
        const content = readFileSync(logPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(content);
      } catch (err) {
        if (err?.code === "PATH_TRAVERSAL") { sendPathTraversalError(res, err); return true; }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // GET /api/vibe-sessions/:id — metadata
  {
    const oneMatch = req.url?.match(/^\/api\/vibe-sessions\/([\w.-]+)(?:\?.*)?$/);
    if (req.method === "GET" && oneMatch) {
      try {
        const id = sanitizeId(oneMatch[1]);
        const metaPath = resolve(VIBE_SESSIONS_DIR, `${id}.json`);
        if (!existsSync(metaPath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return true;
        }
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        const logPath = resolve(VIBE_SESSIONS_DIR, `${id}.log`);
        try { meta.logSize = statSync(logPath).size; } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(meta));
      } catch (err) {
        if (err?.code === "PATH_TRAVERSAL") { sendPathTraversalError(res, err); return true; }
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return true;
    }
  }

  // 2026-10-09 Fleming：AI 蒸餾功能移除（POST /:id/distill 已刪）

  // ══════════════════════════════════════════════════
  // Vibe Chat History (data/vibe-chat/)
  // ══════════════════════════════════════════════════

  // GET /api/vibe-chat?sessionId=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    let sessionId;
    try { sessionId = sanitizeId(params.get("sessionId") || "default"); } catch (err) { sendPathTraversalError(res, err); return true; }
    const chatFile = resolve(DATA_ROOT, "vibe-chat", `${sessionId}.json`);
    try {
      const data = JSON.parse(readFileSync(chatFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [] }));
    }
    return true;
  }

  // POST /api/vibe-chat
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    let sessionId;
    try { sessionId = sanitizeId(params.get("sessionId") || "default"); } catch (err) { sendPathTraversalError(res, err); return true; }
    let body;
    try { body = JSON.parse(await readBodyStr(req)); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const chatDir = resolve(DATA_ROOT, "vibe-chat");
    const chatFile = resolve(chatDir, `${sessionId}.json`);
    mkdirSync(chatDir, { recursive: true });
    if (body.messages) {
      writeFileSync(chatFile, JSON.stringify(body.messages, null, 2));
    } else if (body.message) {
      let msgs = [];
      try { msgs = JSON.parse(readFileSync(chatFile, "utf-8")); } catch {}
      msgs.push(body.message);
      writeFileSync(chatFile, JSON.stringify(msgs, null, 2));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // DELETE /api/vibe-chat?sessionId=...
  if (req.method === "DELETE" && req.url?.startsWith("/api/vibe-chat")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    let sessionId;
    try { sessionId = sanitizeId(params.get("sessionId") || "default"); } catch (err) { sendPathTraversalError(res, err); return true; }
    const chatFile = resolve(DATA_ROOT, "vibe-chat", `${sessionId}.json`);
    try { unlinkSync(chatFile); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ══════════════════════════════════════════════════
  // Git AI Review History
  // ══════════════════════════════════════════════════

  // GET /api/vibe-git/reviews?path=...
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/reviews")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectPath = params.get("path") || "default";
    const safeName = projectPath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const reviewFile = resolve(DATA_ROOT, "git-reviews", `${safeName}.json`);
    try {
      const data = JSON.parse(readFileSync(reviewFile, "utf-8"));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reviews: data }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reviews: [] }));
    }
    return true;
  }

  // POST /api/vibe-git/reviews?path=...
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/reviews")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const projectPath = params.get("path") || "default";
    const safeName = projectPath.replace(/[^a-zA-Z0-9._-]/g, "_");
    const reviewDir = resolve(DATA_ROOT, "git-reviews");
    const reviewFile = resolve(reviewDir, `${safeName}.json`);
    mkdirSync(reviewDir, { recursive: true });
    let body;
    try { body = JSON.parse(await readBodyStr(req)); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    let reviews = [];
    try { reviews = JSON.parse(readFileSync(reviewFile, "utf-8")); } catch {}
    reviews.unshift({ ...body, id: `review-${Date.now()}`, ts: new Date().toISOString() });
    if (reviews.length > 50) reviews = reviews.slice(0, 50);
    writeFileSync(reviewFile, JSON.stringify(reviews, null, 2));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stableStringify({ ok: true, review: reviews[0] }));
    return true;
  }

  return false;
}

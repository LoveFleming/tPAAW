/**
 * PAAW Notes API — 筆記系統
 *
 * 整合 OneNote（Notebook→Section→Page）、Notion（block-based）、
 * Obsidian（搜尋+標籤）、Apple Notes（快速+簡潔）的優點。
 *
 * Notebook → Notes → Tags + Full-text Search
 *
 * REST API:
 *   GET    /api/notes/notebooks              — 列出所有筆記本
 *   POST   /api/notes/notebooks              — 建立筆記本
 *   PUT    /api/notes/notebooks?id=          — 改名/顏色
 *   DELETE /api/notes/notebooks?id=          — 刪除筆記本（含筆記）
 *
 *   GET    /api/notes/list?notebook=         — 列出筆記本內的筆記
 *   GET    /api/notes/get?id=                — 取得單一筆記（含內容）
 *   POST   /api/notes/create                 — 建立筆記
 *   PUT    /api/notes/update?id=             — 更新筆記內容/標題/標籤
 *   DELETE /api/notes/delete?id=             — 刪除筆記
 *
 *   GET    /api/notes/search?q=              — 全文搜尋所有筆記
 *   GET    /api/notes/tags                   — 列出所有標籤
 *   GET    /api/notes/by-tag?tag=            — 按標籤找筆記
 *
 *   POST   /api/notes/upload-image           — 上傳圖片（base64 → file）
 *   GET    /api/notes/images/:filename       — 取得圖片
 *
 *   PUT    /api/notes/pin?id=                — 釘選/取消釘選
 *   GET    /api/notes/recent?limit=          — 最近編輯的筆記
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import { resolve, join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readBody } from "./shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const NOTES_DIR = resolve(PAAW_ROOT, "data/notes");
const NOTEBOOKS_FILE = resolve(NOTES_DIR, "notebooks.json");
const IMAGES_DIR = resolve(NOTES_DIR, "images");

// ── Storage helpers ──

async function ensureDirs() {
  await mkdir(NOTES_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });
}

async function loadNotebooks() {
  await ensureDirs();
  try {
    return JSON.parse(await readFile(NOTEBOOKS_FILE, "utf-8"));
  } catch {
    // 預設建立一個「我的筆記本」
    const defaultNotebooks = [{
      id: "default",
      name: "我的筆記本",
      color: "#F59E0B",
      icon: "📒",
      createdAt: new Date().toISOString(),
    }];
    await saveNotebooks(defaultNotebooks);
    return defaultNotebooks;
  }
}

async function saveNotebooks(notebooks) {
  await ensureDirs();
  await writeFile(NOTEBOOKS_FILE, JSON.stringify(notebooks, null, 2), "utf-8");
}

function notebookDir(notebookId) {
  return resolve(NOTES_DIR, notebookId);
}

function notePath(notebookId, noteId) {
  return resolve(notebookDir(notebookId), `${noteId}.json`);
}

async function loadNote(notebookId, noteId) {
  try {
    return JSON.parse(await readFile(notePath(notebookId, noteId), "utf-8"));
  } catch {
    return null;
  }
}

async function saveNote(note) {
  const dir = notebookDir(note.notebookId);
  await mkdir(dir, { recursive: true });
  await writeFile(notePath(note.notebookId, note.id), JSON.stringify(note, null, 2), "utf-8");
}

async function deleteNoteFile(notebookId, noteId) {
  try { await rm(notePath(notebookId, noteId)); } catch {}
}

async function listNotesInNotebook(notebookId) {
  const dir = notebookDir(notebookId);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const notes = [];
  for (const f of files.filter(f => f.endsWith(".json"))) {
    try {
      const note = JSON.parse(await readFile(join(dir, f), "utf-8"));
      notes.push({
        id: note.id,
        notebookId: note.notebookId,
        title: note.title || "未命名",
        tags: note.tags || [],
        pinned: note.pinned || false,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        excerpt: (note.content || "").replace(/<[^>]+>/g, "").slice(0, 120),
        coverImage: note.coverImage || null,
      });
    } catch {}
  }
  notes.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });
  return notes;
}

// ── 全文搜尋 ──

async function searchAllNotes(query) {
  const notebooks = await loadNotebooks();
  const q = query.toLowerCase();
  const results = [];
  for (const nb of notebooks) {
    const dir = notebookDir(nb.id);
    if (!existsSync(dir)) continue;
    const files = await readdir(dir);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const note = JSON.parse(await readFile(join(dir, f), "utf-8"));
        const title = (note.title || "").toLowerCase();
        const content = (note.content || "").replace(/<[^>]+>/g, "").toLowerCase();
        const tags = (note.tags || []).join(" ").toLowerCase();
        if (title.includes(q) || content.includes(q) || tags.includes(q)) {
          results.push({
            id: note.id,
            notebookId: note.notebookId,
            notebookName: nb.name,
            title: note.title || "未命名",
            tags: note.tags || [],
            excerpt: content.slice(
              Math.max(0, content.indexOf(q) - 30),
              content.indexOf(q) + q.length + 90
            ),
            updatedAt: note.updatedAt,
          });
        }
      } catch {}
    }
  }
  results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return results;
}

// ── ID generator ──

function genId(prefix = "n") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Route Handler ──

async function handleNotesRoutes(req, res) {
  const url = req.url || "";
  const method = req.method;

  // OPTIONS
  if (method === "OPTIONS") return false;

  // ── Notebooks ──

  // GET /api/notes/notebooks
  if (method === "GET" && url.startsWith("/api/notes/notebooks")) {
    const notebooks = await loadNotebooks();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notebooks }));
    return true;
  }

  // POST /api/notes/notebooks
  if (method === "POST" && url.startsWith("/api/notes/notebooks")) {
    const body = JSON.parse(await readBody(req));
    const notebooks = await loadNotebooks();
    const nb = {
      id: genId("nb"),
      name: body.name || "新筆記本",
      color: body.color || "#3B82F6",
      icon: body.icon || "📓",
      createdAt: new Date().toISOString(),
    };
    notebooks.push(nb);
    await saveNotebooks(notebooks);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, notebook: nb }));
    return true;
  }

  // PUT /api/notes/notebooks?id=
  if (method === "PUT" && url.startsWith("/api/notes/notebooks")) {
    const id = new URL(url, "http://localhost").searchParams.get("id");
    const body = JSON.parse(await readBody(req));
    const notebooks = await loadNotebooks();
    const nb = notebooks.find(n => n.id === id);
    if (!nb) { res.writeHead(404); res.end(JSON.stringify({ error: "Notebook not found" })); return true; }
    if (body.name) nb.name = body.name;
    if (body.color) nb.color = body.color;
    if (body.icon) nb.icon = body.icon;
    await saveNotebooks(notebooks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, notebook: nb }));
    return true;
  }

  // DELETE /api/notes/notebooks?id=
  if (method === "DELETE" && url.startsWith("/api/notes/notebooks")) {
    const id = new URL(url, "http://localhost").searchParams.get("id");
    const notebooks = await loadNotebooks();
    const idx = notebooks.findIndex(n => n.id === id);
    if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: "Notebook not found" })); return true; }
    notebooks.splice(idx, 1);
    await saveNotebooks(notebooks);
    try { await rm(notebookDir(id), { recursive: true }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Notes ──

  // GET /api/notes/list?notebook=
  if (method === "GET" && url.startsWith("/api/notes/list")) {
    const notebookId = new URL(url, "http://localhost").searchParams.get("notebook") || "default";
    const notes = await listNotesInNotebook(notebookId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notes }));
    return true;
  }

  // GET /api/notes/get?id=
  if (method === "GET" && url.startsWith("/api/notes/get")) {
    const params = new URL(url, "http://localhost").searchParams;
    const id = params.get("id");
    const notebookId = params.get("notebook") || "default";
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Note not found" })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ note }));
    return true;
  }

  // POST /api/notes/create
  if (method === "POST" && url.startsWith("/api/notes/create")) {
    const body = JSON.parse(await readBody(req));
    const now = new Date().toISOString();
    const note = {
      id: genId("note"),
      notebookId: body.notebookId || "default",
      title: body.title || "未命名筆記",
      content: body.content || "",
      tags: body.tags || [],
      pinned: false,
      coverImage: null,
      createdAt: now,
      updatedAt: now,
    };
    await saveNote(note);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, note }));
    return true;
  }

  // PUT /api/notes/update?id=
  if (method === "PUT" && url.startsWith("/api/notes/update")) {
    const params = new URL(url, "http://localhost").searchParams;
    const id = params.get("id");
    const notebookId = params.get("notebook") || "default";
    const body = JSON.parse(await readBody(req));
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Note not found" })); return true; }
    if (body.title !== undefined) note.title = body.title;
    if (body.content !== undefined) note.content = body.content;
    if (body.tags !== undefined) note.tags = body.tags;
    if (body.coverImage !== undefined) note.coverImage = body.coverImage;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, note }));
    return true;
  }

  // DELETE /api/notes/delete?id=
  if (method === "DELETE" && url.startsWith("/api/notes/delete")) {
    const params = new URL(url, "http://localhost").searchParams;
    const id = params.get("id");
    const notebookId = params.get("notebook") || "default";
    await deleteNoteFile(notebookId, id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Search & Tags ──

  // GET /api/notes/search?q=
  if (method === "GET" && url.startsWith("/api/notes/search")) {
    const q = new URL(url, "http://localhost").searchParams.get("q") || "";
    if (!q.trim()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [] }));
      return true;
    }
    const results = await searchAllNotes(q);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results }));
    return true;
  }

  // GET /api/notes/tags
  if (method === "GET" && url.startsWith("/api/notes/tags")) {
    const notebooks = await loadNotebooks();
    const tagSet = new Map();
    for (const nb of notebooks) {
      const dir = notebookDir(nb.id);
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const note = JSON.parse(await readFile(join(dir, f), "utf-8"));
          for (const tag of (note.tags || [])) {
            tagSet.set(tag, (tagSet.get(tag) || 0) + 1);
          }
        } catch {}
      }
    }
    const tags = [...tagSet.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ tags }));
    return true;
  }

  // GET /api/notes/by-tag?tag=
  if (method === "GET" && url.startsWith("/api/notes/by-tag")) {
    const tag = new URL(url, "http://localhost").searchParams.get("tag") || "";
    const notebooks = await loadNotebooks();
    const results = [];
    for (const nb of notebooks) {
      const dir = notebookDir(nb.id);
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const note = JSON.parse(await readFile(join(dir, f), "utf-8"));
          if ((note.tags || []).includes(tag)) {
            results.push({
              id: note.id,
              notebookId: note.notebookId,
              notebookName: nb.name,
              title: note.title || "未命名",
              tags: note.tags || [],
              excerpt: (note.content || "").replace(/<[^>]+>/g, "").slice(0, 120),
              updatedAt: note.updatedAt,
            });
          }
        } catch {}
      }
    }
    results.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results }));
    return true;
  }

  // ── Pin ──

  // PUT /api/notes/pin?id=
  if (method === "PUT" && url.startsWith("/api/notes/pin")) {
    const params = new URL(url, "http://localhost").searchParams;
    const id = params.get("id");
    const notebookId = params.get("notebook") || "default";
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Note not found" })); return true; }
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pinned: note.pinned }));
    return true;
  }

  // ── Recent ──

  // GET /api/notes/recent?limit=
  if (method === "GET" && url.startsWith("/api/notes/recent")) {
    const limit = parseInt(new URL(url, "http://localhost").searchParams.get("limit") || "10");
    const notebooks = await loadNotebooks();
    const all = [];
    for (const nb of notebooks) {
      const notes = await listNotesInNotebook(nb.id);
      for (const n of notes) {
        n.notebookName = nb.name;
        all.push(n);
      }
    }
    all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notes: all.slice(0, limit) }));
    return true;
  }

  // ── Image Upload ──

  // POST /api/notes/upload-image
  if (method === "POST" && url.startsWith("/api/notes/upload-image")) {
    const body = JSON.parse(await readBody(req));
    const { data, filename } = body;

    if (!data) { res.writeHead(400); res.end(JSON.stringify({ error: "No image data" })); return true; }

    // data 是 base64，可能帶 data URL prefix
    const base64 = data.replace(/^data:[^;]+;base64,/, "");
    const ext = filename ? extname(filename).toLowerCase() : ".png";
    const imgId = genId("img");
    const imgFilename = `${imgId}${ext || ".png"}`;
    const imgPath = resolve(IMAGES_DIR, imgFilename);

    await mkdir(IMAGES_DIR, { recursive: true });
    await writeFile(imgPath, Buffer.from(base64, "base64"));

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: `/api/notes/images/${imgFilename}`, filename: imgFilename }));
    return true;
  }

  // GET /api/notes/images/:filename
  if (method === "GET" && url.startsWith("/api/notes/images/")) {
    const filename = url.replace("/api/notes/images/", "").split("?")[0];
    const imgPath = resolve(IMAGES_DIR, filename);
    if (!existsSync(imgPath)) { res.writeHead(404); res.end("Not found"); return true; }
    const ext = extname(filename).toLowerCase();
    const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
    res.writeHead(200, {
      "Content-Type": mimeMap[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    });
    createReadStream(imgPath).pipe(res);
    return true;
  }

  return false;
}

export default handleNotesRoutes;

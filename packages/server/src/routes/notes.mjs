/**
 * PAAW Notes API — 筆記系統（OneNote 式三層架構）
 *
 * Project (Notebook) → Section → Notes
 *
 * REST API:
 *   GET    /api/notes/notebooks              — 列出所有 Project
 *   POST   /api/notes/notebooks              — 建立 Project
 *   PUT    /api/notes/notebooks?id=          — 改名/顏色/icon
 *   DELETE /api/notes/notebooks?id=          — 刪除 Project
 *
 *   GET    /api/notes/sections?notebook=     — 列出 Section
 *   POST   /api/notes/sections               — 建立 Section
 *   PUT    /api/notes/sections?id=           — 改 Section 名稱
 *   DELETE /api/notes/sections?id=&notebook= — 刪除 Section
 *
 *   GET    /api/notes/list?notebook=&section= — 列出筆記（可選 section 篩選）
 *   GET    /api/notes/get?id=                — 取得單一筆記
 *   POST   /api/notes/create                 — 建立筆記
 *   PUT    /api/notes/update?id=             — 更新筆記
 *   DELETE /api/notes/delete?id=             — 刪除筆記
 *   PUT    /api/notes/move?id=               — 搬移筆記到另一 section/notebook
 *
 *   GET    /api/notes/search?q=              — 全文搜尋
 *   GET    /api/notes/tags                   — 列出所有標籤
 *   GET    /api/notes/by-tag?tag=            — 按標籤找
 *   PUT    /api/notes/pin?id=                — 釘選
 *   GET    /api/notes/recent?limit=          — 最近編輯
 *
 *   POST   /api/notes/upload-image           — 上傳圖片
 *   GET    /api/notes/images/:filename       — 取得圖片
 */

import { readFile, writeFile, readdir, mkdir, rm } from "fs/promises";
import { existsSync, createReadStream, readFileSync } from "fs";
import { resolve, join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readBody } from "./shared.mjs";
import { callLLMWithRetry, sanitizeContent, isMeaningfulContent } from "../lib/llm-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "../../../../");
const NOTES_DIR = resolve(PAAW_ROOT, "data/notes");
const NOTEBOOKS_FILE = resolve(NOTES_DIR, "notebooks.json");
const SECTIONS_FILE = resolve(NOTES_DIR, "sections.json");
const IMAGES_DIR = resolve(NOTES_DIR, "images");
const SYSTEM_PROMPT_PATH = resolve(PAAW_ROOT, "data/ai-settings/notes/system-prompt.md");

// ── AI 筆記助手 ──

function getSystemPrompt() {
  try {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    return "你是專業的筆記整理助手。將使用者提供的內容整理成結構化筆記。使用 HTML 格式輸出。";
  }
}

function loadProviderConfig() {
  const configPath = resolve(PAAW_ROOT, "data/config/providers.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch { return null; }
}

function resolveLLM(modelOverride) {
  const config = loadProviderConfig();
  if (!config) throw new Error("No provider config found");
  let providerId = config.active;
  let modelId = modelOverride || config.defaultModel || "glm-5.1";
  if (modelOverride && modelOverride.includes("/")) {
    const idx = modelOverride.indexOf("/");
    providerId = modelOverride.slice(0, idx);
    modelId = modelOverride.slice(idx + 1);
  } else if (!modelOverride && modelId.includes("/")) {
    modelId = modelId.split("/").pop();
  }
  const provider = config.providers?.[providerId];
  if (!provider) throw new Error(`Provider '${providerId}' not found`);
  const model = modelId;
  const baseURL = provider.baseURL.replace(/\/+$/, "");
  const apiUrl = `${baseURL}/chat/completions`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` };
  if (providerId === "openrouter") { headers["HTTP-Referer"] = "https://paaw.ai"; headers["X-Title"] = "PAAW"; }
  return { apiUrl, headers, model };
}

async function aiWriteNote(userPrompt, content, modelOverride) {
  const llm = resolveLLM(modelOverride);
  const fullPrompt = userPrompt
    ? `${userPrompt}\n\n---\n以下是要整理的內容：\n\n${content}`
    : `請幫我整理以下內容成結構化筆記：\n\n${content}`;

  // Build full system context (includes notes/ rules via readCategoryFiles)
  let systemPrompt = getSystemPrompt();
  try {
    const { contextEngine } = await import("../context-engine.mjs");
    const ctx = await contextEngine.build({ target: "notes" });
    systemPrompt = ctx.systemPrompt || systemPrompt;
  } catch {}

  const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
    model: llm.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fullPrompt },
    ],
    max_tokens: 4096,
  }, {
    maxRetries: 3,
    timeoutMs: 90_000,
    validateContent: true,
    sanitize: true,
  });

  let html = sanitizeContent(result.content);
  if (!isMeaningfulContent(html)) throw new Error("AI 回應內容為空");

  // 解析標題和標籤
  let title = "AI 筆記";
  let tags = [];
  const titleMatch = html.match(/標題[：:]\s*(.+?)(?:<\/\w+>)?$/m);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    html = html.replace(/標題[：:]\s*.+/m, "");
  }
  const tagMatch = html.match(/標籤[：:]\s*(.+?)(?:<\/\w+>)?$/m);
  if (tagMatch) {
    tags = tagMatch[1].replace(/<[^>]+>/g, "").split(/[,，、]/).map(t => t.trim()).filter(Boolean);
    html = html.replace(/標籤[：:]\s*.+/m, "");
  }

  // 如果 AI 回的是 markdown 而非 HTML，做基本轉換
  if (!html.includes("<") && (html.includes("## ") || html.includes("- ") || html.includes("**"))) {
    html = html
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h2>$1</h2>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/^(?!<[hulo])/gm, "<p>");
  }

  return { title, content: html, tags };
}

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
    const defaultNotebooks = [
      { id: "default", name: "我的筆記", color: "#F59E0B", icon: "📒", createdAt: new Date().toISOString() },
    ];
    await saveNotebooks(defaultNotebooks);
    return defaultNotebooks;
  }
}

async function saveNotebooks(notebooks) {
  await ensureDirs();
  await writeFile(NOTEBOOKS_FILE, JSON.stringify(notebooks, null, 2), "utf-8");
}

// ── Sections ──

async function loadSections() {
  await ensureDirs();
  try {
    return JSON.parse(await readFile(SECTIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveSections(sections) {
  await ensureDirs();
  await writeFile(SECTIONS_FILE, JSON.stringify(sections, null, 2), "utf-8");
}

// ── Note file storage ──

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

async function listNotesInNotebook(notebookId, sectionId) {
  const dir = notebookDir(notebookId);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const notes = [];
  for (const f of files.filter(f => f.endsWith(".json"))) {
    try {
      const note = JSON.parse(await readFile(join(dir, f), "utf-8"));
      if (sectionId && (note.sectionId || "default") !== sectionId) continue;
      notes.push({
        id: note.id,
        notebookId: note.notebookId,
        sectionId: note.sectionId || "default",
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
  const sections = await loadSections();
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
          const sec = sections.find(s => s.id === (note.sectionId || "default"));
          results.push({
            id: note.id,
            notebookId: note.notebookId,
            notebookName: nb.name,
            sectionName: sec ? sec.name : "未分類",
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

function genId(prefix = "n") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ════════════════════════════════════════
// Route Handler
// ════════════════════════════════════════

async function handleNotesRoutes(req, res) {
  const url = req.url || "";
  const method = req.method;
  const parsedUrl = new URL(url, "http://localhost");
  const path = parsedUrl.pathname;

  if (method === "OPTIONS") return false;

  // ── Notebooks (Projects) ──

  if (path === "/api/notes/notebooks" && method === "GET") {
    const notebooks = await loadNotebooks();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notebooks }));
    return true;
  }

  if (path === "/api/notes/notebooks" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const notebooks = await loadNotebooks();
    const nb = {
      id: genId("nb"),
      name: body.name || "新 Project",
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

  if (path === "/api/notes/notebooks" && method === "PUT") {
    const id = parsedUrl.searchParams.get("id");
    const body = JSON.parse(await readBody(req));
    const notebooks = await loadNotebooks();
    const nb = notebooks.find(n => n.id === id);
    if (!nb) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    if (body.name) nb.name = body.name;
    if (body.color) nb.color = body.color;
    if (body.icon) nb.icon = body.icon;
    await saveNotebooks(notebooks);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, notebook: nb }));
    return true;
  }

  if (path === "/api/notes/notebooks" && method === "DELETE") {
    const id = parsedUrl.searchParams.get("id");
    const notebooks = await loadNotebooks();
    const idx = notebooks.findIndex(n => n.id === id);
    if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    notebooks.splice(idx, 1);
    await saveNotebooks(notebooks);
    try { await rm(notebookDir(id), { recursive: true }); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Sections ──

  if (path === "/api/notes/sections" && method === "GET") {
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const all = await loadSections();
    const secs = all.filter(s => s.notebookId === notebookId);
    // 確保有「未分類」
    if (!secs.find(s => s.id === "default")) {
      secs.unshift({ id: "default", notebookId, name: "未分類", icon: "📂", createdAt: new Date().toISOString() });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sections: secs }));
    return true;
  }

  if (path === "/api/notes/sections" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const all = await loadSections();
    const sec = {
      id: genId("sec"),
      notebookId: body.notebookId || "default",
      name: body.name || "新分類",
      icon: body.icon || "📁",
      createdAt: new Date().toISOString(),
    };
    all.push(sec);
    await saveSections(all);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, section: sec }));
    return true;
  }

  if (path === "/api/notes/sections" && method === "PUT") {
    const id = parsedUrl.searchParams.get("id");
    const body = JSON.parse(await readBody(req));
    const all = await loadSections();
    const sec = all.find(s => s.id === id);
    if (!sec) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    if (body.name) sec.name = body.name;
    if (body.icon) sec.icon = body.icon;
    await saveSections(all);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, section: sec }));
    return true;
  }

  if (path === "/api/notes/sections" && method === "DELETE") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    if (id === "default") { res.writeHead(400); res.end(JSON.stringify({ error: "Cannot delete default section" })); return true; }
    const all = await loadSections();
    const idx = all.findIndex(s => s.id === id && s.notebookId === notebookId);
    if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    all.splice(idx, 1);
    await saveSections(all);
    // 將 section 下的筆記歸到「未分類」
    const notes = await listNotesInNotebook(notebookId, id);
    for (const n of notes) {
      const full = await loadNote(notebookId, n.id);
      if (full) { full.sectionId = "default"; await saveNote(full); }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── Notes ──

  if (path === "/api/notes/list" && method === "GET") {
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const sectionId = parsedUrl.searchParams.get("section");
    const notes = await listNotesInNotebook(notebookId, sectionId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notes }));
    return true;
  }

  if (path === "/api/notes/get" && method === "GET") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ note }));
    return true;
  }

  if (path === "/api/notes/create" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const now = new Date().toISOString();
    const note = {
      id: genId("note"),
      notebookId: body.notebookId || "default",
      sectionId: body.sectionId || "default",
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

  if (path === "/api/notes/update" && method === "PUT") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const body = JSON.parse(await readBody(req));
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    if (body.title !== undefined) note.title = body.title;
    if (body.content !== undefined) note.content = body.content;
    if (body.tags !== undefined) note.tags = body.tags;
    if (body.sectionId !== undefined) note.sectionId = body.sectionId;
    if (body.coverImage !== undefined) note.coverImage = body.coverImage;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, note }));
    return true;
  }

  if (path === "/api/notes/delete" && method === "DELETE") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    await deleteNoteFile(notebookId, id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // Move note to another section/notebook
  if (path === "/api/notes/move" && method === "PUT") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const body = JSON.parse(await readBody(req));
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    const oldNb = note.notebookId;
    if (body.sectionId) note.sectionId = body.sectionId;
    if (body.notebookId) note.notebookId = body.notebookId;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
    if (body.notebookId && body.notebookId !== oldNb) {
      await deleteNoteFile(oldNb, id);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── AI Write ──

  if (path === "/api/notes/ai-write" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const { content, prompt, model } = body;
    if (!content || content.trim().length < 5) {
      res.writeHead(400); res.end(JSON.stringify({ error: "內容太短" })); return true;
    }
    try {
      const result = await aiWriteNote(prompt || "", content, model);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── Search & Tags ──

  if (path === "/api/notes/search" && method === "GET") {
    const q = parsedUrl.searchParams.get("q") || "";
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

  if (path === "/api/notes/tags" && method === "GET") {
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

  if (path === "/api/notes/by-tag" && method === "GET") {
    const tag = parsedUrl.searchParams.get("tag") || "";
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
              id: note.id, notebookId: note.notebookId, notebookName: nb.name,
              title: note.title || "未命名", tags: note.tags || [],
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

  if (path === "/api/notes/pin" && method === "PUT") {
    const id = parsedUrl.searchParams.get("id");
    const notebookId = parsedUrl.searchParams.get("notebook") || "default";
    const note = await loadNote(notebookId, id);
    if (!note) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await saveNote(note);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, pinned: note.pinned }));
    return true;
  }

  // ── Recent ──

  if (path === "/api/notes/recent" && method === "GET") {
    const limit = parseInt(parsedUrl.searchParams.get("limit") || "10");
    const notebooks = await loadNotebooks();
    const all = [];
    for (const nb of notebooks) {
      const notes = await listNotesInNotebook(nb.id);
      for (const n of notes) { n.notebookName = nb.name; all.push(n); }
    }
    all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notes: all.slice(0, limit) }));
    return true;
  }

  // ── Image Upload ──

  if (path === "/api/notes/upload-image" && method === "POST") {
    const body = JSON.parse(await readBody(req));
    const { data, filename } = body;
    if (!data) { res.writeHead(400); res.end(JSON.stringify({ error: "No image data" })); return true; }
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

  if (path.startsWith("/api/notes/images/") && method === "GET") {
    const filename = path.replace("/api/notes/images/", "");
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

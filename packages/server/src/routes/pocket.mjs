/**
 * Pocket Notes API — compatibility layer for React app.html
 * Routes: /api/notes (GET/POST/PUT/DELETE)
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { readBody } from "./shared.mjs";
import { DATA_HOME } from "../data-home.mjs";
import { stableStringify } from "../lib/stable-stringify.mjs";

// Cap request body size — a single request must not be able to allocate
// unbounded memory (DoS guard). 1 MB is generous for pocket notes.
const MAX_BODY_BYTES = 1024 * 1024;

/** Read body with a hard size cap; rejects with code BODY_TOO_LARGE. */
function readBodyCapped(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
        err.code = "BODY_TOO_LARGE";
        req.destroy();
        reject(err);
        return;
      }
      body += chunk;
    });
    req.on("end", () => { if (!aborted) resolve(body); });
    req.on("error", reject);
  });
}

/** Send a JSON response. */
function sendJSON(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export default async function pocketRoute(req, res) {
  const url = req.url || "";

  if (url === "/api/notes" || url?.startsWith("/api/notes?")) {
    const dir = resolve(DATA_HOME, "app-data");
    const NOTES_FILE = join(dir, "pocket.json");

    async function loadArr() {
      try { return JSON.parse(await readFile(NOTES_FILE, "utf-8")); } catch { return []; }
    }
    async function saveArr(data) {
      await mkdir(dir, { recursive: true });
      await writeFile(NOTES_FILE, JSON.stringify(data, null, 2), "utf-8");
    }

    function normalizeNote(n) {
      return {
        ...n,
        content: n.content || n.text || n.title || "",
        status: n.status || (n.done ? "done" : "active"),
      };
    }

    if (req.method === "GET") {
      const arr = await loadArr();
      const notes = (Array.isArray(arr) ? arr : []).map(normalizeNote);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ notes }));
      return true;
    }

    let reqBody;
    try {
      reqBody = await readBodyCapped(req);
    } catch (err) {
      const code = err.code === "BODY_TOO_LARGE" ? 413 : 400;
      sendJSON(res, code, { error: err.message });
      return true;
    }

    if (req.method === "POST") {
      const note = JSON.parse(reqBody);
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        sendJSON(res, 400, { error: "Request body must be a JSON object" });
        return true;
      }
      const arr = await loadArr();
      if (!note.id) note.id = `pocket_${Date.now().toString(36)}`;
      if (!note.createdAt) note.createdAt = new Date().toISOString();
      arr.unshift(note);
      await saveArr(arr);
      sendJSON(res, 201, { ok: true, note });
      return true;
    }

    const id = new URL(req.url, "http://localhost").searchParams.get("id");

    if (req.method === "PUT") {
      if (!id) { sendJSON(res, 400, { error: "Missing id query parameter" }); return true; }
      const updated = JSON.parse(reqBody);
      if (!updated || typeof updated !== "object" || Array.isArray(updated)) {
        sendJSON(res, 400, { error: "Request body must be a JSON object" });
        return true;
      }
      const arr = await loadArr();
      const idx = arr.findIndex(n => n.id === id);
      if (idx === -1) { sendJSON(res, 404, { error: "Not found" }); return true; }
      arr[idx] = { ...arr[idx], ...updated, updatedAt: new Date().toISOString() };
      await saveArr(arr);
      sendJSON(res, 200, stableStringify({ ok: true, note: arr[idx] }));
      return true;
    }

    if (req.method === "DELETE") {
      if (!id) { sendJSON(res, 400, { error: "Missing id query parameter" }); return true; }
      let arr = await loadArr();
      arr = arr.filter(n => n.id !== id);
      await saveArr(arr);
      sendJSON(res, 200, { ok: true });
      return true;
    }

    sendJSON(res, 405, { error: "Method not allowed" });
    return true;
  }

  return false;
}

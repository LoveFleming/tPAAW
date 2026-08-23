/**
 * Pocket Notes API — compatibility layer for React app.html
 * Routes: /api/notes (GET/POST/PUT/DELETE)
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { readBody } from "./shared.mjs";
import { DATA_HOME } from "../data-home.mjs";

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

    const reqBody = await readBody(req);

    if (req.method === "POST") {
      const note = JSON.parse(reqBody);
      const arr = await loadArr();
      if (!note.id) note.id = `pocket_${Date.now().toString(36)}`;
      if (!note.createdAt) note.createdAt = new Date().toISOString();
      arr.unshift(note);
      await saveArr(arr);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, note }));
      return true;
    }

    const id = new URL(req.url, "http://localhost").searchParams.get("id");

    if (req.method === "PUT") {
      const updated = JSON.parse(reqBody);
      const arr = await loadArr();
      const idx = arr.findIndex(n => n.id === id);
      if (idx === -1) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return true; }
      arr[idx] = { ...arr[idx], ...updated, updatedAt: new Date().toISOString() };
      await saveArr(arr);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, note: arr[idx] }));
      return true;
    }

    if (req.method === "DELETE") {
      let arr = await loadArr();
      arr = arr.filter(n => n.id !== id);
      await saveArr(arr);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  return false;
}

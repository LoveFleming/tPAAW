/**
 * Uploads routes — 圖片上傳 + 靜態服務（2026-08-30 Vision Phase 2）
 *
 * POST /api/uploads        — JSON {dataUrl, filename?} → 存 data/uploads/chat/ → {ok, path, url}
 * GET  /api/uploads/*      — 靜態服務（img src 直接用）
 *
 * 設計：chat 訊息只存路徑引用，不存 base64（防 chats storage 膨脹）
 * 送 LLM 前才由 chat.mjs 讀檔轉 data URI
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { extname, join, resolve } from "path";
import { readBody, json, urlPath } from "./context.mjs";
import { DATA_HOME } from "../data-home.mjs";

const UPLOADS_DIR = resolve(DATA_HOME, "uploads");
await mkdir(UPLOADS_DIR, { recursive: true });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB 上限（client 已壓縮，超過就是異常）
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function _safeName(name) {
  const ext = extname(name || "").toLowerCase();
  return { ext: ALLOWED_EXT.has(ext) ? ext : ".jpg", ok: ALLOWED_EXT.has(ext) };
}

export default async function uploadRoutes(req, res) {
  const path = urlPath(req);

  // ── POST /api/uploads — 上傳（dataUrl base64）──
  if (req.method === "POST" && path === "/api/uploads") {
    try {
      const body = JSON.parse((await readBody(req)) || "{}");
      const dataUrl = String(body.dataUrl || "");
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
      if (!m) { json(res, { error: "Invalid image dataUrl (expect base64 image/*)" }, 400); return true; }

      const buf = Buffer.from(m[2], "base64");
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
        json(res, { error: `Image size out of range (${(buf.length / 1024 / 1024).toFixed(1)}MB, max 5MB)` }, 400);
        return true;
      }

      const extInfo = _safeName(body.filename);
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extInfo.ext}`;
      await writeFile(join(UPLOADS_DIR, name), buf);
      const rel = `uploads/${name}`;
      json(res, { ok: true, path: rel, url: `/api/${rel}` });
    } catch (err) {
      json(res, { error: err.message }, 500);
    }
    return true;
  }

  // ── GET /api/uploads/* — 靜態服務 ──
  if (req.method === "GET" && path.startsWith("/api/uploads/")) {
    const name = path.slice("/api/uploads/".length).replace(/\\/g, "/");
    // 防路徑穿越：檔名不得含 / ..
    if (!name || name.includes("/") || name.includes("..")) { res.writeHead(400); res.end("Bad request"); return true; }
    try {
      const buf = await readFile(join(UPLOADS_DIR, name));
      const ext = extname(name).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  return false;
}

/** 給其他 route 用的絕對路徑（chat.mjs 讀圖用） */
export function uploadsDir() { return UPLOADS_DIR; }

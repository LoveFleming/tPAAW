/**
 * Uploads routes — 圖片上傳 + 靜態服務（2026-08-30 Vision Phase 2）
 *
 * POST /api/uploads          — JSON {dataUrl, filename?, ruRoot?} → {ok, path, url}
 *   無 ruRoot → 中央 data/uploads/（主 chat 用，90 天 purge）
 *   有 ruRoot（須為註冊過的 release unit root）→ {ru}/.paaw/uploads/（2026-09-06
 *   Fleming 定調：coding app 對話圖是 RU 資產 — 跟著 RU 生命週期、進版控、永不 purge）
 * GET  /api/uploads/*        — 中央靜態服務
 * GET  /api/paaw-uploads/*   — RU 資產圖服務（搜尋所有註冊 RU 的 .paaw/uploads/<name>）
 *
 * 設計：chat 訊息只存路徑引用，不存 base64（防 chats storage 膨脹）
 * 送 LLM 前才由 chat.mjs 讀檔轉 data URI
 */
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { extname, join, resolve } from "path";
import { readBody, json, urlPath } from "./context.mjs";
import { DATA_HOME } from "../data-home.mjs";

/** 註冊過的 RU root 清單（防路徑穿越：只允許寫進已註冊 RU 的 .paaw/uploads/） */
async function _listRuRoots() {
  const { PAAW_ROOT } = await import("./shared.mjs");
  const roots = [resolve(PAAW_ROOT)];
  try {
    const reg = JSON.parse(await readFile(resolve(DATA_HOME, "config/release-units.json"), "utf-8"));
    for (const u of reg.units || []) {
      if (u.path && existsSync(u.path)) roots.push(resolve(u.path));
    }
  } catch { /* 註冊表不在就只有 PAAW_ROOT */ }
  return [...new Set(roots)];
}

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

      // ruRoot 有給且是註冊過的 RU → 圖進該 RU 的 .paaw/uploads/（資產，不 purge）
      let targetDir = UPLOADS_DIR;
      let rel;
      if (typeof body.ruRoot === "string" && body.ruRoot.length > 0) {
        const roots = await _listRuRoots();
        const matched = roots.find((r) => r === resolve(body.ruRoot));
        if (!matched) { json(res, { error: "ruRoot is not a registered release unit" }, 400); return true; }
        targetDir = join(matched, ".paaw", "uploads");
        await mkdir(targetDir, { recursive: true });
        rel = `paaw-uploads/${name}`;
      } else {
        rel = `uploads/${name}`;
      }
      await writeFile(join(targetDir, name), buf);
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

  // ── GET /api/paaw-uploads/* — RU 資產圖服務（跨 RU 搜尋，timestamp 檔名實務不撞）──
  if (req.method === "GET" && path.startsWith("/api/paaw-uploads/")) {
    const name = path.slice("/api/paaw-uploads/".length).replace(/\\/g, "/");
    if (!name || name.includes("/") || name.includes("..")) { res.writeHead(400); res.end("Bad request"); return true; }
    try {
      const abs = await resolveUploadRef(`paaw-uploads/${name}`);
      if (!abs) { res.writeHead(404); res.end("Not found"); return true; }
      const buf = await readFile(abs);
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

/** 路徑引用 → 絕對路徑（vision 管線共用）：
 *  uploads/<name>       → 中央 data/uploads/<name>（不檢查存在，沿用舊行為）
 *  paaw-uploads/<name>  → 搜尋所有註冊 RU 的 .paaw/uploads/<name>（找到的第一個）
 *  其他 → null（呼叫端自行丟棄） */
export async function resolveUploadRef(ref) {
  if (typeof ref !== "string") return null;
  if (/^uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) {
    return join(UPLOADS_DIR, ref.slice("uploads/".length));
  }
  if (/^paaw-uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) {
    const name = ref.slice("paaw-uploads/".length);
    for (const root of await _listRuRoots()) {
      const abs = join(root, ".paaw", "uploads", name);
      if (existsSync(abs)) return abs;
    }
    return null;
  }
  return null;
}

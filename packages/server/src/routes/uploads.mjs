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
import { randomUUID } from "crypto";

// Request body caps (DoS guard — 單一請求不可耗盡記憶體)
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024; // 12MB — base64 圖膨脹 4/3，對應 5MB 原始 + 餘裕
const MAX_TEXT_BODY_BYTES = 4 * 1024 * 1024;    // 4MB — 文字附件（上限 2MB 內容 + JSON 外殼）

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

// ── 文字檔上傳（2026-09-14 agent chat 檔案附件）──
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2MB 上限

/** 檔名消毒：去路徑、去控制碼、擋 ..、長度上限（保留中英文與常見符號） */
function _safeTextName(name) {
  const base = String(name || "file.txt").split(/[\\/]/).pop().trim() || "file.txt";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/^\.+/, "_");
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "..." : cleaned;
}

function _safeName(name) {
  const ext = extname(name || "").toLowerCase();
  return { ext: ALLOWED_EXT.has(ext) ? ext : ".jpg", ok: ALLOWED_EXT.has(ext) };
}

/**
 * 由檔案「magic bytes」判斷真實圖片型別（不信 client 的 filename/副檔名）。
 * 回傳 { ext, mime } 或 null（非已知圖片格式）。
 * 副檔名 + 靜態服務 Content-Type 都改用這裡的結果，杜絕「宣告 image/* 但內容是別的東西」的 stored XSS。
 */
export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: ".png", mime: "image/png" };
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  // GIF: "GIF87a" / "GIF89a"
  if (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a") return { ext: ".gif", mime: "image/gif" };
  // WEBP: "RIFF"...."WEBP"
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return { ext: ".webp", mime: "image/webp" };
  return null;
}

/** 解析 request body：空 body 視為 {}，壞 JSON → 400（不讓 SyntaxError 冒成 500） */
async function _readJsonBody(req, res, maxBytes) {
  const raw = await readBody(req, maxBytes).catch((err) => {
    if (err && err.code === "BODY_TOO_LARGE") {
      json(res, { error: "Request body too large" }, 413);
      return null;
    }
    throw err;
  });
  if (raw === null) return { ok: false };
  if (!raw) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    json(res, { error: "Invalid JSON body" }, 400);
    return { ok: false };
  }
}

export default async function uploadRoutes(req, res) {
  const path = urlPath(req);

  // ── POST /api/uploads — 上傳（dataUrl base64）──
  if (req.method === "POST" && path === "/api/uploads") {
    try {
      const parsed = await _readJsonBody(req, res, MAX_UPLOAD_BODY_BYTES);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const dataUrl = String(body.dataUrl || "");
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
      if (!m) { json(res, { error: "Invalid image dataUrl (expect base64 image/*)" }, 400); return true; }

      const buf = Buffer.from(m[2], "base64");
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
        json(res, { error: `Image size out of range (${(buf.length / 1024 / 1024).toFixed(1)}MB, max 5MB)` }, 400);
        return true;
      }

      // 不信 client 的 filename/副檔名 — 以 magic bytes 決定真實型別與存放副檔名
      const imgType = detectImageType(buf);
      if (!imgType) {
        json(res, { error: "File content is not a recognised image (png/jpeg/webp/gif)" }, 400);
        return true;
      }
      const name = `${Date.now()}-${randomUUID().slice(0, 8)}${imgType.ext}`;

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

  // ── POST /api/uploads/text — 文字檔上傳（agent chat 附件，2026-09-14）──
  // {content, filename, ruRoot?} → {ok, name, abs, rel?}
  //   有 ruRoot（註冊過的 RU）→ 存 {ru}/.paaw/uploads/（RU 資產，agent read_file 可讀，rel 相對 ruRoot）
  //   無 ruRoot → 中央 data/uploads/（絕對路徑回傳，read_file 靠 PAAW root 白名單可讀）
  if (req.method === "POST" && path === "/api/uploads/text") {
    try {
      const parsed = await _readJsonBody(req, res, MAX_TEXT_BODY_BYTES);
      if (!parsed.ok) return true;
      const body = parsed.body;
      const content = typeof body.content === "string" ? body.content : "";
      if (content.length === 0) { json(res, { error: "Empty content" }, 400); return true; }
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_TEXT_BYTES) {
        json(res, { error: `File too large (${(bytes / 1024).toFixed(0)}KB, max ${MAX_TEXT_BYTES / 1024}KB)` }, 400);
        return true;
      }
      // 二進位防護：前 8k 字元含 NUL → 幾乎確定不是文字檔
      if (content.slice(0, 8000).includes("\u0000")) {
        json(res, { error: "Content looks binary — text files only" }, 400);
        return true;
      }

      const safe = _safeTextName(body.filename);
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

      // ruRoot 有給且是註冊過的 RU → 存 RU 資產目錄（跟對話圖同一套定調：檔案是 RU 資產）
      if (typeof body.ruRoot === "string" && body.ruRoot.length > 0) {
        const roots = await _listRuRoots();
        const matched = roots.find((r) => r === resolve(body.ruRoot));
        if (!matched) { json(res, { error: "ruRoot is not a registered release unit" }, 400); return true; }
        const targetDir = join(matched, ".paaw", "uploads");
        await mkdir(targetDir, { recursive: true });
        const abs = join(targetDir, name);
        await writeFile(abs, content, "utf8");
        json(res, { ok: true, name: safe, abs, rel: `.paaw/uploads/${name}` });
      } else {
        const abs = join(UPLOADS_DIR, name);
        await writeFile(abs, content, "utf8");
        json(res, { ok: true, name: safe, abs });
      }
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
      // Content-Type 由 magic bytes 決定（不信可被 client 影響的副檔名）→ 防 stored XSS
      const type = detectImageType(buf);
      if (!type) { res.writeHead(415); res.end("Unsupported media type"); return true; }
      res.writeHead(200, { "Content-Type": type.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
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
      // Content-Type 由 magic bytes 決定（不信可被 client 影響的副檔名）→ 防 stored XSS
      const type = detectImageType(buf);
      if (!type) { res.writeHead(415); res.end("Unsupported media type"); return true; }
      res.writeHead(200, { "Content-Type": type.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
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

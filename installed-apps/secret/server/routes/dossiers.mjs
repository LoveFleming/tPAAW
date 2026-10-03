/**
 * dossiers — 分類檔案櫃 CRUD + 上傳
 *   GET    /api/secret/dossiers                          → 全分類檔案樹
 *   GET    /api/secret/dossiers/<cat>/<file>             → md 原文 / sheet 預覽
 *   PUT    /api/secret/dossiers/<cat>/<file> {content}   → 存 md
 *   POST   /api/secret/dossiers/<cat> {filename, dataBase64} → 上傳（xlsx/csv/md）
 *   DELETE /api/secret/dossiers/<cat>/<file>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { readBody, PAAW_ROOT } from "./shared.mjs";

/** readBody 回 raw string — 這裡 parse + 空 body 容錯（同 learning module 慣例） */
async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const DOSSIER_DIR = (cat) => join(PAAW_ROOT, "dossiers", cat);
/** 檔名白名名單：中英文/數字/底線/連字/點，禁路徑分隔與 .. */
const SAFE_NAME = /^[^\\/:*?"<>|]+$/;
function safeName(n) {
  if (!n || n.includes("..") || !SAFE_NAME.test(n) || n.length > 120) throw new Error(`非法檔名：${n}`);
  return basename(n);
}
function safeCat(cat, registry) {
  const c = registry.find(x => x.id === cat);
  if (!c) throw new Error(`分類不存在：${cat}`);
  return c;
}
function loadRegistry() {
  try { return JSON.parse(readFileSync(join(PAAW_ROOT, "categories.json"), "utf-8")); } catch { return []; }
}

const SHEET_RE = /\.(xlsx|csv)$/i;

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (!p.startsWith("/api/secret/dossiers")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  const rest = p.slice("/api/secret/dossiers".length).replace(/^\//, "");
  const [cat, ...fileParts] = rest.split("/");
  const file = fileParts.join("/");

  try {
    const registry = loadRegistry();

    // 全樹
    if (!cat && req.method === "GET") {
      const tree = [];
      for (const c of registry) {
        const dir = DOSSIER_DIR(c.id);
        const files = existsSync(dir)
          ? readdirSync(dir).filter(f => !f.startsWith(".")).map(f => {
              const st = statSync(join(dir, f));
              return { name: f, size: st.size, mtime: st.mtime.toISOString(), sheet: SHEET_RE.test(f) };
            }).sort((a, b) => a.name.localeCompare(b.name))
          : [];
        tree.push({ id: c.id, name: c.name, emoji: c.emoji, agentId: c.agentId, enabled: c.enabled !== false, files });
      }
      return json(200, { categories: tree });
    }

    safeCat(cat, registry);

    // 上傳
    if (!file && req.method === "POST") {
      const body = await parseBody(req);
      const name = safeName(String(body.filename || ""));
      const b64 = String(body.dataBase64 || "");
      if (!b64) return json(400, { error: "dataBase64 必填" });
      mkdirSync(DOSSIER_DIR(cat), { recursive: true });
      writeFileSync(join(DOSSIER_DIR(cat), name), Buffer.from(b64, "base64"));
      return json(200, { ok: true, name });
    }

    if (!file) return json(400, { error: "缺檔名" });
    const safeFile = safeName(file);
    const fp = join(DOSSIER_DIR(cat), safeFile);

    if (req.method === "GET") {
      if (!existsSync(fp)) return json(404, { error: "檔案不存在" });
      if (SHEET_RE.test(safeFile)) {
        const _xlsx = await import("xlsx");
      const XLSX = _xlsx.default ?? _xlsx; // CJS interop：named exports 偵測不全（readFile 會漏），default 才是全套
        const wb = XLSX.readFile(fp);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const maxRows = 50;
        return json(200, {
          type: "sheet", file: safeFile, category: cat,
          sheets: wb.SheetNames,
          headers: rows[0] || [], previewRows: rows.slice(1, 1 + maxRows), totalRows: Math.max(0, rows.length - 1),
        });
      }
      return json(200, { type: "md", file: safeFile, category: cat, content: readFileSync(fp, "utf-8") });
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      mkdirSync(DOSSIER_DIR(cat), { recursive: true });
      writeFileSync(fp, String(body.content ?? ""), "utf-8");
      return json(200, { ok: true });
    }

    if (req.method === "DELETE") {
      if (existsSync(fp)) unlinkSync(fp);
      return json(200, { ok: true });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    return json(400, { error: e.message });
  }
}

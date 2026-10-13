/**
 * dossiers — 服務檔案櫃 CRUD + 上傳（_global 櫃固定存在）
 *   GET    /api/sre/dossiers                       → 全服務檔案樹（含 _global + 職能櫃）
 *   GET    /api/sre/dossiers/<svc>/<file>          → md 原文 / sheet 預覽
 *   PUT    /api/sre/dossiers/<svc>/<file> {content}→ 存 md
 *   POST   /api/sre/dossiers/<svc> {filename, dataBase64} → 上傳（xlsx/csv/md）
 *   DELETE /api/sre/dossiers/<svc>/<file>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { readBody, normalizePath, PAAW_ROOT } from "./shared.mjs";
import { BUILTIN_FUNCTIONS, ensureBuiltinCrews } from "./crews.mjs";

async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const DOSSIER_DIR = (svc) => join(PAAW_ROOT, "dossiers", svc);
const DOSSIER_BASE = join(PAAW_ROOT, "dossiers");

const SAFE_NAME = /^[^\\/:*?"<>|]+$/;
function safeName(n) {
  if (!n || n.includes("..") || !SAFE_NAME.test(n) || n.length > 120) throw new Error(`非法檔名：${n}`);
  return basename(n);
}

const SHEET_RE = /\.(xlsx|csv)$/i;

function loadRegistry() {
  try { return JSON.parse(readFileSync(join(PAAW_ROOT, "services.json"), "utf-8")); } catch { return []; }
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (!p.startsWith("/api/sre/dossiers")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  const rest = p.slice("/api/sre/dossiers".length).replace(/^\//, "");
  const [svc, ...fileParts] = rest.split("/");
  const file = fileParts.join("/");

  try {
    ensureBuiltinCrews(); // 冪等：確保職能櫃/註冊表/crews 就緒
    const registry = loadRegistry();

    // 全樹（_global 第一、職能櫃次之、服務櫃最後）
    if (!svc && req.method === "GET") {
      const tree = [];
      const pushDir = (c) => {
        const dir = DOSSIER_DIR(c.id);
        const files = existsSync(dir)
          ? readdirSync(dir).filter(f => !f.startsWith(".")).map(f => {
              const st = statSync(join(dir, f));
              return { name: f, size: st.size, mtime: st.mtime.toISOString(), sheet: SHEET_RE.test(f) };
            }).sort((a, b) => a.name.localeCompare(b.name))
          : [];
        tree.push({ id: c.id, name: c.name, emoji: c.emoji, agentId: c.agentId, enabled: c.enabled !== false, kind: c.kind === "function" ? "function" : "service", files });
      };
      pushDir({ id: "_global", name: "全域巡檢報告", emoji: "📊", agentId: "sre.chief", kind: "function" });
      for (const c of registry.filter(x => x.kind === "function")) pushDir(c);
      for (const c of registry.filter(x => x.kind !== "function")) pushDir(c);
      return json(200, { root: normalizePath(DOSSIER_BASE), services: tree });
    }

    // 合法性
    const known = new Set(["_global", "chief", ...registry.map(r => r.id), ...BUILTIN_FUNCTIONS.map(f => f.id)]);
    if (!known.has(svc)) throw new Error(`服務/職能不存在：${svc}`);

    if (!file && req.method === "POST") {
      const body = await parseBody(req);
      const name = safeName(String(body.filename || ""));
      const b64 = String(body.dataBase64 || "");
      if (!b64) return json(400, { error: "dataBase64 必填" });
      mkdirSync(DOSSIER_DIR(svc), { recursive: true });
      writeFileSync(join(DOSSIER_DIR(svc), name), Buffer.from(b64, "base64"));
      return json(200, { ok: true, name });
    }

    if (!file) return json(400, { error: "缺檔名" });
    const safeFile = safeName(file);
    const fp = join(DOSSIER_DIR(svc), safeFile);

    if (req.method === "GET") {
      if (!existsSync(fp)) return json(404, { error: "檔案不存在" });
      if (SHEET_RE.test(safeFile)) {
        const _xlsx = await import("xlsx");
        const XLSX = _xlsx.default ?? _xlsx;
        const wb = XLSX.readFile(fp);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const maxRows = 50;
        return json(200, {
          type: "sheet", file: safeFile, service: svc,
          sheets: wb.SheetNames,
          headers: rows[0] || [], previewRows: rows.slice(1, 1 + maxRows), totalRows: Math.max(0, rows.length - 1),
        });
      }
      return json(200, { type: "md", file: safeFile, service: svc, content: readFileSync(fp, "utf-8") });
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      mkdirSync(DOSSIER_DIR(svc), { recursive: true });
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

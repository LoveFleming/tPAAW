/**
 * dossiers — 服務檔案櫃 CRUD + 上傳（_global 櫃固定存在）
 *   GET    /api/sre/dossiers                       → 全服務檔案樹（含 _global + 職能櫃）
 *   GET    /api/sre/dossiers/<svc>/<file>          → md 原文 / sheet 預覽
 *   PUT    /api/sre/dossiers/<svc>/<file> {content}→ 存 md
 *   POST   /api/sre/dossiers/<svc> {filename, dataBase64} → 上傳（xlsx/csv/md）
 *   DELETE /api/sre/dossiers/<svc>/<file>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, basename, sep } from "path";
import { readBody, normalizePath, PAAW_ROOT } from "./shared.mjs";
import { BUILTIN_FUNCTIONS, ensureBuiltinCrews, loadRegistry } from "./crews.mjs";

/** parse + 驗證（QA C1）：非法 JSON 不再吞成 {}，直接 400 回客戶端 */
async function parseBody(req) {
  const raw = await readBody(req); // 帶 5MB 上限（shared shim，QA M1）
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw httpError(400, "SYS_CTRL_REQUEST_BODY_INVALID", "body 非合法 JSON"); }
}

/** 結構化錯誤（QA M2）：statusCode 讓外層 catch 正確分流，code 供前端判斷 */
function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

const DOSSIER_DIR = (svc) => join(PAAW_ROOT, "dossiers", svc);
const DOSSIER_BASE = join(PAAW_ROOT, "dossiers");

const SAFE_NAME = /^[^\\/:*?"<>|\x00-\x1f]+$/;
function safeName(n) {
  if (typeof n !== "string" || !n.trim() || n !== n.trim() || n.startsWith(".") || n.includes("..") || !SAFE_NAME.test(n) || n.length > 120) {
    throw httpError(400, "SYS_CTRL_REQUEST_FILENAME_INVALID", `非法檔名：${n}`);
  }
  return basename(n);
}

const SHEET_RE = /\.(xlsx|csv)$/i;
/** 上傳白名單（檔頭契約：xlsx/csv/md）*/
const UPLOAD_RE = /\.(md|xlsx|csv)$/i;

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (!p.startsWith("/api/sre/dossiers")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  const rest = p.slice("/api/sre/dossiers".length).replace(/^\//, "");
  const [svc, ...fileParts] = rest.split("/");
  const file = fileParts.join("/");

  try {
    await ensureBuiltinCrews(); // 冪等：確保職能櫃/註育表/crews 就緒
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

    // 合法性（known 集合成員皆為 registry id（slug 產出）或程式內建字面值，天然不含路徑分隔）
    const known = new Set(["_global", "chief", ...registry.map(r => r.id), ...BUILTIN_FUNCTIONS.map(f => f.id)]);
    if (!known.has(svc)) throw httpError(404, "BIZ_CTRL_QUERY_SERVICE_NOT_FOUND", `服務/職能不存在：${svc}`);
    // M3 縱深防禦：join 後確認仍在檔案櫃根之下（防未來 registry id 源頭被鬆動）
    const svcDir = DOSSIER_DIR(svc);
    if (svcDir !== DOSSIER_BASE && !svcDir.startsWith(DOSSIER_BASE + sep)) {
      throw httpError(400, "SYS_CTRL_REQUEST_PATH_INVALID", `非法服務櫃路徑：${svc}`);
    }

    // 上傳（副檔名白名單：檔頭契約為 xlsx/csv/md — QA minor）
    if (!file && req.method === "POST") {
      const body = await parseBody(req);
      const name = safeName(String(body.filename || ""));
      const b64 = String(body.dataBase64 || "");
      if (!b64) throw httpError(400, "SYS_CTRL_REQUEST_BODY_INVALID", "dataBase64 必填");
      if (!UPLOAD_RE.test(name)) throw httpError(400, "SYS_CTRL_REQUEST_FILENAME_INVALID", `不支援的檔案類型（僅 md/xlsx/csv）：${name}`);
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
      if (typeof body.content !== "string") {
        throw httpError(400, "SYS_CTRL_REQUEST_CONTENT_MISSING", "content 欄位必填（字串）— 拒絕寫入空內容覆蓋既有檔案");
      }
      mkdirSync(DOSSIER_DIR(svc), { recursive: true });
      writeFileSync(fp, body.content, "utf-8");
      return json(200, { ok: true });
    }

    if (req.method === "DELETE") {
      if (!existsSync(fp)) throw httpError(404, "BIZ_CTRL_QUERY_FILE_NOT_FOUND", `檔案不存在：${file}`);
      unlinkSync(fp);
      return json(200, { ok: true });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    // 4xx：client 端問題，回可讀訊息 + EC code（QA M2）；其餘 500 不洩內部細節
    if (e && typeof e.statusCode === "number" && e.statusCode < 500) {
      return json(e.statusCode, { error: e.message, code: e.code });
    }
    console.error(`[sre:dossiers] ${req.method} ${p} 未預期錯誤：`, e);
    return json(500, { error: "內部錯誤", code: "SYS_CTRL_REQUEST_INTERNAL" });
  }
}

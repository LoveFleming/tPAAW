/**
 * dossiers — 分類檔案櫃 CRUD + 上傳
 *   GET    /api/secret/dossiers                          → 全分類檔案樹
 *   GET    /api/secret/dossiers/<cat>/<file>             → md 原文 / sheet 預覽
 *   PUT    /api/secret/dossiers/<cat>/<file> {content}   → 存 md
 *   POST   /api/secret/dossiers/<cat> {filename, dataBase64} → 上傳（xlsx/csv/md）
 *   DELETE /api/secret/dossiers/<cat>/<file>
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { readBody, PAAW_ROOT, normalizePath } from "./shared.mjs";

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

const DOSSIER_DIR = (cat) => join(PAAW_ROOT, "dossiers", cat);
/** 檔案櫃根（sidebar SidebarFileTree projectRoot 用） */
const DOSSIER_BASE = join(PAAW_ROOT, "dossiers");
/** 檔名白名名單：中英文/數字/底線/連字/點，禁路徑分隔與 .. */
const SAFE_NAME = /^[^\\/:*?"<>|\x00-\x1f]+$/;
function safeName(n) {
  if (typeof n !== "string" || !n.trim() || n !== n.trim() || n.startsWith(".") || n.includes("..") || !SAFE_NAME.test(n) || n.length > 120) {
    throw httpError(400, "SYS_CTRL_REQUEST_FILENAME_INVALID", `非法檔名：${n}`);
  }
  return basename(n);
}
function safeCat(cat, registry) {
  const c = registry.find(x => x.id === cat);
  if (!c) throw httpError(404, "BIZ_CTRL_QUERY_CATEGORY_NOT_FOUND", `分類不存在：${cat}`);
  return c;
}
const REG_FILE = join(PAAW_ROOT, "categories.json");

/** 讀 registry（QA C2）：檔案不存在 → 空陣列（caller 重建）；損毀（parse 失敗/非陣列）→ 上拋，絕不以空陣列 persist 蓋掉使用者分類 */
function loadRegistry() {
  let raw;
  try { raw = readFileSync(REG_FILE, "utf-8"); } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("categories.json 內容非陣列");
  return list;
}

/** 原子寫（QA C2/M4）：tmp → rename */
function saveRegistry(list) {
  const tmp = REG_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(list, null, 2));
  renameSync(tmp, REG_FILE);
}

/** 讀-改-寫序列化（QA M4）：並發不 lost update */
let _regLock = Promise.resolve();
function withRegistry(mutate) {
  _regLock = _regLock.then(async () => {
    const reg = loadRegistry();
    const out = await mutate(reg);
    if (out !== undefined) saveRegistry(out);
  });
  return _regLock;
}

const SHEET_RE = /\.(xlsx|csv)$/i;
/** 上傳白名單（檔頭契約：xlsx/csv/md）*/
const UPLOAD_RE = /\.(md|xlsx|csv)$/i;

/** builtin 分類編制 — 掛載時 ensure（categories.json+櫃+README），冪等：公司端開箱即用 */
const BUILTIN_CATS = [
  { id: "schedule", name: "行程管家", emoji: "📅", agentId: "secret.schedule", duty: "處長日曆、會議安排、差旅" },
  { id: "reports", name: "報表專家", emoji: "📊", agentId: "secret.reports", duty: "Excel/CSV 彙整與產出" },
  { id: "meetings", name: "會議秘書", emoji: "📝", agentId: "secret.meetings", duty: "議程、記錄、決議追蹤" },
  { id: "documents", name: "公文管理", emoji: "📄", agentId: "secret.documents", duty: "簽呈、歸檔、效期" },
  { id: "admin", name: "行政總務", emoji: "💰", agentId: "secret.admin", duty: "請購、報帳、設備" },
  { id: "hrliaison", name: "人事窗口", emoji: "👥", agentId: "secret.hrliaison", duty: "出缺勤彙整、跨部門" }
];
function ensureBuiltinCategories() {
  try {
    let reg = loadRegistry(); // 損毀 → throw → 本函式靜默失敗，絕不以 [] 為基底 persist（QA C2）
    let changed = false;
    for (const c of BUILTIN_CATS) {
      const dir = DOSSIER_DIR(c.id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const readme = join(dir, "README.md");
      if (!existsSync(readme)) {
        writeFileSync(readme, `# ${c.emoji} ${c.name}（${c.agentId}）\n\n職責：${c.duty}\n\n## 檔案慣例\n- 產出檔帶主題與日期：\`主題-YYYY-MM-DD.md\`\n- xlsx/csv 報表直接上傳，側欄可預覽\n`);
      }
      if (!reg.some(r => r.id === c.id)) {
        reg.push({ id: c.id, name: c.name, emoji: c.emoji, agentId: c.agentId, builtin: true, description: c.duty, enabled: true, createdAt: new Date().toISOString() });
        changed = true;
      }
    }
    if (changed) saveRegistry(reg);
  } catch (e) {
    // 唯讀環境靜默；但 registry 損毀必須大聲（QA C2）— 讓使用者知道為何清單變空，而不是被靜默蓋掉
    console.error(`[secret:dossiers] ensureBuiltinCategories 失敗（registry 未被覆寫）：${e.message}`);
  }
}
ensureBuiltinCategories();

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
      return json(200, { root: normalizePath(DOSSIER_BASE), categories: tree });
    }

    safeCat(cat, registry);

    // 上傳（副檔名白名單：檔頭契約為 xlsx/csv/md — QA minor）
    if (!file && req.method === "POST") {
      const body = await parseBody(req);
      const name = safeName(String(body.filename || ""));
      const b64 = String(body.dataBase64 || "");
      if (!b64) throw httpError(400, "SYS_CTRL_REQUEST_BODY_INVALID", "dataBase64 必填");
      if (!UPLOAD_RE.test(name)) throw httpError(400, "SYS_CTRL_REQUEST_FILENAME_INVALID", `不支援的檔案類型（僅 md/xlsx/csv）：${name}`);
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
      if (typeof body.content !== "string") {
        throw httpError(400, "SYS_CTRL_REQUEST_CONTENT_MISSING", "content 欄位必填（字串）— 拒絕寫入空內容覆蓋既有檔案");
      }
      mkdirSync(DOSSIER_DIR(cat), { recursive: true });
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
    console.error(`[secret:dossiers] ${req.method} ${p} 未預期錯誤：`, e);
    return json(500, { error: "內部錯誤", code: "SYS_CTRL_REQUEST_INTERNAL" });
  }
}

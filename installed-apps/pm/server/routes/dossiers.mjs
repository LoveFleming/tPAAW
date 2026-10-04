/**
 * dossiers — 產品檔案櫃 CRUD + 上傳（_global 櫃固定存在）
 *   GET    /api/pm/dossiers                          → 全產品檔案樹（含 _global）
 *   GET    /api/pm/dossiers/<proj>/<file>            → md 原文 / sheet 預覽
 *   PUT    /api/pm/dossiers/<proj>/<file> {content}  → 存 md
 *   POST   /api/pm/dossiers/<proj> {filename, dataBase64} → 上傳（xlsx/csv/md）
 *   DELETE /api/pm/dossiers/<proj>/<file>
 */
import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { readBody, normalizePath, PAAW_ROOT } from "./shared.mjs";

/** readBody 回 raw string — 這裡 parse + 空 body 容錯（同 learning module 慣例） */
async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const DOSSIER_DIR = (proj) => join(PAAW_ROOT, "dossiers", proj);
/** 檔案櫃根（sidebar SidebarFileTree projectRoot 用） */
const DOSSIER_BASE = join(PAAW_ROOT, "dossiers");

/** 職能專家編制（方案 B：橫向參謀）— 掛載時 ensure（資料夾+README+registry），冪等 */
const BUILTIN_FUNCTIONS = [
  { id: "strategy", name: "產品策略師", emoji: "🧭", agentId: "pm.strategy", duty: "產品定位、願景、北極星指標、版本路線圖與優先序仲裁" },
  { id: "research", name: "用戶研究員", emoji: "🔍", agentId: "pm.research", duty: "用戶訪談整理、競品分析、市場趨勢、VOC 需求驗證" },
  { id: "requirements", name: "需求管理師", emoji: "📋", agentId: "pm.requirements", duty: "backlog 排序、PRD/用戶故事撰寫、驗收條件定義" },
  { id: "data", name: "數據分析師", emoji: "📊", agentId: "pm.data", duty: "KPI 追蹤、指標覆盤、A/B 結論解讀、異常警示" },
  { id: "launch", name: "上市指揮官", emoji: "🚀", agentId: "pm.launch", duty: "發布計畫、上市公告文案、上市後檢討（post-launch review）" },
  { id: "alignment", name: "對齊窗口", emoji: "🤝", agentId: "pm.alignment", duty: "跨部門會議記錄、決議追蹤、老闆需求緩衝與轉譯" },
];
function ensureBuiltinFunctions() {
  try {
    let reg = loadRegistry();
    let changed = false;
    for (const f of BUILTIN_FUNCTIONS) {
      const dir = DOSSIER_DIR(f.id);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const readme = join(dir, "README.md");
      if (!existsSync(readme)) {
        writeFileSync(readme, `# ${f.emoji} ${f.name}（${f.agentId}）\n\n職責：${f.duty}\n\n## 檔案慣例\n- 產出檔帶主題與日期：\`主題-YYYY-MM-DD.md\`\n- 跨產品通用知識（模板、checklist、方法論）放這裡\n- 引用產品事實時註明來源櫃與檔名（如 \`ai-portal/product.md\`）\n`);
      }
      if (!reg.some(r => r.id === f.id)) {
        reg.push({ ...f, description: f.duty, kind: "function", builtin: true, enabled: true });
        changed = true;
      }
    }
    if (changed) writeFileSync(join(PAAW_ROOT, "projects.json"), JSON.stringify(reg, null, 2));
  } catch { /* 唯讀環境静默 */ }
}
ensureBuiltinFunctions();
/** 檔名白名單：中英文/數字/底線/連字/點，禁路徑分隔與 .. */
const SAFE_NAME = /^[^\\/:*?"<>|]+$/;
function safeName(n) {
  if (!n || n.includes("..") || !SAFE_NAME.test(n) || n.length > 120) throw new Error(`非法檔名：${n}`);
  return basename(n);
}
function safeProj(proj, registry) {
  if (proj === "_global") return { id: "_global", name: "全域報表", emoji: "📊", agentId: "pm.reports" };
  const c = registry.find(x => x.id === proj);
  if (!c) throw new Error(`產品不存在：${proj}`);
  return c;
}
function loadRegistry() {
  try { return JSON.parse(readFileSync(join(PAAW_ROOT, "projects.json"), "utf-8")); } catch { return []; }
}

const SHEET_RE = /\.(xlsx|csv)$/i;

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (!p.startsWith("/api/pm/dossiers")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  const rest = p.slice("/api/pm/dossiers".length).replace(/^\//, "");
  const [proj, ...fileParts] = rest.split("/");
  const file = fileParts.join("/");

  try {
    const registry = loadRegistry();

    // 全樹（_global 永遠在第一個）
    if (!proj && req.method === "GET") {
      const tree = [];
      const pushDir = (c) => {
        const dir = DOSSIER_DIR(c.id);
        const files = existsSync(dir)
          ? readdirSync(dir).filter(f => !f.startsWith(".")).map(f => {
              const st = statSync(join(dir, f));
              return { name: f, size: st.size, mtime: st.mtime.toISOString(), sheet: SHEET_RE.test(f) };
            }).sort((a, b) => a.name.localeCompare(b.name))
          : [];
        tree.push({ id: c.id, name: c.name, emoji: c.emoji, agentId: c.agentId, enabled: c.enabled !== false, kind: c.kind === "function" ? "function" : "product", files });
      };
      pushDir({ id: "_global", name: "全域報表", emoji: "📊", agentId: "pm.reports", kind: "function" });
      for (const c of registry) pushDir(c);
      return json(200, { root: normalizePath(DOSSIER_BASE), projects: tree });
    }

    safeProj(proj, registry);

    // 上傳
    if (!file && req.method === "POST") {
      const body = await parseBody(req);
      const name = safeName(String(body.filename || ""));
      const b64 = String(body.dataBase64 || "");
      if (!b64) return json(400, { error: "dataBase64 必填" });
      mkdirSync(DOSSIER_DIR(proj), { recursive: true });
      writeFileSync(join(DOSSIER_DIR(proj), name), Buffer.from(b64, "base64"));
      return json(200, { ok: true, name });
    }

    if (!file) return json(400, { error: "缺檔名" });
    const safeFile = safeName(file);
    const fp = join(DOSSIER_DIR(proj), safeFile);

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
          type: "sheet", file: safeFile, project: proj,
          sheets: wb.SheetNames,
          headers: rows[0] || [], previewRows: rows.slice(1, 1 + maxRows), totalRows: Math.max(0, rows.length - 1),
        });
      }
      return json(200, { type: "md", file: safeFile, project: proj, content: readFileSync(fp, "utf-8") });
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      mkdirSync(DOSSIER_DIR(proj), { recursive: true });
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

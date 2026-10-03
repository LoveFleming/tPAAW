/**
 * secretary-tools — 🕴️ 秘書 module 的 agent 工具（secretary group）
 *
 * 五支工具：category_list / dossier_read / dossier_write / read_sheet / write_sheet
 * 範圍強制（Context Boundary 精神 — 程式保證，prompt 只是引導）：
 *   - agent = secret.<cat>（非 chief）→ write 強制落在自己櫃；read/跨櫃放行（彙整需要）
 *   - chief / 其他 agent → 全櫃可用
 * 資料根 = PAAW data/installed-apps/secret（與 module routes 同一棵樹）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const _here = dirname(fileURLToPath(import.meta.url));
export const SECRET_ROOT = resolve(_here, "../../../data/installed-apps/secret");
const DOSSIER_DIR = (cat) => join(SECRET_ROOT, "dossiers", cat);

function loadRegistry() {
  try { return JSON.parse(readFileSync(join(SECRET_ROOT, "categories.json"), "utf-8")); } catch { return []; }
}
function agentCategory(agentId) {
  if (!agentId || !agentId.startsWith("secret.")) return null;
  const id = agentId.slice("secret.".length);
  if (id === "chief") return null; // chief 跨櫃
  return id;
}
function enforceWriteCategory(cat, agentId) {
  const own = agentCategory(agentId);
  if (own && own !== cat) {
    throw new Error(`範圍限制：${agentId} 只能寫「${own}」櫃（嘗試寫「${cat}」被擋）。跨櫃寫入請找總管秘書 secret.chief。`);
  }
}
function safeCat(cat) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(cat)) throw new Error(`非法分類：${cat}`);
  return cat;
}
function safeFile(f) {
  const name = String(f || "");
  if (!name || name.includes("..") || /[\\/:*?"<>|]/.test(name) || name.length > 120) throw new Error(`非法檔名：${name}`);
  return name;
}

/** markdown 表格給 prompt 用 */
function toMdTable(headers, rows, maxRows = 30) {
  const h = headers.map(String);
  const shown = rows.slice(0, maxRows);
  const line = (arr) => `| ${arr.map(v => String(v ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const out = [line(h), `|${h.map(() => "---").join("|")}|`];
  for (const r of shown) out.push(line(h.map((_, i) => r[i])));
  if (rows.length > maxRows) out.push(`_（顯示前 ${maxRows} 列，共 ${rows.length} 列 — 指定 maxRows 可看更多）_`);
  return out.join("\n");
}

export const SECRETARY_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "category_list",
      description: "🗂️ 列出秘書模組全部分類（檔案櫃+對應 AI 專家）。回答「有哪些分類/找誰辦」用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "dossier_read",
      description: "📖 讀分類檔案櫃裡的檔案（.md 全文）。回答事實前先讀檔，不憑記憶。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "分類 id（category_list 查）" },
          file: { type: "string", description: "檔名；留空列出該櫃檔案清單" },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "dossier_write",
      description: "✍️ 寫檔進分類檔案櫃（.md）— 記錄落檔是鐵律，口頭承諾不算。⚠️ 你只能寫自己分類的櫃（程式強制）。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "分類 id" },
          file: { type: "string", description: "檔名（含 .md），如 2026-10-03-處務會議.md" },
          content: { type: "string", description: "完整檔案內容（覆蓋寫）" },
        },
        required: ["category", "file", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_sheet",
      description: "📊 讀 Excel/CSV（xlsx 引擎）→ 回 markdown 表格（header 偵測+統計）。彙整/比對前必用；沒讀過的表不下結論。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "分類 id" },
          file: { type: "string", description: "xlsx/csv 檔名" },
          maxRows: { type: "number", description: "回傳列數上限（預設 30，最大 200）" },
        },
        required: ["category", "file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_sheet",
      description: "📤 產出 Excel（headers+rows → xlsx 落指定分類櫃）。⚠️ 只能寫自己分類的櫃；來源檔永不改動，永遠產新檔。",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "分類 id" },
          file: { type: "string", description: "輸出檔名（自動補 .xlsx）" },
          headers: { type: "array", items: { type: "string" }, description: "表頭" },
          rows: { type: "array", items: { type: "array" }, description: "資料列（二維）" },
        },
        required: ["category", "file", "headers", "rows"],
      },
    },
  },
];

export async function runSecretaryTool(name, args, agentId) {
  try {
    if (name === "category_list") {
      const cats = loadRegistry();
      if (!cats.length) return "（尚無分類）";
      return cats.map(c => `${c.emoji || "📁"} ${c.id}「${c.name}」→ ${c.agentId}${c.enabled === false ? "（停用）" : ""}：${c.description || ""}`).join("\n");
    }

    if (name === "dossier_read") {
      const cat = safeCat(args.category);
      const dir = DOSSIER_DIR(cat);
      if (!args.file) {
        if (!existsSync(dir)) return `分類「${cat}」檔案櫃不存在`;
        const files = readdirSync(dir).filter(f => !f.startsWith("."));
        if (!files.length) return `分類「${cat}」櫃是空的`;
        return files.map(f => {
          const st = statSync(join(dir, f));
          return `- ${f}（${(st.size / 1024).toFixed(1)}KB）`;
        }).join("\n");
      }
      const fp = join(dir, safeFile(args.file));
      if (!existsSync(fp)) return `檔案不存在：${cat}/${args.file}（先無 file 列清單）`;
      return readFileSync(fp, "utf-8").slice(0, 60000);
    }

    if (name === "dossier_write") {
      const cat = safeCat(args.category);
      enforceWriteCategory(cat, agentId);
      const file = safeFile(args.file);
      mkdirSync(DOSSIER_DIR(cat), { recursive: true });
      writeFileSync(join(DOSSIER_DIR(cat), file), String(args.content ?? ""), "utf-8");
      return `✅ 已落檔：${cat}/${file}（${String(args.content).length} 字）`;
    }

    if (name === "read_sheet") {
      const cat = safeCat(args.category);
      const _xlsx = await import("xlsx");
      const XLSX = _xlsx.default ?? _xlsx; // CJS interop：named exports 偵測不全（readFile 會漏），default 才是全套
      const fp = join(DOSSIER_DIR(cat), safeFile(args.file));
      if (!existsSync(fp)) return `檔案不存在：${cat}/${args.file}`;
      const wb = XLSX.readFile(fp);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!rows.length) return "空表";
      const maxRows = Math.min(Math.max(Number(args.maxRows) || 30, 1), 200);
      const headers = rows[0].map(String);
      const data = rows.slice(1);
      // 數值欄統計
      const stats = [];
      headers.forEach((h, i) => {
        const vals = data.map(r => Number(r[i])).filter(v => !Number.isNaN(v));
        if (vals.length >= Math.max(3, data.length * 0.5)) {
          const sum = vals.reduce((a, b) => a + b, 0);
          stats.push(`${h}: Σ=${Math.round(sum * 100) / 100} avg=${Math.round((sum / vals.length) * 100) / 100} n=${vals.length}`);
        }
      });
      return `【${args.file}｜${wb.SheetNames[0]}｜共 ${data.length} 列】\n${toMdTable(headers, data, maxRows)}${stats.length ? `\n\n📊 數值統計：${stats.join("；")}` : ""}`;
    }

    if (name === "write_sheet") {
      const cat = safeCat(args.category);
      enforceWriteCategory(cat, agentId);
      const _xlsx = await import("xlsx");
      const XLSX = _xlsx.default ?? _xlsx; // CJS interop：named exports 偵測不全（readFile 會漏），default 才是全套
      const headers = (args.headers || []).map(String);
      if (!headers.length) throw new Error("headers 必填");
      const data = (args.rows || []);
      const file = safeFile(args.file).replace(/\.(csv|md)$/i, "");
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(10, Math.min(30, h.length * 2 + 4)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const out = join(DOSSIER_DIR(cat), `${file}.xlsx`);
      mkdirSync(DOSSIER_DIR(cat), { recursive: true });
      XLSX.writeFile(wb, out);
      return `✅ 已產出：${cat}/${file}.xlsx（${headers.length} 欄 × ${data.length} 列）`;
    }

    return `未知工具：${name}`;
  } catch (e) {
    return `❌ ${e.message}`;
  }
}

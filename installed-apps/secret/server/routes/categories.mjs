/**
 * categories — 分類註冊表 + 動態新增（自動 scaffold crew agent）+ 換綁/停用
 *   GET    /api/secret/categories
 *   POST   /api/secret/categories        {name, emoji, description, id?}
 *   PATCH  /api/secret/categories        {id, name?, emoji?, agentId?, enabled?}
 * 新增分類 = 建檔案櫃 + 生成 data/crews/secret.<id>.json + 註冊 — 完成即用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readBody, PAAW_ROOT, TPAW_REPO_ROOT } from "./shared.mjs";

/** readBody 回 raw string — 這裡 parse + 空 body 容錯（同 learning module 慣例） */
async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const REG = join(PAAW_ROOT, "categories.json");

function load() {
  try { return JSON.parse(readFileSync(REG, "utf-8")); } catch { return []; }
}
function save(list) { writeFileSync(REG, JSON.stringify(list, null, 2)); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `cat${Date.now().toString(36)}`;

function scaffoldCrew({ id, name, emoji, description }) {
  const agentId = `secret.${id}`;
  const rolePrompt = `# ${emoji} ${name} — 秘書分類專家

你是處長室秘書團隊的「${name}」專家。職責：${description || "（使用者未填，依分類名稱發揮）"}

## 工作方式
1. 相關資訊一律落檔（dossier_write 記進「${id}」櫃）— 檔案是事實的唯一來源
2. 回答前先讀檔（dossier_read），不憑記憶
3. 表格資料用 read_sheet / write_sheet

## 鐵律
- 只能讀寫「${id}」櫃（write 強制；讀可跨櫃供彙整）
- 有期限的事項用效期格式：\`- [expires:YYYY-MM-DD] 項目 — 說明\`
- 待辦用 checkbox：\`- [ ] 未完成\` / \`- [x] 完成\`
- 機敏資料不外傳、不上網
- 繁體中文`;
  const crew = {
    id: agentId, title: name, codename: `${name}`, imageUrl: "", skillIds: [],
    description: description || `${name}分類專家`,
    rolePrompt,
    expertise: description || name,
    guardrails: { redirectRules: "非本分類事務 → 總管秘書 (secret.chief)", refuseTopics: "機敏個資外傳" },
    chatConfig: {
      greeting: `嗨！我是${emoji} ${name}。\n\n${description || "這個分類的專家"}。有什麼要幫忙的？`,
      maxTokens: 8192, temperature: 0.4, engine: "paaw-agent",
    },
    toolGroups: ["secretary", "memory"],
  };
  const crewPath = join(TPAW_REPO_ROOT, "data", "crews", `${agentId}.json`);
  writeFileSync(crewPath, JSON.stringify(crew, null, 2));
  return { agentId, crewPath };
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/secret/categories")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  if (req.method === "GET") {
    return json(200, { categories: load() });
  }

  if (req.method === "POST") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(400, { error: "name 必填" });
    const list = load();
    let id = slug(String(body.id || ""));
    if (!id) id = slug(name);                    // 英文名直接 slug
    if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {  // 中文名 → cat-N 序號（max+1 防撞）
      let n = 1;
      for (const c of list) { const m = /^cat-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
      id = `cat-${n}`;
    }
    if (list.some(c => c.id === id)) return json(400, { error: `分類 ${id} 已存在` });
    if (existsSync(join(PAAW_ROOT, "dossiers", id))) return json(400, { error: `dossiers/${id} 目錄已存在` });
    const emoji = String(body.emoji || "📁").slice(0, 4);
    const description = String(body.description || "").slice(0, 200);
    const { agentId } = scaffoldCrew({ id, name, emoji, description });
    mkdirSync(join(PAAW_ROOT, "dossiers", id), { recursive: true });
    writeFileSync(join(PAAW_ROOT, "dossiers", id, "README.md"),
      `# ${emoji} ${name} 檔案櫃\n\n${description || "（動態建立的分類）"}\n\n## 約定\n- 待辦用 checkbox：\`- [ ]\` / \`- [x]\`\n- 效期格式：\`- [expires:YYYY-MM-DD] 項目 — 說明\`\n`);
    const cat = { id, name, emoji, agentId, builtin: false, description, enabled: true, createdAt: new Date().toISOString() };
    list.push(cat); save(list);
    return json(200, { ok: true, category: cat });
  }

  if (req.method === "PATCH") {
    const body = await parseBody(req);
    const list = load();
    const cat = list.find(c => c.id === body.id);
    if (!cat) return json(404, { error: `分類 ${body.id} 不存在` });
    if (body.name) cat.name = String(body.name).slice(0, 60);
    if (body.emoji) cat.emoji = String(body.emoji).slice(0, 4);
    if (body.agentId) cat.agentId = String(body.agentId);
    if (typeof body.enabled === "boolean") cat.enabled = body.enabled;
    save(list);
    return json(200, { ok: true, category: cat });
  }

  return json(405, { error: "method not allowed" });
}

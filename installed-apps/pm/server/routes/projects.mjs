/**
 * projects — 專案註冊表 + 動態開專案（自動 scaffold 模板檔組 + crew agent）+ 改狀態/停用
 *   GET    /api/pm/projects
 *   POST   /api/pm/projects   {name, emoji, goal, owner, start?, end?, id?}
 *   PATCH  /api/pm/projects   {id, name?, emoji?, status?, agentId?, enabled?}
 * 開專案 = 4 模板檔（charter/schedule/risks/issues）+ README + data/crews/pm.<id>.json — 完成即用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readBody, PAAW_ROOT, TPAW_REPO_ROOT } from "./shared.mjs";

/** readBody 回 raw string — 這裡 parse + 空 body 容錯（同 learning module 慣例） */
async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const REG = join(PAAW_ROOT, "projects.json");

function load() {
  try { return JSON.parse(readFileSync(REG, "utf-8")); } catch { return []; }
}
function save(list) { writeFileSync(REG, JSON.stringify(list, null, 2)); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function scaffoldCrew({ id, name, emoji, goal, owner }) {
  const agentId = `pm.${id}`;
  const rolePrompt = `# ${emoji} ${name} — 專案管家

你是「${name}」專案的專屬管家，這個專案檔案櫃的唯一記錄者。

## 專案
- 目標：${goal || "（見 charter.md，持續補全）"}
- Owner：${owner || "（待補）"}

## 工作方式
1. 相關資訊一律落檔（project_write 記進「${id}」櫃）— 檔案是事實的唯一來源
2. 回答前先讀檔（project_read），不憑記憶
3. 表格資料用 project_read_sheet / project_write_sheet

## 落檔格式（雷達靠這些掃描）
- 里程碑：\`- [milestone:YYYY-MM-DD] 名稱 — 驗收條件\`（schedule.md）
- 追蹤截止（風險/議題）：\`- R1 [due:YYYY-MM-DD] 描述｜機率:中｜衝擊:高｜緩解:…\`（risks.md / issues.md）
- 待辦：\`- [ ] 未完成\` / \`- [x] 完成\`
- 狀態燈：charter.md 的 \`> status: 🟢🟡🔴\`（你自己評：🟢正常 🟡有風險 🔴已卡關）

## 鐵律
- 只能寫「${id}」櫃（write 強制）；讀其他專案櫃合法（參考格式可以）
- 里程碑變動要留痕（改日期 = 新行註記舊日期作廢）
- 機敏資料不外傳、不上網
- 繁體中文`;
  const crew = {
    id: agentId, title: `${name} · 專案管家`, codename: name, imageUrl: "", skillIds: [],
    description: `${name} 專案管家`,
    rolePrompt,
    expertise: `${name} 專案管理\n時程與里程碑\n風險與議題追蹤`,
    guardrails: { redirectRules: `非本專案事務 → pm.chief 總管\n跨專案報表 → pm.reports`, refuseTopics: "機敏個資外傳" },
    chatConfig: {
      greeting: `嗨！我是${emoji} ${name} 的專案管家。\n\n這個專案的時程、風險、議題、會議紀錄都在我這櫃。要加里程碑、記議題、還是看現況？`,
      maxTokens: 8192, temperature: 0.4, engine: "paaw-agent",
    },
    toolGroups: ["pm", "memory"],
  };
  const crewPath = join(TPAW_REPO_ROOT, "data", "crews", `${agentId}.json`);
  writeFileSync(crewPath, JSON.stringify(crew, null, 2));
  return { agentId, crewPath };
}

function scaffoldTemplates({ id, name, emoji, goal, owner, start, end }) {
  const dir = join(PAAW_ROOT, "dossiers", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "charter.md"),
`# ${emoji} ${name} — 專案章程

> status: 🟢
> owner: ${owner || "（待補）"}
> 起訖：${start || "（待補）"} ~ ${end || "（待補）"}

## 目標
${goal || "（待補 — 一句話說清楚什麼算成功）"}

## 範圍
（待補：做什麼、不做什麼）

## 里程碑
見 schedule.md
`);
  writeFileSync(join(dir, "schedule.md"),
`# 時程

里程碑格式：\`- [milestone:YYYY-MM-DD] 名稱 — 驗收條件\`

- [milestone:${end || "2099-12-31"}] 結案 — ${goal || "目標達成"}
`);
  writeFileSync(join(dir, "risks.md"),
`# 風險登記冊

格式：\`- R1 [due:YYYY-MM-DD] 風險描述｜機率:高/中/低｜衝擊:高/中/低｜緩解:措施\`

（尚無登錄）
`);
  writeFileSync(join(dir, "issues.md"),
`# 議題 log

格式：\`- I1 [due:YYYY-MM-DD] 議題描述 — owner / 狀態\`

（尚無議題）
`);
  writeFileSync(join(dir, "README.md"),
`# ${emoji} ${name} 檔案櫃

${goal || "專案檔案櫃"} — 專屬 agent：pm.${id}

## 約定
- 里程碑 \`- [milestone:YYYY-MM-DD]\`（schedule.md）
- 追蹤截止 \`[due:YYYY-MM-DD]\`（risks.md / issues.md）
- 待辦 checkbox：\`- [ ]\` / \`- [x]\`
- 狀態燈 charter.md \`> status: 🟢🟡🔴\`
`);
  return dir;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/pm/projects")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  if (req.method === "GET") {
    return json(200, { projects: load() });
  }

  if (req.method === "POST") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(400, { error: "name 必填" });
    const list = load();
    let id = slug(String(body.id || ""));
    if (!id) id = slug(name);                    // 英文名直接 slug
    if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {  // 中文名 → proj-N 序號（max+1 防撞）
      let n = 1;
      for (const c of list) { const m = /^proj-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
      id = `proj-${n}`;
    }
    if (id === "_global" || id === "chief" || id === "reports") return json(400, { error: `保留字不可用：${id}` });
    if (list.some(c => c.id === id)) return json(400, { error: `專案 ${id} 已存在` });
    if (existsSync(join(PAAW_ROOT, "dossiers", id))) return json(400, { error: `dossiers/${id} 目錄已存在` });
    const emoji = String(body.emoji || "🗂️").slice(0, 4);
    const goal = String(body.goal || "").slice(0, 300);
    const owner = String(body.owner || "").slice(0, 60);
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.start || "")) ? body.start : "";
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(body.end || "")) ? body.end : "";
    const { agentId } = scaffoldCrew({ id, name, emoji, goal, owner });
    scaffoldTemplates({ id, name, emoji, goal, owner, start, end });
    const proj = { id, name, emoji, agentId, goal, owner, start, end, status: "🟢", builtin: false, enabled: true, createdAt: new Date().toISOString() };
    list.push(proj); save(list);
    return json(200, { ok: true, project: proj });
  }

  if (req.method === "PATCH") {
    const body = await parseBody(req);
    const list = load();
    const proj = list.find(c => c.id === body.id);
    if (!proj) return json(404, { error: `專案 ${body.id} 不存在` });
    if (body.name) proj.name = String(body.name).slice(0, 60);
    if (body.emoji) proj.emoji = String(body.emoji).slice(0, 4);
    if (body.status) proj.status = String(body.status).slice(0, 4);
    if (body.agentId) proj.agentId = String(body.agentId);
    if (typeof body.enabled === "boolean") proj.enabled = body.enabled;
    save(list);
    return json(200, { ok: true, project: proj });
  }

  return json(405, { error: "method not allowed" });
}

/**
 * projects — 產品註冊表 + 動態開產品（自動 scaffold 模板檔組 + crew agent）+ 改狀態/停用
 *   GET    /api/pm/projects
 *   POST   /api/pm/projects   {name, emoji, goal, owner, start?, end?, id?}
 *   PATCH  /api/pm/projects   {id, name?, emoji?, status?, agentId?, enabled?}
 * 開產品 = 4 模板檔（product/roadmap/backlog/metrics）+ README + data/crews/pm.<id>.json — 完成即用。
 * （2026-10-04 重規劃：PM = Product Manager，專案→產品）
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

export function scaffoldCrew({ id, name, emoji, goal, owner }) {
  const agentId = `pm.${id}`;
  const rolePrompt = `# ${emoji} ${name} — 產品管家

你是「${name}」產品的專屬管家，這個產品檔案櫃的唯一記錄者。

## 產品
- 目標：${goal || "（見 product.md，持續補全）"}
- Owner：${owner || "（待補）"}

## 工作方式
1. 相關資訊一律落檔（project_write 記進「${id}」櫃）— 檔案是事實的唯一來源
2. 回答前先讀檔（project_read），不憑記憶
3. 表格資料用 project_read_sheet / project_write_sheet
4. 開發啟動時主動開 prd.md（範圍/用戶故事/驗收條件）；VOC 進 feedback.md；風險多時開 risks.md

## 落檔格式（雷達靠這些掃描）
- 版本里程碑：\`- [milestone:YYYY-MM-DD] v1.0 — 內容 — 驗收條件\`（roadmap.md）
- 覆盤/追蹤截止：\`- [due:YYYY-MM-DD] 描述\`（metrics.md 覆盤日、backlog.md 追蹤項）
- 需求：\`- [ ] P1 需求描述｜來源:VOC/老闆/數據\` / \`- [x] 完成\`（backlog.md）
- 燈號與階段：product.md 的 \`> status: 🟢🟡🔴\`（🟢健康 🟡有風險 🔴卡關）+ \`> stage: 🌱探索/🏗️開發/🚀上線/📈成長/🔧維護\`

## 鐵律
- 只能寫「${id}」櫃（write 強制）；讀其他產品櫃合法（參考格式可以）
- 需求排序以北極星指標為準 — 說不清服務哪個指標的需求不排 P0
- 里程碑變動要留痕（改日期 = 新行註記舊日期作廢）
- 機敏資料不外傳、不上網
- 繁體中文`;
  const crew = {
    id: agentId, title: `${name} · 產品管家`, codename: name, imageUrl: "", skillIds: [],
    description: `${name} 產品管家`,
    rolePrompt,
    expertise: `${name} 產品管理\n需求池與優先序\n路線圖與版本里程碑\nVOC 與指標覆盤`,
    guardrails: { redirectRules: `非本產品事務 → pm.chief 首席產品經理\n跨產品報表 → pm.reports`, refuseTopics: "機敏個資外傳" },
    chatConfig: {
      greeting: `嗨！我是${emoji} ${name} 的產品管家。\n\n這個產品的定位、路線圖、需求池、指標、用戶反饋都在我這櫃。要排需求、記 VOC、定版本，還是看現況？`,
      maxTokens: 8192, temperature: 0.4, engine: "paaw-agent",
    },
    toolGroups: ["pm", "memory"],
  };
  const crewPath = join(TPAW_REPO_ROOT, "data", "crews", `${agentId}.json`);
  writeFileSync(crewPath, JSON.stringify(crew, null, 2));
  return { agentId, crewPath };
}

export function scaffoldTemplates({ id, name, emoji, goal, owner, start, end }) {
  const dir = join(PAAW_ROOT, "dossiers", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "product.md"),
`# ${emoji} ${name} — 產品定位

> status: 🟢
> stage: 🌱 探索
> owner: ${owner || "（待補）"}
> 期間：${start || "（待補）"} ~ ${end || "（待補）"}

## 一句話定位
（待補：這個產品給誰、解決什麼問題、憑什麼贏）

## 目標用戶
（待補）

## 北極星指標
（待補：唯一最能代表價值傳遞的指標）

## 成功條件
${goal || "（待補 — 一句話說清楚什麼算成功）"}

## 範圍
（待補：做什麼、明確不做什麼）
`);
  writeFileSync(join(dir, "roadmap.md"),
`# 路線圖

版本里程碑格式：\`- [milestone:YYYY-MM-DD] v1.0 — 內容 — 驗收條件\`

- [milestone:${end || "2099-12-31"}] v1.0 上線 — ${goal || "目標達成"}
`);
  writeFileSync(join(dir, "backlog.md"),
`# 需求池

格式：\`- [ ] P1 需求描述｜來源:VOC/老闆/數據\`（P0 當前必做 / P1 該版本 / P2 有空再說）

（尚無需求）
`);
  writeFileSync(join(dir, "metrics.md"),
`# 指標

KPI 格式：\`- 指標名：定義｜現況：數字｜目標：數字｜覆盤 [due:YYYY-MM-DD]\`

（尚無指標）
`);
  writeFileSync(join(dir, "README.md"),
`# ${emoji} ${name} 檔案櫃

${goal || "產品檔案櫃"} — 專屬 agent：pm.${id}

## 約定
- 定位/燈號/階段 product.md（\`> status:\` 🟢🟡🔴、\`> stage:\` 🌱🏗️🚀📈🔧）
- 版本里程碑 \`- [milestone:YYYY-MM-DD]\`（roadmap.md）
- 需求 checkbox：\`- [ ]\` / \`- [x]\`（backlog.md）
- 覆盤/追蹤截止 \`[due:YYYY-MM-DD]\`（metrics.md / backlog.md）
- 按需開檔：feedback.md（VOC）、prd.md（開發中版本）、risks.md（風險登記）
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
    if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {  // 中文名 → prod-N 序號（max+1 防撞）
      let n = 1;
      for (const c of list) { const m = /^prod-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
      id = `prod-${n}`;
    }
    if (id === "_global" || id === "chief" || id === "reports") return json(400, { error: `保留字不可用：${id}` });
    if (list.some(c => c.id === id)) return json(400, { error: `產品 ${id} 已存在` });
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
    if (!proj) return json(404, { error: `產品 ${body.id} 不存在` });
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

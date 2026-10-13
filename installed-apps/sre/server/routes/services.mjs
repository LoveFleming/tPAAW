/**
 * services — 服務註冊表 + 動態開服務（scaffold 模板檔組 + crew agent）+ 改狀態/停用
 *   GET    /api/sre/services
 *   POST   /api/sre/services   {name, emoji, goal, owner, tier?, id?}
 *   PATCH  /api/sre/services   {id, name?, emoji?, status?, tier?, agentId?, enabled?}
 * 開服務 = 5 模板檔（overview/slo/runbook/incidents/README）+ data/crews/sre.<id>.json — 完成即用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { readBody, PAAW_ROOT, TPAW_REPO_ROOT } from "./shared.mjs";

async function parseBody(req) {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

const REG = join(PAAW_ROOT, "services.json");

function load() {
  try { return JSON.parse(readFileSync(REG, "utf-8")); } catch { return []; }
}
function save(list) { writeFileSync(REG, JSON.stringify(list, null, 2)); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** 服務管家 crew（寫 data/crews/sre.<id>.json） */
export function scaffoldCrew({ id, name, emoji, goal, owner, tier }) {
  const agentId = `sre.${id}`;
  const rolePrompt = `# ${emoji} ${name} — 服務管家（SRE）

你是「${name}」這個服務的專屬 SRE 管家，這個服務檔案櫃的唯一記錄者。

## 服務
- 目標：${goal || "（見 overview.md，持續補全）"}
- Owner：${owner || "（待補）"}
- 等級：${tier || "（待補：P0/P1/P2 — 影響 SLO 嚴格度）"}

## 工作方式
1. 相關資訊一律落檔（scaffold 完成後用檔案櫃維護）— 檔案是事實的唯一來源
2. 回答前先讀檔，不憑記憶
3. Grafana 巡檢由「📈 Grafana 巡檢」面板跑（deterministic，零 LLM）；你負責解讀報告與追蹤改善
4. 事故發生時：先止血（runbook.md）→ 記時間線（incidents.md）→ 覆盤（postmortem）

## 落檔格式（雷達/燈號靠這些掃描）
- 服務燈號與等級：overview.md 的 \`> status: 🟢🟡🔴\`（🟢健康 🟡有風險 🔴異常）
- 覆盤/追蹤截止：\`- [due:YYYY-MM-DD] 描述\`（slo.md / incidents.md）
- 變更窗口/演練：\`- [milestone:YYYY-MM-DD] 內容 — 驗收條件\`（runbook.md）
- 待辦：\`- [ ] 描述｜來源:告警/巡檢/覆盤\` / \`- [x] 完成\`
- 風險：risks.md（若開）

## 鐵律
- 只能寫「${id}」櫃
- 機敏資料（token、IP、內部拓樸）不外傳、不上網
- 事故處理順序：止血 > 找因 > 記錄；不要在止血階段做根因分析
- 繁體中文`;
  const crew = {
    id: agentId, title: `${name} · 服務管家`, codename: name, imageUrl: "", skillIds: [],
    description: `${name} SRE 服務管家`,
    rolePrompt,
    expertise: `${name} 服務可靠性\nSLO 與錯誤預算\n事故處置與覆盤\n變更與容量`,
    guardrails: { redirectRules: `跨服務事務 → sre.chief SRE 總管\n可靠度總覽 → sre.chief`, refuseTopics: "機敏資料（token/內部拓撲）外傳" },
    chatConfig: {
      greeting: `嗨！我是${emoji} ${name} 的 SRE 管家。\n\n這個服務的概況、SLO、runbook、事故紀錄都在我這櫃。要看現況、記事故、跑演練，還是追 SLO？`,
      maxTokens: 8192, temperature: 0.4, engine: "paaw-agent",
    },
    toolGroups: ["core", "memory"],
  };
  const crewPath = join(TPAW_REPO_ROOT, "data", "crews", `${agentId}.json`);
  writeFileSync(crewPath, JSON.stringify(crew, null, 2));
  return { agentId, crewPath };
}

/** 服務模板檔組 */
export function scaffoldTemplates({ id, name, emoji, goal, owner, tier }) {
  const dir = join(PAAW_ROOT, "dossiers", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "overview.md"),
`# ${emoji} ${name} — 服務概況

> status: 🟢
> tier: ${tier || "P1"}
> owner: ${owner || "（待補）"}
> oncall: （待補）

## 一句話
（待補：這個服務給誰用、提供什麼能力）

## 架構
（待補：元件、依賴、資料流）

## 關鍵指標
（待補：QPS、延遲、錯誤率、資源水位）

## 成功條件
${goal || "（待補 — 什麼算健康）"}
`);
  writeFileSync(join(dir, "slo.md"),
`# SLO / 錯誤預算

格式：\`- SLI 名：目標｜現況：數字｜錯誤預算｜覆盤 [due:YYYY-MM-DD]\`

（尚無 SLO — 先定義 1~3 個最關鍵的）
`);
  writeFileSync(join(dir, "runbook.md"),
`# Runbook / SOP

格式：\`- [milestone:YYYY-MM-DD] 演練內容 — 驗收條件\`

## 常見情境
（待補：症狀 → 檢查步驟 → 處置 → 回復）

## 例行作業
（待補）
`);
  writeFileSync(join(dir, "incidents.md"),
`# 事故紀錄

格式：\`## YYYY-MM-DD HH:mm 標題\` → 影響 / 時間線 / 處置 / 根因 / action items（\`- [ ] ...\` / \`- [due:...]\`）

（尚無事故 🎉）
`);
  writeFileSync(join(dir, "README.md"),
`# ${emoji} ${name} 服務檔案櫃

${goal || "服務檔案櫃"} — 專屬 agent：sre.${id}

## 約定
- 概況/燈號/等級 overview.md（\`> status:\` 🟢🟡🔴、\`> tier:\`）
- SLO/錯誤預算 slo.md（\`[due:YYYY-MM-DD]\` 覆盤）
- 手冊/演練 runbook.md（\`[milestone:YYYY-MM-DD]\`）
- 事故 incidents.md（postmortem 連結）
- 按需開檔：risks.md（風險）、changes.md（變更紀錄）
`);
  return dir;
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/sre/services")) return false;
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  if (req.method === "GET") return json(200, { services: load() });

  if (req.method === "POST") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(400, { error: "name 必填" });
    const list = load();
    let id = slug(String(body.id || ""));
    if (!id) id = slug(name);
    if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
      let n = 1;
      for (const c of list) { const m = /^svc-(\d+)$/.exec(c.id); if (m) n = Math.max(n, Number(m[1]) + 1); }
      id = `svc-${n}`;
    }
    if (id === "_global" || id === "chief" || id === "reports") return json(400, { error: `保留字不可用：${id}` });
    if (list.some(c => c.id === id)) return json(400, { error: `服務 ${id} 已存在` });
    if (existsSync(join(PAAW_ROOT, "dossiers", id))) return json(400, { error: `dossiers/${id} 目錄已存在` });
    const emoji = String(body.emoji || "🧩").slice(0, 4);
    const goal = String(body.goal || "").slice(0, 300);
    const owner = String(body.owner || "").slice(0, 60);
    const tier = /^(P0|P1|P2)$/.test(String(body.tier || "")) ? body.tier : "";
    const { agentId } = scaffoldCrew({ id, name, emoji, goal, owner, tier });
    scaffoldTemplates({ id, name, emoji, goal, owner, tier });
    const svc = { id, name, emoji, agentId, goal, owner, tier: tier || "P1", status: "🟢", builtin: false, enabled: true, createdAt: new Date().toISOString() };
    list.push(svc); save(list);
    return json(200, { ok: true, service: svc });
  }

  if (req.method === "PATCH") {
    const body = await parseBody(req);
    const list = load();
    const svc = list.find(c => c.id === body.id);
    if (!svc) return json(404, { error: `服務 ${body.id} 不存在` });
    if (body.name) svc.name = String(body.name).slice(0, 60);
    if (body.emoji) svc.emoji = String(body.emoji).slice(0, 4);
    if (body.status) svc.status = String(body.status).slice(0, 4);
    if (body.tier && /^(P0|P1|P2)$/.test(String(body.tier))) svc.tier = body.tier;
    if (body.agentId) svc.agentId = String(body.agentId);
    if (typeof body.enabled === "boolean") svc.enabled = body.enabled;
    save(list);
    return json(200, { ok: true, service: svc });
  }

  return json(405, { error: "method not allowed" });
}

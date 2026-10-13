/**
 * briefing — 晨間簡報 + 覆核雷達 + 服務總覽（deterministic，零 LLM：事實靠程式掃描）
 *   GET /api/sre/briefing?days=7        → markdown 簡報（燈號總覽/告警/逾期/待辦）
 *   GET /api/sre/briefing?part=todos    → 待辦單段
 *   GET /api/sre/briefing?part=board    → 服務總覽（燈號+等級+統計+下個里程碑+最近巡檢）
 *   GET /api/sre/radar                  → 覆核雷達（[due:]/[milestone:]/[expires:] 升序+分級）
 * 掃描規則（與服務管家落檔約定對齊）：
 *   - checkbox：`- [ ] 未完成`
 *   - 覆盤/追蹤截止：`[due:YYYY-MM-DD]`
 *   - 里程碑/演練：`[milestone:YYYY-MM-DD]`
 *   - 效期：`[expires:YYYY-MM-DD]` + config/expirations.json items
 *   - 燈號/等級/階段：overview.md 的 `> status: 🟢🟡🔴` + `> tier:` + `> stage:`
 *   - 最近巡檢：dossiers/_global/grafana-*.md 的 `> status:`
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { PAAW_ROOT } from "./shared.mjs";
import { BUILTIN_FUNCTIONS } from "./crews.mjs";

const MARKER_RE = /\[(due|milestone|expires):(2\d{3}-\d{2}-\d{2})\]\s*(.+)/g;
const TODO_RE = /^[-*]\s+\[( |x|X)\]\s+(.+)$/gm;
const STATUS_RE = /^>\s*status:.*?(🟢|🟡|🔴)/m;
const TIER_RE = /^>\s*tier:\s*(P[0-2])/m;
const STAGE_RE = /^>\s*stage:.*?(🌱|🏗️|🚀|📈|🔧)/m;

/** 職能櫃（kind:function）不進服務總覽 board */
const FUNCTION_DIRS = new Set(BUILTIN_FUNCTIONS.map(f => f.id));

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diffDays(iso) {
  return Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
}
function stripFences(md) { return md.replace(/```[\s\S]*?```/g, ""); }
function readMd(dir, f) { try { return stripFences(readFileSync(join(dir, f), "utf-8")); } catch { return ""; } }
function countItems(md) {
  return md.split("\n").filter(l => /^\s*[-*]\s+\S/.test(l) && !/格式[：:]/.test(l) && !/^\s*[-*]\s*（尚無/.test(l)).length;
}

/** 最近一次 Grafana 巡檢狀態 */
function lastInspect() {
  try {
    const dir = join(PAAW_ROOT, "dossiers", "_global");
    const f = readdirSync(dir).filter(x => /^grafana-.*\.md$/.test(x)).sort().reverse()[0];
    if (!f) return null;
    const md = readFileSync(join(dir, f), "utf-8");
    const m = STATUS_RE.exec(md);
    return { file: f, status: m ? m[1] : "⚪" };
  } catch { return null; }
}

function scanAll() {
  const todos = []; const markers = []; const board = [];
  const dRoot = join(PAAW_ROOT, "dossiers");
  let dirs = [];
  try { dirs = readdirSync(dRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name); } catch {}
  for (const svc of dirs) {
    const dir = join(dRoot, svc);
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith(".md")); } catch { continue; }
    let risks = 0, openTodos = 0, nextMilestone = null, status = "⚪", tier = "", stage = "";
    for (const f of files) {
      const md = readMd(dir, f);
      let m;
      TODO_RE.lastIndex = 0;
      while ((m = TODO_RE.exec(md))) {
        if (m[1] === " ") { todos.push({ service: svc, file: f, text: m[2].trim() }); if (f === "incidents.md" || f === "slo.md") openTodos++; }
      }
      MARKER_RE.lastIndex = 0;
      while ((m = MARKER_RE.exec(md))) {
        markers.push({ type: m[1], date: m[2], text: m[3].split("—")[0].split("｜")[0].trim(), source: `${svc}/${f}` });
        if (m[1] === "milestone" && diffDays(m[2]) >= 0 && (!nextMilestone || m[2] < nextMilestone)) nextMilestone = m[2];
      }
      if (f === "risks.md") risks = countItems(md);
      if (f === "overview.md") {
        const sm = STATUS_RE.exec(md); if (sm) status = sm[1];
        const tm = TIER_RE.exec(md); if (tm) tier = tm[1];
        const gm = STAGE_RE.exec(md); if (gm) stage = gm[1];
      }
    }
    if (svc !== "_global" && !FUNCTION_DIRS.has(svc)) board.push({ id: svc, status, tier, stage, risks, openTodos, nextMilestone, files: files.length });
  }
  try {
    const cfg = JSON.parse(readFileSync(join(PAAW_ROOT, "config", "expirations.json"), "utf-8"));
    for (const it of cfg.items || []) markers.push({ type: "expires", date: it.date, text: it.text, source: "config" });
  } catch {}
  return { todos, markers, board };
}

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/sre/briefing") && !p.startsWith("/api/sre/radar")) return Promise.resolve(false);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  let names = {};
  try {
    for (const c of JSON.parse(readFileSync(join(PAAW_ROOT, "services.json"), "utf-8"))) names[c.id] = `${c.emoji || "🧩"} ${c.name}`;
  } catch {}
  names["_global"] = "📊 全域巡檢報告";
  const { todos, markers, board } = scanAll();
  const insp = lastInspect();

  if (p.startsWith("/api/sre/radar")) {
    const TYPE_LABEL = { due: "覆核", milestone: "演練", expires: "效期" };
    const items = markers.map(mk => ({ ...mk, label: TYPE_LABEL[mk.type] || mk.type, inDays: diffDays(mk.date), status: diffDays(mk.date) < 0 ? "逾期" : diffDays(mk.date) <= 7 ? "7天內" : diffDays(mk.date) <= 30 ? "30天內" : "正常" }))
      .filter(mk => mk.inDays <= 30)
      .sort((a, b) => a.date.localeCompare(b.date));
    return Promise.resolve(json(200, { items }));
  }

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const part = url.searchParams.get("part");

  if (part === "todos") {
    const tl = [`## ✅ 未完成待辦（${todos.length}）`];
    if (!todos.length) tl.push("- （無 — 全部清空 🎉）");
    for (const t of todos) tl.push(`- [ ] ${t.text} _(${t.service}/${t.file})_`);
    return Promise.resolve(json(200, { markdown: tl.join("\n"), stats: { todos: todos.length } }));
  }

  if (part === "board") {
    return Promise.resolve(json(200, { board: board.map(b => ({ ...b, name: names[b.id] || b.id })), today: today(), lastInspect: insp }));
  }

  const mileSoon = markers.filter(mk => mk.type === "milestone" && diffDays(mk.date) <= days).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15);
  const overdue = markers.filter(mk => mk.type !== "milestone" && diffDays(mk.date) < 0).sort((a, b) => a.date.localeCompare(b.date));
  const expSoon = markers.filter(mk => mk.type === "expires" && diffDays(mk.date) >= 0 && diffDays(mk.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));

  const lines = [];
  lines.push(`# 🌅 SRE 室晨間簡報 — ${today()}`);
  lines.push("");
  lines.push(insp ? `## 📈 最近 Grafana 巡檢：${insp.status}（${insp.file}）` : `## 📈 最近 Grafana 巡檢：（尚無報告 — 到「📈 Grafana 巡檢」跑一次）`);
  lines.push("");
  lines.push(`## 🛡️ 服務狀態（${board.length}）`);
  if (!board.length) lines.push("- （尚無服務 — 左下「新增服務」開一個）");
  for (const b of board) lines.push(`- ${b.status} ${names[b.id] || b.id}${b.tier ? ` [${b.tier}]` : ""}：風險 ${b.risks}｜未結追蹤 ${b.openTodos}｜檔案 ${b.files}｜下個里程碑 ${b.nextMilestone || "—"}`);
  lines.push("");
  lines.push(`## 🗺️ 未來 ${days} 天里程碑/演練（${mileSoon.length}）`);
  if (!mileSoon.length) lines.push("- （無）");
  for (const mk of mileSoon) lines.push(`- ${mk.date}（${diffDays(mk.date)} 天後）${mk.text} _(${mk.source})_`);
  lines.push("");
  lines.push(`## 🚨 已逾期覆核/追蹤（${overdue.length}）`);
  if (!overdue.length) lines.push("- （無 — 零逾期 💪）");
  for (const mk of overdue) lines.push(`- ${mk.label}｜${mk.date}｜${mk.text} _(${mk.source})_`);
  lines.push("");
  lines.push(`## ✅ 未完成待辦（${todos.length}）`);
  if (!todos.length) lines.push("- （無 — 全部清空 🎉）");
  for (const t of todos.slice(0, 30)) lines.push(`- [ ] ${t.text} _(${t.service}/${t.file})_`);
  lines.push("");
  lines.push(`## 🔔 效期警報（30 天內，共 ${expSoon.length}）`);
  if (!expSoon.length) lines.push("- （無 — 效期雷達乾淨）");
  for (const mk of expSoon) lines.push(`- ${diffDays(mk.date) <= 7 ? "⚠️ 7天內" : "⏳ 30天內"} ${mk.date} ${mk.text} _(${mk.source})_`);

  return Promise.resolve(json(200, {
    markdown: lines.join("\n"),
    stats: { services: board.length, todos: todos.length, milestones: mileSoon.length, overdue: overdue.length, expirations: expSoon.length },
    today: today(), lastInspect: insp,
  }));
}

export default handler;

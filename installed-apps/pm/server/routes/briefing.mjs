/**
 * briefing — 晨間簡報 + 截止雷達 + 產品總覽（deterministic，零 LLM：事實靠程式掃描）
 *   GET /api/pm/briefing?days=7        → markdown 簡報（燈號總覽/版本里程碑/逾期/待辦）
 *   GET /api/pm/briefing?part=todos    → 待辦單段
 *   GET /api/pm/briefing?part=board    → 產品總覽（燈號+階段+統計+下個版本）
 *   GET /api/pm/radar                  → 截止雷達（[due:]/[milestone:]/[expires:] 升序+分級）
 * 掃描規則（與產品管家落檔約定對齊）：
 *   - checkbox：`- [ ] 未完成`
 *   - 覆盤/追蹤截止：`[due:YYYY-MM-DD]`（metrics/backlog）
 *   - 版本里程碑：`[milestone:YYYY-MM-DD]`（roadmap.md）
 *   - 效期：`[expires:YYYY-MM-DD]` + config/expirations.json items
 *   - 燈號/階段：product.md 的 `> status: 🟢🟡🔴` + `> stage: 🌱🏗️🚀📈🔧`
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { PAAW_ROOT } from "./shared.mjs";

const MARKER_RE = /\[(due|milestone|expires):(2\d{3}-\d{2}-\d{2})\]\s*(.+)/g;
const TODO_RE = /^[-*]\s+\[( |x|X)\]\s+(.+)$/gm;
const STATUS_RE = /^>\s*status:.*?(🟢|🟡|🔴)/m;
const STAGE_RE = /^>\s*stage:.*?(🌱|🏗️|🚀|📈|🔧)/m;
/** 職能櫃（kind:function）不進產品總覽 board — 只在樹/專家區出現 */
const FUNCTION_DIRS = new Set(["strategy", "research", "requirements", "data", "launch", "alignment"]);

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diffDays(iso) {
  return Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
}

/** 掃描用本文：剝掉 code fence 區塊（README/模板範例行不當真） */
function stripFences(md) {
  return md.replace(/```[\s\S]*?```/g, "");
}

function readMd(dir, f) {
  try { return stripFences(readFileSync(join(dir, f), "utf-8")); } catch { return ""; }
}

/** 統計列數：非空、非標題、非「格式：」說明行、非「（尚無…）」 */
function countItems(md) {
  return md.split("\n").filter(l => /^\s*[-*]\s+\S/.test(l) && !/格式[：:]/.test(l) && !/^\s*[-*]\s*（尚無/.test(l)).length;
}

function scanAll() {
  const todos = []; const markers = []; const board = [];
  const dRoot = join(PAAW_ROOT, "dossiers");
  let dirs = [];
  try { dirs = readdirSync(dRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith(".")).map(d => d.name); } catch { /* 無櫃 */ }
  for (const proj of dirs) {
    const dir = join(dRoot, proj);
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith(".md")); } catch { continue; }
    let risks = 0, openBacklog = 0, nextMilestone = null, status = "⚪", stage = "";
    for (const f of files) {
      const md = readMd(dir, f);
      let m;
      TODO_RE.lastIndex = 0;
      while ((m = TODO_RE.exec(md))) {
        if (m[1] === " ") {
          todos.push({ project: proj, file: f, text: m[2].trim() });
          if (f === "backlog.md") openBacklog++;
        }
      }
      MARKER_RE.lastIndex = 0;
      while ((m = MARKER_RE.exec(md))) {
        markers.push({ type: m[1], date: m[2], text: m[3].split("—")[0].split("｜")[0].trim(), source: `${proj}/${f}` });
        if (m[1] === "milestone" && diffDays(m[2]) >= 0 && (!nextMilestone || m[2] < nextMilestone)) nextMilestone = m[2];
      }
      if (f === "risks.md") risks = countItems(md);
      if (f === "product.md") {
        const sm = STATUS_RE.exec(md); if (sm) status = sm[1];
        const gm = STAGE_RE.exec(md); if (gm) stage = gm[1];
      }
    }
    if (proj !== "_global" && !FUNCTION_DIRS.has(proj)) board.push({ id: proj, status, stage, risks, openBacklog, nextMilestone, files: files.length });
  }
  // config/expirations.json 補充項
  try {
    const cfg = JSON.parse(readFileSync(join(PAAW_ROOT, "config", "expirations.json"), "utf-8"));
    for (const it of cfg.items || []) markers.push({ type: "expires", date: it.date, text: it.text, source: "config" });
  } catch { /* 無設定 */ }
  return { todos, markers, board };
}

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/pm/briefing") && !p.startsWith("/api/pm/radar")) return Promise.resolve(false);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };

  // 產品名對照（board 顯示名稱用）
  let names = {};
  try {
    for (const c of JSON.parse(readFileSync(join(PAAW_ROOT, "projects.json"), "utf-8"))) names[c.id] = `${c.emoji || "🗂️"} ${c.name}`;
  } catch { /* 無註冊表 */ }
  names["_global"] = "📊 全域報表";
  const { todos, markers, board } = scanAll();

  // 截止雷達
  if (p.startsWith("/api/pm/radar")) {
    const TYPE_LABEL = { due: "覆盤", milestone: "版本", expires: "效期" };
    const items = markers.map(mk => ({ ...mk, label: TYPE_LABEL[mk.type] || mk.type, inDays: diffDays(mk.date), status: diffDays(mk.date) < 0 ? "逾期" : diffDays(mk.date) <= 7 ? "7天內" : diffDays(mk.date) <= 30 ? "30天內" : "正常" }))
      .filter(mk => mk.inDays <= 30)
      .sort((a, b) => a.date.localeCompare(b.date));
    return Promise.resolve(json(200, { items }));
  }

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const part = url.searchParams.get("part"); // todos|board（單段模式）

  if (part === "todos") {
    const tl = [`## ✅ 未完成待辦（${todos.length}）`];
    if (!todos.length) tl.push("- （無 — 全部清空 🎉）");
    for (const t of todos) tl.push(`- [ ] ${t.text} _(${t.project}/${t.file})_`);
    return Promise.resolve(json(200, { markdown: tl.join("\n"), stats: { todos: todos.length } }));
  }

  if (part === "board") {
    return Promise.resolve(json(200, { board: board.map(b => ({ ...b, name: names[b.id] || b.id })), today: today() }));
  }

  const mileSoon = markers.filter(mk => mk.type === "milestone" && diffDays(mk.date) <= days).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15);
  const overdue = markers.filter(mk => mk.type !== "milestone" && diffDays(mk.date) < 0).sort((a, b) => a.date.localeCompare(b.date));
  const expSoon = markers.filter(mk => mk.type === "expires" && diffDays(mk.date) >= 0 && diffDays(mk.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));

  const lines = [];
  lines.push(`# 🌅 產品經理室晨間簡報 — ${today()}`);
  lines.push("");
  lines.push(`## 🎯 產品狀態（${board.length}）`);
  if (!board.length) lines.push("- （尚無產品 — 左下「新增產品」開一個）");
  for (const b of board) lines.push(`- ${b.status} ${names[b.id] || b.id}${b.stage ? ` ${b.stage}` : ""}：風險 ${b.risks}｜未結需求 ${b.openBacklog}｜檔案 ${b.files}｜下個版本 ${b.nextMilestone || "—"}`);
  lines.push("");
  lines.push(`## 🗺️ 未來 ${days} 天版本里程碑（${mileSoon.length}）`);
  if (!mileSoon.length) lines.push("- （無）");
  for (const mk of mileSoon) lines.push(`- ${mk.date}（${diffDays(mk.date)} 天後）${mk.text} _(${mk.source})_`);
  lines.push("");
  lines.push(`## 🚨 已逾期覆盤/追蹤（${overdue.length}）`);
  if (!overdue.length) lines.push("- （無 — 零逾期 💪）");
  for (const mk of overdue) lines.push(`- ${mk.label}｜${mk.date}｜${mk.text} _(${mk.source})_`);
  lines.push("");
  lines.push(`## ✅ 未完成待辦（${todos.length}）`);
  if (!todos.length) lines.push("- （無 — 全部清空 🎉）");
  for (const t of todos.slice(0, 30)) lines.push(`- [ ] ${t.text} _(${t.project}/${t.file})_`);
  lines.push("");
  lines.push(`## 🔔 效期警報（30 天內，共 ${expSoon.length}）`);
  if (!expSoon.length) lines.push("- （無 — 效期雷達乾淨）");
  for (const mk of expSoon) lines.push(`- ${diffDays(mk.date) <= 7 ? "⚠️ 7天內" : "⏳ 30天內"} ${mk.date} ${mk.text} _(${mk.source})_`);

  return Promise.resolve(json(200, {
    markdown: lines.join("\n"),
    stats: { products: board.length, todos: todos.length, milestones: mileSoon.length, overdue: overdue.length, expirations: expSoon.length },
    today: today(),
  }));
}

export default handler;

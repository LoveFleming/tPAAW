/**
 * briefing — 晨間簡報 + 效期雷達（deterministic，零 LLM：事實靠程式掃描）
 *   GET /api/secret/briefing?days=7 → markdown 簡報（待辦/近期行程/效期）
 *   GET /api/secret/expirations    → 效期清單（升序，含逾期/30天內標記）
 * 掃描規則（與專家落檔約定對齊）：
 *   - checkbox：`- [ ] 未完成`（meetings/schedule/admin/動態分類的 md）
 *   - 行程日期：schedule 櫃 md 內 YYYY-MM-DD 開頭行
 *   - 效期：全櫃 md 內 `[expires:YYYY-MM-DD]` + config/expirations.json items
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { PAAW_ROOT } from "./shared.mjs";

const EXPIRES_RE = /\[expires:(\d{4}-\d{2}-\d{2})\]\s*(.+)/g;
const TODO_RE = /^[-*]\s+\[( |x|X)\]\s+(.+)$/gm;
const DATE_LINE_RE = /^[-*|\s]*(\d{4}-\d{2}-\d{2})[^\n]*$/gm;

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function diffDays(iso) {
  return Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
}

/** 掃描用本文：剝掉 code fence 區塊（README 範例不當真） */
function stripFences(md) {
  return md.replace(/```[\s\S]*?```/g, "");
}

function scanAll() {
  const todos = []; const expirations = []; const events = [];
  const dRoot = join(PAAW_ROOT, "dossiers");
  let cats = [];
  try { cats = readdirSync(dRoot).filter(d => !d.startsWith(".")); } catch { /* 無櫃 */ }
  for (const cat of cats) {
    let files = [];
    try { files = readdirSync(join(dRoot, cat)).filter(f => f.endsWith(".md")); } catch { continue; }
    for (const f of files) {
      let md = "";
      try { md = readFileSync(join(dRoot, cat, f), "utf-8"); } catch { continue; }
      md = stripFences(md);
      let m;
      TODO_RE.lastIndex = 0;
      while ((m = TODO_RE.exec(md))) if (m[1] === " ") todos.push({ category: cat, file: f, text: m[2].trim() });
      EXPIRES_RE.lastIndex = 0;
      while ((m = EXPIRES_RE.exec(md))) expirations.push({ date: m[1], text: m[2].split("—")[0].trim(), source: `${cat}/${f}` });
      if (cat === "schedule") {
        DATE_LINE_RE.lastIndex = 0;
        while ((m = DATE_LINE_RE.exec(md))) if (diffDays(m[1]) >= 0) events.push({ date: m[1], text: m[0].replace(/^[^\d]*(\d{4}-\d{2}-\d{2})/, "").trim().slice(0, 80) });
      }
    }
  }
  // config/expirations.json 補充項
  try {
    const cfg = JSON.parse(readFileSync(join(PAAW_ROOT, "config", "expirations.json"), "utf-8"));
    for (const it of cfg.items || []) expirations.push({ date: it.date, text: it.text, source: "config" });
  } catch { /* 無設定 */ }
  return { todos, expirations, events };
}

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (!p.startsWith("/api/secret/briefing") && !p.startsWith("/api/secret/expirations")) return Promise.resolve(false);
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); return true; };
  const { todos, expirations, events } = scanAll();

  if (p.startsWith("/api/secret/expirations")) {
    const items = expirations.map(e => ({ ...e, inDays: diffDays(e.date), status: diffDays(e.date) < 0 ? "逾期" : diffDays(e.date) <= 30 ? "30天內" : "正常" }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return Promise.resolve(json(200, { items }));
  }

  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const soon = events.filter(e => diffDays(e.date) <= days).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20);
  const expSoon = expirations.map(e => ({ ...e, inDays: diffDays(e.date) })).filter(e => e.inDays <= 30).sort((a, b) => a.inDays - b.inDays);

  const part = url.searchParams.get("part"); // todos|events|expirations（單段模式）

  const lines = [];
  lines.push(`# 🌅 秘書晨間簡報 — ${today()}`);
  lines.push("");
  lines.push(`## ✅ 未完成待辦（${todos.length}）`);
  if (!todos.length) lines.push("- （無 — 全部清空 🎉）");
  for (const t of todos.slice(0, 30)) lines.push(`- [ ] ${t.text} _(${t.category}/${t.file})_`);
  lines.push("");
  lines.push(`## 📅 未來 ${days} 天行程（${soon.length}）`);
  if (!soon.length) lines.push("- （無）");
  for (const e of soon) lines.push(`- ${e.date} ${e.text}`);
  lines.push("");
  lines.push(`## 🔔 效期警報（30 天內，共 ${expSoon.length}）`);
  if (!expSoon.length) lines.push("- （無 — 效期雷達乾淨）");
  for (const e of expSoon) lines.push(`- ${e.inDays < 0 ? "🚨 已逾期" : e.inDays <= 7 ? "⚠️ 7天內" : "⏳ 30天內"} ${e.date} ${e.text} _(${e.source})_`);

  if (part === "todos") {
    const tl = [`## ✅ 未完成待辦（${todos.length}）`];
    if (!todos.length) tl.push("- （無 — 全部清空 🎉）");
    for (const t of todos) tl.push(`- [ ] ${t.text} _(${t.category}/${t.file})_`);
    return Promise.resolve(json(200, { markdown: tl.join("\n"), stats: { todos: todos.length } }));
  }
  return Promise.resolve(json(200, { markdown: lines.join("\n"), stats: { todos: todos.length, events: soon.length, expirations: expSoon.length }, today: today() }));
}

export default handler;

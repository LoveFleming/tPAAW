/**
 * coding-trouble — 🧯 TS Guide（Troubleshooting Guide）結構化條目庫
 *
 * 2026-10-10 Fleming 拍板（MVP 1+2）：
 * 人工時代 TS guide 會腐敗（寫時靠猜/修時沒人回填/會的人走了）→
 * 改成 view：deterministic 聚合（git fix commits + bug tasks + error codes + agent log errors）
 * → 按按鈕才觸發 AI 挖掘（症狀→原因→修法→證據）→ 人確認 + 人注記永久保留。
 * 未來接客服 AI：條目帶 evidence，答不到 = gap 條目 → 反饋迴路。
 *
 * Routes:
 *   GET    /api/coding-trouble/guide?path=          — 讀 TSGUIDE + remarks（零 LLM）
 *   POST   /api/coding-trouble/guide?path=          — 生成/重生成（LLM — 按鈕觸發，絕不自動）
 *   PUT    /api/coding-trouble/confirm?path=        — 人確認 entry（body: {id}）
 *   PUT    /api/coding-trouble/remark?path=         — 人員注記（獨立檔 — 重生成永不覆蓋）
 *   DELETE /api/coding-trouble/remark?path=&id=     — 刪注記
 *
 * 鐵律（同 handover brief 模式）：
 * - evidence 必須真實存在於 FACTS（commit hash / task id / log 樣本）— No answer without evidence
 * - confirmed entries 是人確認過的資產 — 重新生成原封保留
 * - 挖不到的主題誠實標 gap（不編造）
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { callProjectLLM } from "./coding-helpers.mjs"; // 2026-11-08 修：coding.mjs 已改 import 不再 re-export，6 模組載入失敗
import { stableStringify } from "../lib/stable-stringify.mjs";


const execAsync = promisify(execCb);

// ── 檔案位置 ──
const guideFilePath = (p) => join(p, ".paaw", "troubleshooting", "TSGUIDE.json"); // nosemgrep: path-join-resolve-traversal — local-first：使用者自選專案根
const remarksFilePath = (p) => join(p, ".paaw", "troubleshooting", "trouble-remarks.json"); // nosemgrep: path-join-resolve-traversal — 同上

async function loadGuide(p) {
  try { return JSON.parse(await readFile(guideFilePath(p), "utf-8")); } catch { return null; }
}
async function loadRemarks(p) {
  try { const r = JSON.parse(await readFile(remarksFilePath(p), "utf-8")); return Array.isArray(r) ? r : []; } catch { return []; }
}
async function saveJson(abs, obj) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(abs, ".."), { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first
  await writeFile(abs, stableStringify(obj) + "\n", "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first
}

// ═══ Deterministic facts（零 token — 修復知識的原始素材都在這）═══
export async function collectTroubleFacts(projectPath) {
  const facts = { fixCommits: [], bugTasks: [], errorCodes: [], agentLogErrors: [], project: null };

  // 0. project meta — 讓 AI 知道這是什麼專案（條目才寫得具體）
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8"));
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, 25);
    facts.project = { name: pkg.name || "(unnamed)", scripts: Object.keys(pkg.scripts || {}).slice(0, 12), deps };
  } catch { /* 無 package.json */ }

  // 1. git fix commits — 每個 fix commit 就是一條「症狀→修法」的原始素材
  try {
    const { stdout } = await execAsync(
      `git log -i --grep="fix" --grep="修" --grep="bug" --grep="hotfix" --format="%h|%ad|%s" --date=short --no-color -120`,
      { cwd: projectPath, timeout: 10000 },
    );
    facts.fixCommits = stdout.trim().split("\n").filter(Boolean).slice(0, 120);
  } catch { /* 非 git repo */ }

  // 2. bug tasks — task pipeline 的修 bug task（帶狀態與描述）
  try {
    const raw = JSON.parse(await readFile(join(projectPath, ".paaw", "tasks", "TASKS.json"), "utf-8"));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
    facts.bugTasks = tasks
      .filter(t => /bug|fix|修|錯誤|error|crash|壞/i.test(`${t.title || ""}|${t.type || ""}|${(t.labels || []).join(",")}`))
      .slice(0, 40)
      .map(t => ({ id: t.id, title: String(t.title || "").slice(0, 120), status: t.status || "?", desc: String(t.description || "").slice(0, 200) }));
  } catch { /* 無 tasks */ }

  // 3. error codes catalog（有就讀 — error-code-rules 是另一 feature 的產物）
  try {
    facts.errorCodes = JSON.parse(await readFile(join(projectPath, ".paaw", "quality", "error-codes.json"), "utf-8"));
  } catch { /* 無 catalog */ }

  // 4. agent log errors — 真實執行錯誤（最近、cap 40 行）
  try {
    const logsDir = join(projectPath, "log", "logs", "agent");
    if (existsSync(logsDir)) {
      const { readdirSync, readFileSync: rdSync } = await import("node:fs");
      const files = readdirSync(logsDir).filter(f => f.endsWith(".jsonl")).sort().reverse().slice(0, 3);
      const errLines = [];
      for (const f of files) {
        const content = rdSync(join(logsDir, f), "utf-8").split("\n");
        for (let i = content.length - 1; i >= 0 && errLines.length < 40; i--) {
          const l = content[i];
          if (!l) continue;
          if (/"error"|Error:|failed|"fail"/i.test(l)) errLines.push(l.slice(0, 300));
        }
      }
      facts.agentLogErrors = errLines;
    }
  } catch { /* 無 log */ }

  return facts;
}

// ═══ AI 挖掘 — 症狀→原因→修法→證據（1 次 LLM，按鈕觸發）═══
async function mineEntries(facts) {
  const prompt = `You are the SRE lead of this release unit. You are writing a troubleshooting runbook for two readers:
(1) the next developer who takes over, and (2) the support AI that will answer end-user questions about this project.
Be concrete, evidence-bound, and honest. NEVER invent facts.

PROJECT META: ${facts.project ? JSON.stringify(facts.project) : "(none)"}

FACTS (the ONLY source of truth — every statement must trace back to these):
- git fix commits (hash|date|subject, newest first):
${facts.fixCommits.slice(0, 120).join("\n") || "(none)"}
- bug tasks (id|status|title):
${facts.bugTasks.map(t => `[${t.status}] ${t.id || "-"} | ${t.title}${t.desc ? " | " + t.desc : ""}`).join("\n") || "(none)"}
- error codes catalog: ${facts.errorCodes.length ? JSON.stringify(facts.errorCodes).slice(0, 800) : "(none)"}
- recent agent log error lines (truncated):
${facts.agentLogErrors.slice(0, 40).join("\n") || "(none)"}

TASK: Produce a troubleshooting guide as STRICT JSON (no markdown fence).

Each entry = ONE recurring, user-visible problem. Fields:
1. symptom: what the end user / operator actually sees — quote literal error strings when the FACTS contain them; zh-TW, plain language (客服讀得懂).
2. cause: root cause in ONE sentence; if FACTS only suggest it, prefix 「推測：」.
3. fixSteps: 2–6 ordered, actionable steps. Each step = action + how to verify it worked. Include exact commands/paths when derivable from FACTS. End with a verification step; when relevant add a rollback step.
4. feature: related feature name, or null.
5. evidence: real refs from FACTS ONLY — "git:<hash>", "task:<id>", "log:<短摘錄>". An entry WITHOUT evidence must NOT be written (move it to gaps).

Rules:
- Max 15 entries, ordered by (recurrence × user impact), most damaging first.
- Merge multiple fix commits about the same problem into ONE entry (list all hashes).
- If a cause is inferred rather than directly evidenced, still include the entry but mark cause as 「推測：」.
- gaps: topics with hints but insufficient evidence — max 6 items, each states WHAT evidence is missing.
- Language: zh-TW (technical terms may remain English).
- Output ONLY the JSON object.`;

  const result = await callProjectLLM({
    messages: [
      { role: "system", content: "You are a precise reliability analyst. Output STRICT JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  }, { caller: "coding-trouble" });

  const m = (result?.content || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    return {
      entries: Array.isArray(d.entries) ? d.entries.slice(0, 15).map((x, i) => ({
        id: `t-${Date.now().toString(36)}-${i}`,
        symptom: String(x?.symptom || "").slice(0, 300),
        cause: String(x?.cause || "").slice(0, 400),
        fixSteps: Array.isArray(x?.fixSteps) ? x.fixSteps.slice(0, 10).map(s => String(s).slice(0, 240)) : [],
        feature: x?.feature ? String(x.feature).slice(0, 80) : null,
        evidence: Array.isArray(x?.evidence) ? x.evidence.slice(0, 6).map(e => ({
          type: String(e?.type || "?").slice(0, 10), ref: String(e?.ref || "").slice(0, 160),
        })).filter(e => e.ref) : [],
        status: "ai", // 2026-11-09 Fleming：draft 狀態拿掉 — AI 產的直接是成品
      })).filter(x => x.symptom) : [],
      gaps: Array.isArray(d.gaps) ? d.gaps.slice(0, 6).map(g => String(g).slice(0, 200)) : [],
    };
  } catch { return null; }
}

// ── helpers ──
function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}

// ── Route Handler ──
export default function codingTroubleRoutes(req, res) {
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const method = (req.method || "GET").toUpperCase();
  const q = new URL(rawUrl, "http://localhost").searchParams;
  const projectPath = q.get("path") ? resolve(q.get("path")) : null;

  // ⚠️ URL prefix 先行 — 不屬於本模組的請求立刻放行（path guard 不能提前：
  // 否則所有不帶 path 的請求都被本模組 400 吃掉，全 server 路由壞掉 — 2026-10-10 教訓）
  if (!url.startsWith("/api/coding-trouble/")) return false;

  const handle = async () => {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first

    // ── GET：讀 guide + remarks（零 LLM）──
    if (url === "/api/coding-trouble/guide" && method === "GET") {
      const [guide, remarks] = await Promise.all([loadGuide(projectPath), loadRemarks(projectPath)]);
      return res.json({ guide, remarks });
    }

    // ── POST：生成/重生成（LLM — 按鈕觸發）──
    if (url === "/api/coding-trouble/guide" && method === "POST") {
      const facts = await collectTroubleFacts(projectPath);
      const mined = await mineEntries(facts);
      const old = await loadGuide(projectPath);
      // merge 鐵律：confirmed/human 是人確認或人寫的資產原封保留；舊 AI 條目丟掉換新
      const confirmed = (old?.entries || []).filter(e => e.status === "confirmed" || e.status === "human");
      const guide = {
        version: 1,
        generatedAt: new Date().toISOString(),
        factsSummary: { fixCommits: facts.fixCommits.length, bugTasks: facts.bugTasks.length, agentLogErrors: facts.agentLogErrors.length },
        entries: mined ? [...confirmed, ...mined.entries] : confirmed,
        gaps: mined ? mined.gaps : (old?.gaps || []),
      };
      if (!mined && !old) {
        guide.aiError = "AI 挖掘失敗 — 可按重新生成重試";
      }
      await saveJson(guideFilePath(projectPath), guide);
      return res.json({ ok: true, guide, remarks: await loadRemarks(projectPath) });
    }

    // ── PUT confirm：人確認 entry ──
    if (url === "/api/coding-trouble/confirm" && method === "PUT") {
      let body = {};
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
      const id = String(body.id || "");
      const guide = await loadGuide(projectPath);
      if (!guide) return res.status(404).json({ error: "guide not generated" });
      const entry = (guide.entries || []).find(e => e.id === id);
      if (!entry) return res.status(404).json({ error: "entry not found" });
      entry.status = body.unconfirm ? "ai" : "confirmed";
      if (body.unconfirm) { delete entry.confirmedAt; delete entry.confirmedBy; }
      else { entry.confirmedAt = new Date().toISOString(); entry.confirmedBy = "user"; }
      await saveJson(guideFilePath(projectPath), guide);
      return res.json({ ok: true, guide });
    }

    // ── entry：手動新增/編輯條目（AI 漏寫 SOP 時人直接補 — 2026-10-10 Fleming 17:03）──
    if (url === "/api/coding-trouble/entry" && method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
      const symptom = String(body.symptom || "").trim().slice(0, 300);
      if (!symptom) return res.status(400).json({ error: "symptom required" });
      const guide = (await loadGuide(projectPath)) || { version: 1, generatedAt: null, entries: [], gaps: [] };
      const entry = {
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        symptom,
        cause: String(body.cause || "").slice(0, 400),
        fixSteps: Array.isArray(body.fixSteps) ? body.fixSteps.map(x => String(x).slice(0, 240)).filter(Boolean).slice(0, 10) : [],
        feature: body.feature ? String(body.feature).slice(0, 80) : null,
        evidence: Array.isArray(body.evidence) ? body.evidence.map(e => ({ type: String(e?.type || "human").slice(0, 10), ref: String(e?.ref || "").slice(0, 160) })).filter(e => e.ref).slice(0, 6)
          : (body.evidenceText ? [{ type: "human", ref: String(body.evidenceText).slice(0, 160) }] : []),
        status: "human", // 人工權威 — 重生成永不覆蓋（同 confirmed 地位）
        createdBy: "user", createdAt: new Date().toISOString(),
      };
      guide.entries.push(entry);
      await saveJson(guideFilePath(projectPath), guide);
      return res.json({ ok: true, guide });
    }
    if (url === "/api/coding-trouble/entry" && method === "PUT") {
      let body = {};
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
      const guide = await loadGuide(projectPath);
      if (!guide) return res.status(404).json({ error: "guide not generated" });
      const entry = (guide.entries || []).find(e => e.id === body.id);
      if (!entry) return res.status(404).json({ error: "entry not found" });
      if (body.symptom !== undefined) entry.symptom = String(body.symptom).trim().slice(0, 300);
      if (body.cause !== undefined) entry.cause = String(body.cause).slice(0, 400);
      if (Array.isArray(body.fixSteps)) entry.fixSteps = body.fixSteps.map(x => String(x).slice(0, 240)).filter(Boolean).slice(0, 10);
      if (body.feature !== undefined) entry.feature = body.feature ? String(body.feature).slice(0, 80) : null;
      if (body.evidenceText !== undefined) entry.evidence = String(body.evidenceText).trim()
        ? [{ type: "human", ref: String(body.evidenceText).slice(0, 160) }] : [];
      entry.lastEditAt = new Date().toISOString(); entry.lastEditBy = "user";
      await saveJson(guideFilePath(projectPath), guide);
      return res.json({ ok: true, guide });
    }

    // ── remark：人員注記（獨立檔 — guide 重生成永不覆蓋）──
    if (url === "/api/coding-trouble/remark" && method === "PUT") {
      let body = {};
      try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
      const text = String(body.text || "").trim().slice(0, 2000);
      if (!text) return res.status(400).json({ error: "text required" });
      const remarks = await loadRemarks(projectPath);
      remarks.push({
        id: `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        text, author: String(body.author || "user").slice(0, 40), at: new Date().toISOString(),
      });
      await saveJson(remarksFilePath(projectPath), remarks);
      return res.json({ ok: true, remarks });
    }
    if (url === "/api/coding-trouble/remark" && method === "DELETE") {
      const id = String(q.get("id") || "");
      const remarks = (await loadRemarks(projectPath)).filter(r => r.id !== id);
      await saveJson(remarksFilePath(projectPath), remarks);
      return res.json({ ok: true, remarks });
    }

    return res.status(404).json({ error: "not found" });
  };

  return handle().catch(e => {
    console.error("[coding-trouble]", e.message);
    return res.status(500).json({ error: e.message });
  });
}

/**
 * coding-handover.mjs — Handover（交接）API Routes
 *
 * 「人要可以很容易懂、可以接手、指揮 AI 開發和維運」
 *
 * 交接包 = 新工程師（或新 AI agent）接手一個 Release Unit 所需的最小上下文：
 *   專案是什麼（PROJECT/ARCHITECTURE）→ 為什麼這樣設計（DECISIONS）
 *   → 最近改了什麼（CHANGELOG + git log）→ 進行中的工作（active tasks）
 *   → 怎麼跑起來（scripts）
 *
 * Routes:
 *   GET  /api/coding-handover/bundle?path=...    — 交接包聚合（即時，deterministic 零 token）
 *   POST /api/coding-handover/generate           — 生成 .paaw/HANDOVER.md
 *   GET  /api/coding-handover/brief?path=...     — AI 摘要包（quickstart/決策挖掘/地雷區；2026-10-10）
 *   POST /api/coding-handover/brief?path=...     — 懶生成/重生成 brief（1 次 LLM；CU 不觸發 — Fleming 拍板進頁才燒）
 *   PUT  /api/coding-handover/remark?path=...    — 人員注記（獨立檔 handover-remarks.json — 重生成永不覆蓋）
 *   DELETE /api/coding-handover/remark?path=&id= — 刪注記
 *
 * 2026-10-10 Fleming 拍板：brief 懶生成（進 handover page 才觸發，平時/CU 不燒 token）；
 * 人員注記是作者資產永久保留；「為什麼」= AI 從 git/task 挖 + evidence，人 optional 補注記。
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { buildHandoverState, writeHandoverState, loadHandoverState } from "../lib/release-unit/handover-state.mjs";
import { callProjectLLM } from "./coding.mjs";
import { stableStringify } from "../lib/stable-stringify.mjs";

const execAsync = promisify(_exec);

// .paaw 重構後知識檔案在子目錄（見 paaw-project.mjs FILE_MAP）
// Slim CU：只保留人寫的 PROJECT.md + Coding Standards
const KNOWLEDGE_SOURCES = [
  { key: "project", file: "project/PROJECT.md", label: "專案概覽" },
];

async function readKnowledgeFile(projectPath, rel) {
  const p = join(projectPath, ".paaw", rel);
  if (existsSync(p)) return readFile(p, "utf-8");
  // fallback：重構前的根目錄位置（e.g. .paaw/PROJECT.md）
  const legacy = join(projectPath, ".paaw", rel.split("/").pop());
  if (existsSync(legacy)) return readFile(legacy, "utf-8");
  return null;
}

async function gitLog(projectPath, n = 15) {
  try {
    const { stdout } = await execAsync(`git log --oneline -n ${n}`, { cwd: projectPath, timeout: 10000 });
    return stdout.trim().split("\n").filter(Boolean);
  } catch { return []; }
}

async function gitStatusShort(projectPath) {
  try {
    const { stdout } = await execAsync("git status --porcelain | head -20", { cwd: projectPath, timeout: 10000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return { dirty: lines.length > 0, files: lines };
  } catch { return { dirty: false, files: [] }; }
}

async function loadPackageInfo(projectPath) {
  const pkgFile = join(projectPath, "package.json");
  if (!existsSync(pkgFile)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgFile, "utf-8"));
    return {
      name: pkg.name || null,
      scripts: pkg.scripts || {},
      dependencies: Object.keys(pkg.dependencies || {}),
      devDependenciesCount: Object.keys(pkg.devDependencies || {}).length,
    };
  } catch { return null; }
}

async function loadActiveTasks(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return [];
  try {
    const data = JSON.parse(await readFile(tasksFile, "utf-8"));
    return (data.tasks || [])
      .filter(t => ["open", "in-progress", "todo"].includes(t.status))
      .slice(0, 10)
      .map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority || "normal" }));
  } catch { return []; }
}

async function loadReleasesSummary(projectPath) {
  const dir = join(projectPath, ".paaw", "releases");
  if (!existsSync(dir)) return [];
  const { readdir } = await import("fs/promises");
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 5);
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({ id: r.id, taskId: r.taskId, title: r.title, releasedAt: r.releasedAt });
    } catch { /* skip */ }
  }
  return out;
}

async function buildBundle(projectPath) {
  const initialized = existsSync(join(projectPath, ".paaw"));
  const knowledge = {};
  for (const src of KNOWLEDGE_SOURCES) {
    knowledge[src.key] = await readKnowledgeFile(projectPath, src.file);
  }
  const [log, status, pkg, activeTasks, releases] = await Promise.all([
    gitLog(projectPath),
    gitStatusShort(projectPath),
    loadPackageInfo(projectPath),
    loadActiveTasks(projectPath),
    loadReleasesSummary(projectPath),
  ]);
  return {
    initialized,
    generatedAt: new Date().toISOString(),
    knowledge,
    git: { log, status },
    package: pkg,
    activeTasks,
    releases,
    hasKnowledge: !!knowledge.project,
  };
}

function renderHandoverMd(bundle) {
  const k = bundle.knowledge;
  const L = [];
  L.push("# HANDOVER — 交接文件");
  L.push("");
  L.push(`> 生成時間：${bundle.generatedAt}`);
  L.push("> 這份文件是給下一位工程師（或 AI agent）的最小接手上下文。");
  L.push("");
  L.push("## 1. 這是什麼專案？");
  L.push("");
  L.push(k.project ? k.project.split("\n").slice(0, 40).join("\n") : "_(尚未建立 PROJECT.md — 請人工填寫)_");
  L.push("");
  L.push("## 2. 最近變更");
  L.push("");
  if (bundle.git.log.length) {
    L.push("### Git 歷史（最近 15 筆）");
    L.push("```");
    L.push(bundle.git.log.join("\n"));
    L.push("```");
  }
  L.push("");
  L.push("## 3. 進行中的工作");
  L.push("");
  if (bundle.activeTasks.length) {
    for (const t of bundle.activeTasks) L.push(`- [${t.status}] ${t.id} — ${t.title}（${t.priority}）`);
  } else {
    L.push("_(沒有進行中的 task)_");
  }
  L.push("");
  L.push("## 4. 怎麼跑起來");
  L.push("");
  if (bundle.package?.scripts && Object.keys(bundle.package.scripts).length) {
    const common = ["dev", "start", "build", "test", "lint"];
    L.push("```bash");
    for (const s of common) {
      if (bundle.package.scripts[s]) L.push(`npm run ${s}    # ${bundle.package.scripts[s].slice(0, 60)}`);
    }
    L.push("```");
  } else {
    L.push("_(沒有 package.json scripts — 依專案類型自行確認)_");
  }
  L.push("");
  L.push("## 5. Release 歷史（最近 5 筆）");
  L.push("");
  if (bundle.releases.length) {
    for (const r of bundle.releases) L.push(`- ${r.releasedAt} — ${r.id} — ${r.title}`);
  } else {
    L.push("_(尚未有 release 記錄)_");
  }
  L.push("");
  L.push("## 7. 接手指引");
  L.push("");
  L.push("1. 讀完 1–3 節建立全貌");
  L.push("2. `git log` 看最近改動方向");
  L.push("3. 檢查第 5 節進行中 task，跟 EM 確認優先序");
  L.push("4. 有問題問 Handover AI 助理（它讀得到這份知識庫）");
  return L.join("\n");
}

// ═══ AI 摘要包 brief（2026-10-10）— 懶生成：進 handover page 才觸發 ═══

function briefFilePath(projectPath) { return join(projectPath, ".paaw", "handover-brief.json"); } // nosemgrep: path-join-resolve-traversal — local-first：使用者自選專案根目錄
function remarksFilePath(projectPath) { return join(projectPath, ".paaw", "handover-remarks.json"); } // nosemgrep: path-join-resolve-traversal — 同上

async function loadBrief(projectPath) {
  try { return JSON.parse(await readFile(briefFilePath(projectPath), "utf-8")); } catch { return null; }
}
async function loadRemarks(projectPath) {
  try { const r = JSON.parse(await readFile(remarksFilePath(projectPath), "utf-8")); return Array.isArray(r) ? r : []; } catch { return []; }
}
async function saveJson(pathAbs, obj) {
  const { mkdir } = await import("fs/promises");
  await mkdir(join(pathAbs, ".."), { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first
  await writeFile(pathAbs, stableStringify(obj) + "\n", "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first
}

// deterministic 原料（零 token）：features+severity / tasks / git log / scripts
async function collectBriefFacts(projectPath) {
  const facts = { features: [], tasks: [], gitLog: [], scripts: {}, pkgName: "", engines: null, hasReadme: false, hasEnvExample: false };
  try {
    const raw = JSON.parse(await readFile(join(projectPath, ".paaw", "features", "FEATURES.json"), "utf-8"));
    const features = Array.isArray(raw) ? raw : (raw.features || []);
    facts.features = features.map(f => ({ name: f.name, severity: f.severity || f.severitySuggested || null, desc: String(f.description || "").slice(0, 120) }));
  } catch { /* CU 未跑 */ }
  try {
    const raw = JSON.parse(await readFile(join(projectPath, ".paaw", "tasks", "TASKS.json"), "utf-8"));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || []);
    facts.tasks = tasks.slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))).slice(0, 20)
      .map(t => ({ title: String(t.title || t.name || "").slice(0, 100), commit: t.git?.commit || t.changes?.commit || null }));
  } catch { /* 無 tasks */ }
  try {
    const { stdout } = await execAsync("git log --oneline --no-color -60", { cwd: projectPath, timeout: 10000 });
    facts.gitLog = stdout.trim().split("\n").filter(Boolean);
  } catch { /* 非 git repo */ }
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8"));
    facts.scripts = pkg.scripts || {}; facts.pkgName = pkg.name || ""; facts.engines = pkg.engines || null;
  } catch { /* 無 package.json */ }
  facts.hasReadme = existsSync(join(projectPath, "README.md")) || existsSync(join(projectPath, "README.zh-TW.md"));
  facts.hasEnvExample = existsSync(join(projectPath, ".env.example"));
  return facts;
}

// 1 次 LLM：summary + quickstart + 決策挖掘（帶 evidence，挖不到標 gap）+ 地雷區
async function generateBriefAi(facts) {
  const prompt = `You are a senior engineer preparing a handover brief for the next developer of this release unit.
Analyze the FACTS and output STRICT JSON only (no markdown fence).

FACTS:
- package: ${facts.pkgName || "(unknown)"}${facts.engines ? ` engines=${JSON.stringify(facts.engines)}` : ""}
- scripts: ${JSON.stringify(facts.scripts).slice(0, 600)}
- readme: ${facts.hasReadme}; .env.example: ${facts.hasEnvExample}
- features (${facts.features.length}): ${facts.features.map(f => `${f.name}[${f.severity || "?"}]`).slice(0, 40).join(", ")}
- recent tasks: ${facts.tasks.slice(0, 12).map(t => t.title).join(" | ")}
- git log (newest first):
${facts.gitLog.slice(0, 60).join("\n")}

OUTPUT JSON:
{
  "summary": "一句話：這系統是什麼（zh-TW）",
  "quickstart": { "steps": ["起手步驟（從 scripts/事實推導，不確定標(?)）"], "env": ["環境需求"] },
  "decisions": [ { "title": "決策", "why": "為什麼（從 commit/task 訊息推導）", "evidence": "真實 commit hash 或 task 標題", "gap": false } ],
  "dangerZones": ["最危險區域（severity S2 優先 + fix hotspot）"]
}
Rules: decisions 最多 8 條；evidence 必須真實存在於 git log/task — 不編造；重要決策無痕跡 → gap=true evidence=（無紀錄）；dangerZones 最多 5 條；全部 zh-TW。`;

  const result = await callProjectLLM({
    messages: [
      { role: "system", content: "You are a precise code analyst. Output STRICT JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  }, { caller: "handover-brief" });

  const m = (result?.content || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]);
    return {
      summary: String(d.summary || "").slice(0, 400),
      quickstart: {
        steps: Array.isArray(d.quickstart?.steps) ? d.quickstart.steps.slice(0, 12).map(x => String(x).slice(0, 200)) : [],
        env: Array.isArray(d.quickstart?.env) ? d.quickstart.env.slice(0, 8).map(x => String(x).slice(0, 120)) : [],
      },
      decisions: Array.isArray(d.decisions) ? d.decisions.slice(0, 8).map(x => ({
        title: String(x?.title || "").slice(0, 120), why: String(x?.why || "").slice(0, 400),
        evidence: String(x?.evidence || "").slice(0, 160), gap: !!x?.gap,
      })).filter(x => x.title) : [],
      dangerZones: Array.isArray(d.dangerZones) ? d.dangerZones.slice(0, 5).map(x => String(x).slice(0, 160)) : [],
    };
  } catch { return null; }
}

// ── Route Handler ──

export default async function handoverRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-handover")) return next?.() ?? false;

  const projectPath = q.get("path");

  if (url === "/api/coding-handover/state" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path required" });
    }
    // ?refresh=1 → 現場重建並落地；否則讓快取（自動保鮮的 handover-state.json）優先
    if (q.get("refresh") === "1") {
      const st = await writeHandoverState(projectPath);
      return res.json(st);
    }
    const st = await loadHandoverState(projectPath);
    return res.json(st);
  }

  if (url === "/api/coding-handover/bundle" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path required" });
    }
    const bundle = await buildBundle(projectPath);
    return res.json(bundle);
  }

  // ── brief：AI 摘要包（懶生成）──
  if (url === "/api/coding-handover/brief" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const [brief, remarks] = await Promise.all([loadBrief(projectPath), loadRemarks(projectPath)]);
    return res.json({ brief, remarks });
  }
  if (url === "/api/coding-handover/brief" && method === "POST") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const facts = await collectBriefFacts(projectPath);
    const ai = await generateBriefAi(facts);
    const brief = {
      version: 1,
      generatedAt: new Date().toISOString(),
      severityCounts: {
        S2: facts.features.filter(f => f.severity === "S2").length,
        S1: facts.features.filter(f => f.severity === "S1").length,
        S0: facts.features.filter(f => f.severity === "S0").length,
        unconfirmed: facts.features.filter(f => !f.severity).length,
      },
      ai: ai || { error: "AI 摘要生成失敗 — 可按重新生成重試（deterministic 部分不受影響）" },
    };
    await saveJson(briefFilePath(projectPath), brief);
    return res.json({ ok: true, brief, remarks: await loadRemarks(projectPath) });
  }

  // ── remark：人員注記（獨立檔 — brief 重生成永不覆蓋）──
  if (url === "/api/coding-handover/remark" && method === "PUT") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
    const text = String(body.text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "text required" });
    const remarks = await loadRemarks(projectPath);
    remarks.push({
      id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      target: String(body.target || "general").slice(0, 80),
      text, author: String(body.author || "user").slice(0, 40), at: new Date().toISOString(),
    });
    await saveJson(remarksFilePath(projectPath), remarks);
    return res.json({ ok: true, remarks });
  }
  if (url === "/api/coding-handover/remark" && method === "DELETE") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first
    const id = String(q.get("id") || "");
    const remarks = (await loadRemarks(projectPath)).filter(r => r.id !== id);
    await saveJson(remarksFilePath(projectPath), remarks);
    return res.json({ ok: true, remarks });
  }

  if (url === "/api/coding-handover/generate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
    const path = body.path || projectPath;
    if (!path || !existsSync(path)) return res.status(400).json({ error: "path required" }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const bundle = await buildBundle(path);
    const md = renderHandoverMd(bundle);
    const { mkdir } = await import("fs/promises");
    const paawDir = join(path, ".paaw"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    if (!existsSync(paawDir)) await mkdir(paawDir, { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const file = join(paawDir, "HANDOVER.md"); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    await writeFile(file, md, "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    return res.json({ ok: true, file: ".paaw/HANDOVER.md", bytes: md.length });
  }

  return next?.() ?? false;
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}

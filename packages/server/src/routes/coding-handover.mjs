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
 *   GET  /api/coding-handover/bundle?path=...    — 交接包聚合（即時）
 *   POST /api/coding-handover/generate           — 生成 .paaw/HANDOVER.md
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { exec as _exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(_exec);

// .paaw 重構後知識檔案在子目錄（見 paaw-project.mjs FILE_MAP）
const KNOWLEDGE_SOURCES = [
  { key: "project", file: "project/PROJECT.md" },
  { key: "architecture", file: "project/ARCHITECTURE.md" },
  { key: "decisions", file: "decisions/DECISIONS.md" },
  { key: "changelog", file: "changelog/CHANGELOG.md" },
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
    hasKnowledge: !!(knowledge.project || knowledge.architecture),
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
  L.push(k.project ? k.project.split("\n").slice(0, 40).join("\n") : "_(尚未建立 PROJECT.md — 請先跑 Code Understanding)_");
  L.push("");
  L.push("## 2. 架構");
  L.push("");
  L.push(k.architecture ? k.architecture.split("\n").slice(0, 60).join("\n") : "_(尚未建立 ARCHITECTURE.md)_");
  L.push("");
  L.push("## 3. 重要設計決策（為什麼是這樣）");
  L.push("");
  L.push(k.decisions ? k.decisions.split("\n").slice(0, 80).join("\n") : "_(尚未建立 DECISIONS.md)_");
  L.push("");
  L.push("## 4. 最近變更");
  L.push("");
  if (bundle.git.log.length) {
    L.push("### Git 歷史（最近 15 筆）");
    L.push("```");
    L.push(bundle.git.log.join("\n"));
    L.push("```");
  }
  if (k.changelog) {
    L.push("### CHANGELOG（最近）");
    L.push(k.changelog.split("\n").slice(0, 40).join("\n"));
  }
  L.push("");
  L.push("## 5. 進行中的工作");
  L.push("");
  if (bundle.activeTasks.length) {
    for (const t of bundle.activeTasks) L.push(`- [${t.status}] ${t.id} — ${t.title}（${t.priority}）`);
  } else {
    L.push("_(沒有進行中的 task)_");
  }
  L.push("");
  L.push("## 6. 怎麼跑起來");
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
  L.push("## 7. Release 歷史（最近 5 筆）");
  L.push("");
  if (bundle.releases.length) {
    for (const r of bundle.releases) L.push(`- ${r.releasedAt} — ${r.id} — ${r.title}`);
  } else {
    L.push("_(尚未有 release 記錄)_");
  }
  L.push("");
  L.push("## 8. 接手指引");
  L.push("");
  L.push("1. 讀完 1–3 節建立全貌");
  L.push("2. `git log` 看最近改動方向");
  L.push("3. 檢查第 5 節進行中 task，跟 EM 確認優先序");
  L.push("4. 有問題問 Handover AI 助理（它讀得到這份知識庫）");
  return L.join("\n");
}

// ── Route Handler ──

export default async function handoverRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-handover")) return next?.() ?? false;

  const projectPath = q.get("path");

  if (url === "/api/coding-handover/bundle" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({ error: "path required" });
    }
    const bundle = await buildBundle(projectPath);
    return res.json(bundle);
  }

  if (url === "/api/coding-handover/generate" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readBody(req) || "{}"); } catch { /* empty */ }
    const path = body.path || projectPath;
    if (!path || !existsSync(path)) return res.status(400).json({ error: "path required" });
    const bundle = await buildBundle(path);
    const md = renderHandoverMd(bundle);
    const { mkdir } = await import("fs/promises");
    const paawDir = join(path, ".paaw");
    if (!existsSync(paawDir)) await mkdir(paawDir, { recursive: true });
    const file = join(paawDir, "HANDOVER.md");
    await writeFile(file, md, "utf-8");
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

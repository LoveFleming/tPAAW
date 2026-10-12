/**
 * coding-ops.mjs — Troubleshooting / 維運 API Routes
 *
 * 「可維運」— Runbook + 服務現況 + 診斷入口。
 * Ops AI 助理（/a2a/ops）可讀 runbook 和 log 幫忙診斷；
 * 這裡提供 deterministic 的狀態與 runbook 存取。
 *
 * Routes:
 *   GET  /api/coding-ops/status?path=...            — 服務現況（維運概覽/git/runbook 清單+來源/release 摘要）
 *   GET  /api/coding-ops/runbook?id=...&path=...    — 讀單份 runbook 內容
 *   POST /api/coding-ops/runbook/save               — 儲存 runbook（AI 生成後人也 editable）
 */

import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { exec as _exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(_exec);

async function gitInfo(projectPath) {
  try {
    const [branch, status, log] = await Promise.all([
      execAsync("git rev-parse --abbrev-ref HEAD", { cwd: projectPath, timeout: 8000 }),
      execAsync("git status --porcelain | head -15", { cwd: projectPath, timeout: 8000 }),
      execAsync("git log --oneline -n 5", { cwd: projectPath, timeout: 8000 }),
    ]);
    const files = status.stdout.trim().split("\n").filter(Boolean);
    return {
      isRepo: true,
      branch: branch.stdout.trim(),
      dirty: files.length > 0,
      dirtyFiles: files,
      lastCommits: log.stdout.trim().split("\n").filter(Boolean),
    };
  } catch {
    return { isRepo: false, branch: null, dirty: false, dirtyFiles: [], lastCommits: [] };
  }
}

async function listRunbooks(projectPath) {
  const dir = join(projectPath, ".paaw", "runbook");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith(".md"));
  const out = [];
  for (const f of files) {
    try {
      const full = join(dir, f);
      const content = await readFile(full, "utf-8");
      const st = await stat(full);
      // 取第一個 # 標題當 title
      const titleMatch = content.match(/^#\s+(.+)$/m);
      // 2026-10-09：來源偵測 — 檔頭 8 行內有 source:/owner: human 標記 = 人寫權威，否則 AI 草稿
      const headLines = content.split("\n").slice(0, 8).join("\n");
      const source = /^[-\s]*(source|owner)\s*:\s*human/m.test(headLines) ? "human" : "ai";
      out.push({
        id: f.replace(/\.md$/, ""),
        source,
        title: titleMatch ? titleMatch[1] : f,
        bytes: content.length,
        mtime: st.mtime.toISOString(),
        headings: (content.match(/^##\s+(.+)$/gm) || []).slice(0, 8).map(h => h.replace(/^##\s+/, "")),
      });
    } catch { /* skip */ }
  }
  out.sort((a, b) => (a.source === b.source ? (b.mtime || "").localeCompare(a.mtime || "") : a.source === "human" ? -1 : 1)); // 人寫權威在最上，其餘按更新時間
  return out;
}

async function loadScripts(projectPath) {
  const pkgFile = join(projectPath, "package.json");
  if (!existsSync(pkgFile)) return {};
  try {
    const pkg = JSON.parse(await readFile(pkgFile, "utf-8"));
    return pkg.scripts || {};
  } catch { return {}; }
}

// ── 維運概覽（deterministic — C4-lite：誰/怎麼跑/哪個 port/資料在哪/依賴誰）──
async function loadOverview(projectPath) {
  let pkg = {};
  try { pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8")); } catch { /* 沒有 package.json 就空殼 */ }
  const scripts = pkg.scripts || {};

  // port 偵測：scripts + .env/.env.example + vite.config（偵測值，非權威）
  const srcTexts = [Object.values(scripts).join("\n")];
  for (const f of [".env", ".env.example", "vite.config.ts", "vite.config.js"]) {
    try { srcTexts.push(await readFile(join(projectPath, f), "utf-8")); } catch { /* skip */ }
  }
  const portSet = new Set();
  for (const m of srcTexts.join("\n").matchAll(/\b([1-9]\d{3,4})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1024 && n <= 65535 && !(n >= 1900 && n <= 2100)) portSet.add(n); // 1900-2100 = 年份雜訊
  }
  // src 掃描（嚴格模式：只認 port 相關賦值/fallback，如 config.paawServerPort || 4097）
  try {
    const srcDir = join(projectPath, "src");
    if (existsSync(srcDir)) {
      const files = (await readdir(srcDir)).filter(f => /\.(mjs|js|ts)$/.test(f)).slice(0, 20);
      let scanned = "";
      for (const f of files) {
        try {
          const c = await readFile(join(srcDir, f), "utf-8");
          if (scanned.length < 300_000) scanned += c.slice(0, 30_000);
        } catch { /* skip */ }
      }
      for (const m of scanned.matchAll(/[Pp]ort[^\n]{0,16}?([1-9]\d{3,4})\b/g)) {
        const n = Number(m[1]);
        if (n >= 1024 && n <= 65535 && !(n >= 1900 && n <= 2100)) portSet.add(n);
      }
    }
  } catch { /* skip */ }
  const ports = [...portSet].sort((a, b) => a - b).slice(0, 8).map(String);

  // 資料位置偵測（常見目錄存在即列）
  const dataDirs = ["data", ".paaw", "db", "storage", "logs", "log"].filter(d => existsSync(join(projectPath, d)));

  // 相依（container 級外部依賴，非 dev）
  const deps = Object.keys(pkg.dependencies || {}).slice(0, 14);

  const ws = pkg.workspaces;
  const workspaces = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];

  // env keys（只出名稱，不讀值）
  let envKeys = [];
  try {
    const env = await readFile(join(projectPath, ".env.example"), "utf-8");
    envKeys = env.split("\n").map(l => l.match(/^\s*([A-Z0-9_]+)\s*=/)).filter(Boolean).map(m => m[1]).slice(0, 20);
  } catch { /* skip */ }

  return {
    name: pkg.name || null,
    version: pkg.version || null,
    startCmd: scripts.start ? "npm start" : scripts.dev ? "npm run dev" : null,
    testCmd: scripts.test ? "npm test" : null,
    ports, dataDirs, deps, workspaces, envKeys,
  };
}

async function loadRecentReleases(projectPath) {
  const dir = join(projectPath, ".paaw", "releases");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse().slice(0, 3);
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({ id: r.id, taskId: r.taskId, title: r.title, releasedAt: r.releasedAt, note: r.note || null });
    } catch { /* skip */ }
  }
  return out;
}

// ── Route Handler ──

export default async function opsRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;

  if (!url.startsWith("/api/coding-ops")) return next?.() ?? false;

  const projectPath = q.get("path");

  if (url === "/api/coding-ops/status" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path required" });
    }
    const [git, runbooks, scripts, releases, overview] = await Promise.all([
      gitInfo(projectPath),
      listRunbooks(projectPath),
      loadScripts(projectPath),
      loadRecentReleases(projectPath),
      loadOverview(projectPath),
    ]);
    return res.json({
      initialized: existsSync(join(projectPath, ".paaw")), // nosemgrep: detect-non-literal-fs-filename, path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
      git,
      overview,
      runbooks,
      scripts,
      releases,
      checkedAt: new Date().toISOString(),
    });
  }

  if (url === "/api/coding-ops/runbook" && method === "GET") {
    const id = (q.get("id") || "").replace(/[/\\]/g, ""); // 防 path traversal
    if (!projectPath || !id) return res.status(400).json({ error: "path and id required" });
    const file = join(projectPath, ".paaw", "runbook", `${id}.md`); // nosemgrep: path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    if (!existsSync(file)) return res.status(404).json({ error: "runbook not found" }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    return res.json({ id, content: await readFile(file, "utf-8") }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
  }

  if (url === "/api/coding-ops/runbook/save" && method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    const { path, id, content } = body;
    if (!path || !id || !content) return res.status(400).json({ error: "path, id, content required" });
    const safeId = String(id).replace(/[/\\]/g, "");
    const dir = join(path, ".paaw", "runbook");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${safeId}.md`), content, "utf-8");
    return res.json({ ok: true, file: `.paaw/runbook/${safeId}.md` });
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

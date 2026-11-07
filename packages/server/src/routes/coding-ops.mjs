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
import { runGit } from "./vibe-fs.mjs";
import { sanitizeId, safeResolve } from "../lib/coding-security.mjs";
import { readBody } from "./shared.mjs";

// 一次 status 最多回傳幾個 dirty 檔案（避免超長清單塞爆 context / UI）
const MAX_DIRTY_FILES = 15;
// .paaw/runbook 內允許的副檔名（白名單）
const RUNBOOK_EXT = ".md";

/**
 * 讀取專案 git 現況。
 *
 * 用 runGit（spawn git，execFile 語意、無 shell）取代 exec(shell)：
 *   - 避免 `git status --porcelain | head -15` 的 shell 管線（跨平台不一致，
 *     且 Windows cmd 對 | 的處理與 POSIX 不同）
 *   - 截斷改在 JS 端做（slice），不依賴外部 head 指令
 *
 * 失敗時回傳 isRepo:false 並附 error 欄位（可辨因），不再靜默吞錯。
 */
async function gitInfo(projectPath) {
  const [branch, status, log] = await Promise.all([
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], projectPath, 8000),
    runGit(["status", "--porcelain"], projectPath, 8000),
    runGit(["log", "--oneline", "-n", "5"], projectPath, 8000),
  ]);

  // 任一指令失敗（多半因為不是 git repo）→ isRepo:false，並保留失敗原因
  if (!branch.ok || !status.ok || !log.ok) {
    const errorText = [branch, status, log].find((r) => !r.ok)?.errorText || "git command failed";
    return { isRepo: false, branch: null, dirty: false, dirtyFiles: [], lastCommits: [], error: errorText };
  }

  const dirtyFiles = status.stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(0, MAX_DIRTY_FILES);

  return {
    isRepo: true,
    branch: branch.stdout.trim(),
    dirty: dirtyFiles.length > 0,
    dirtyFiles,
    lastCommits: log.stdout.split("\n").map((l) => l.trimEnd()).filter(Boolean),
  };
}

async function listRunbooks(projectPath) {
  const dir = join(projectPath, ".paaw", "runbook");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(RUNBOOK_EXT));
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
        headings: (content.match(/^##\s+(.+)$/gm) || []).slice(0, 8).map((h) => h.replace(/^##\s+/, "")),
      });
    } catch (e) {
      // 單一 runbook 讀取失敗（權限/競態刪除）不應讓整份清單掛掉 — 記 log 供診斷但不中斷
      console.error(`[coding-ops] listRunbooks: failed to read ${f}: ${e?.message || e}`);
    }
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
  } catch (e) {
    // package.json 損壞 → 前端視為無 scripts，但把原因記到 server log（避免無聲失敗）
    console.error(`[coding-ops] loadScripts: invalid package.json at ${projectPath}: ${e?.message || e}`);
    return {};
  }
}

// ── 維運概覽（deterministic — C4-lite：誰/怎麼跑/哪個 port/資料在哪/依賴誰）──
async function loadOverview(projectPath) {
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(join(projectPath, "package.json"), "utf-8"));
  } catch (e) {
    // 沒有（或損壞）package.json 就空殼 — ENOENT 是合法狀態不記；其他錯誤記 log
    if (e && e.code !== "ENOENT") console.error(`[coding-ops] loadOverview: invalid package.json at ${projectPath}: ${e.message}`);
  }
  const scripts = pkg.scripts || {};

  // port 偵測：scripts + .env/.env.example + vite.config（偵測值，非權威）
  const srcTexts = [Object.values(scripts).join("\n")];
  for (const f of [".env", ".env.example", "vite.config.ts", "vite.config.js"]) {
    try {
      srcTexts.push(await readFile(join(projectPath, f), "utf-8"));
    } catch (e) {
      if (e && e.code !== "ENOENT") console.error(`[coding-ops] loadOverview: cannot read ${f}: ${e.message}`);
    }
  }
  const portSet = new Set();
  for (const m of srcTexts.join("\n").matchAll(/\b([1-9]\d{3,4})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1024 && n <= 65535 && !(n >= 1900 && n <= 2100)) portSet.add(n); // 1900-2100 = 年份雜訊
  }
  // src 掃描（嚴格模式：只認 port 相關賦值/fallback，如 config.paawServerPort || 4097）
  const srcDir = join(projectPath, "src");
  if (existsSync(srcDir)) {
    const files = (await readdir(srcDir)).filter((f) => /\.(mjs|js|ts)$/.test(f)).slice(0, 20);
    let scanned = "";
    for (const f of files) {
      try {
        const c = await readFile(join(srcDir, f), "utf-8");
        if (scanned.length < 300_000) scanned += c.slice(0, 30_000);
      } catch (e) {
        if (e && e.code !== "ENOENT") console.error(`[coding-ops] loadOverview: cannot read src/${f}: ${e.message}`);
      }
    }
    for (const m of scanned.matchAll(/[Pp]ort[^\n]{0,16}?([1-9]\d{3,4})\b/g)) {
      const n = Number(m[1]);
      if (n >= 1024 && n <= 65535 && !(n >= 1900 && n <= 2100)) portSet.add(n);
    }
  }
  const ports = [...portSet].sort((a, b) => a - b).slice(0, 8).map(String);

  // 資料位置偵測（常見目錄存在即列）
  const dataDirs = ["data", ".paaw", "db", "storage", "logs", "log"].filter((d) => existsSync(join(projectPath, d)));

  // 相依（container 級外部依賴，非 dev）
  const deps = Object.keys(pkg.dependencies || {}).slice(0, 14);

  const ws = pkg.workspaces;
  const workspaces = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];

  // env keys（只出名稱，不讀值）
  let envKeys = [];
  try {
    const env = await readFile(join(projectPath, ".env.example"), "utf-8");
    envKeys = env.split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)).filter(Boolean).map((m) => m[1]).slice(0, 20);
  } catch (e) {
    if (e && e.code !== "ENOENT") console.error(`[coding-ops] loadOverview: cannot read .env.example: ${e.message}`);
  }

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
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 3);
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({ id: r.id, taskId: r.taskId, title: r.title, releasedAt: r.releasedAt, note: r.note || null });
    } catch (e) {
      console.error(`[coding-ops] loadRecentReleases: invalid release file ${f}: ${e?.message || e}`);
    }
  }
  return out;
}

/** 檢查 runbook 內容是否標記為人寫權威（檔頭 8 行內 source:/owner: human） */
function isHumanAuthored(content) {
  if (typeof content !== "string") return false;
  const headLines = content.split("\n").slice(0, 8).join("\n");
  return /^[-\s]*(source|owner)\s*:\s*human/m.test(headLines);
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
    if (!projectPath || !q.get("id")) return res.status(400).json({ error: "path and id required" });
    // 用既有 sanitizeId（正則 whitelist + 擋 ..），失敗回 400 而非 500
    let id;
    try {
      id = sanitizeId(q.get("id"));
    } catch {
      return res.status(400).json({ error: "invalid id" });
    }
    // 只允許 .paaw/runbook 內、白名單副檔名的檔案（safeResolve 保證不逃出 root）
    const file = safeResolve(projectPath, ".paaw", "runbook", `${id}${RUNBOOK_EXT}`);
    if (!existsSync(file)) return res.status(404).json({ error: "runbook not found" }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    return res.json({ id, content: await readFile(file, "utf-8") }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
  }

  if (url === "/api/coding-ops/runbook/save" && method === "POST") {
    // 畸形 JSON body 視為 client 錯誤回 400，不外洩原始 SyntaxError
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return res.status(400).json({ error: "invalid JSON body" });
    }
    const { path: targetPath, id: rawId, content, overwrite } = body || {};
    if (!targetPath || !rawId || !content) return res.status(400).json({ error: "path, id, content required" });
    // 專案路徑必須是既有目錄 — 防止對任意路徑 mkdir -p + 寫檔（Arbitrary File Write）
    if (typeof targetPath !== "string" || !existsSync(targetPath) || !(await stat(targetPath)).isDirectory()) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      return res.status(400).json({ error: "path must be an existing directory" });
    }
    // id 用既有 sanitizeId；檔案路徑用 safeResolve 二次確認不逃出 .paaw/runbook
    let safeId;
    try {
      safeId = sanitizeId(rawId);
    } catch {
      return res.status(400).json({ error: "invalid id" });
    }
    const dir = safeResolve(targetPath, ".paaw", "runbook");
    const file = safeResolve(dir, `${safeId}${RUNBOOK_EXT}`);
    // 覆寫保護：不得無聲蓋掉人寫權威（source:human）的 runbook，除非明確帶 overwrite:true
    if (existsSync(file) && !overwrite) { // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
      try {
        const existing = await readFile(file, "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
        if (isHumanAuthored(existing)) {
          return res.status(409).json({ error: "runbook is human-authored; pass overwrite:true to replace", source: "human" });
        }
      } catch (e) {
        console.error(`[coding-ops] runbook/save: cannot read existing ${file}: ${e?.message || e}`);
      }
    }
    if (!existsSync(dir)) await mkdir(dir, { recursive: true }); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    await writeFile(file, content, "utf-8"); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    return res.json({ ok: true, file: `.paaw/runbook/${safeId}${RUNBOOK_EXT}` });
  }

  return next?.() ?? false;
}

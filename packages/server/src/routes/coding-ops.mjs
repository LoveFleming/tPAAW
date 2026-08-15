/**
 * coding-ops.mjs — Troubleshooting / 維運 API Routes
 *
 * 「可維運」— Runbook + 服務現況 + 診斷入口。
 * Ops AI 助理（/a2a/ops）可讀 runbook 和 log 幫忙診斷；
 * 這裡提供 deterministic 的狀態與 runbook 存取。
 *
 * Routes:
 *   GET  /api/coding-ops/status?path=...            — 服務現況（git/腳本/runbook 清單/release 摘要）
 *   GET  /api/coding-ops/runbook?id=...&path=...    — 讀單份 runbook 內容
 *   POST /api/coding-ops/runbook/save               — 儲存 runbook（AI 生成後人也 editable）
 */

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
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
      const content = await readFile(join(dir, f), "utf-8");
      // 取第一個 # 標題當 title
      const titleMatch = content.match(/^#\s+(.+)$/m);
      out.push({
        id: f.replace(/\.md$/, ""),
        title: titleMatch ? titleMatch[1] : f,
        bytes: content.length,
        headings: (content.match(/^##\s+(.+)$/gm) || []).slice(0, 8).map(h => h.replace(/^##\s+/, "")),
      });
    } catch { /* skip */ }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
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

  if (!url.startsWith("/api/coding-ops")) return next?.() ?? true;

  const projectPath = q.get("path");

  if (url === "/api/coding-ops/status" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({ error: "path required" });
    }
    const [git, runbooks, scripts, releases] = await Promise.all([
      gitInfo(projectPath),
      listRunbooks(projectPath),
      loadScripts(projectPath),
      loadRecentReleases(projectPath),
    ]);
    return res.json({
      initialized: existsSync(join(projectPath, ".paaw")),
      git,
      runbooks,
      scripts,
      releases,
      checkedAt: new Date().toISOString(),
    });
  }

  if (url === "/api/coding-ops/runbook" && method === "GET") {
    const id = (q.get("id") || "").replace(/[/\\]/g, ""); // 防 path traversal
    if (!projectPath || !id) return res.status(400).json({ error: "path and id required" });
    const file = join(projectPath, ".paaw", "runbook", `${id}.md`);
    if (!existsSync(file)) return res.status(404).json({ error: "runbook not found" });
    return res.json({ id, content: await readFile(file, "utf-8") });
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

  return next?.() ?? true;
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}

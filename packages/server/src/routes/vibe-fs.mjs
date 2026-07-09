/**
 * Vibe FS + Git APIs
 * Routes: /api/vibe-fs/*, /api/vibe-git/*, /api/pick-directory
 */

import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { spawn } from "child_process";
import { normalizePath, PAAW_ROOT, DATA_ROOT, PORT } from "./shared.mjs";

// ── AI Settings paths ──
const CODE_REVIEW_PROMPT_PATH = resolve(PAAW_ROOT, "data/ai-settings/coding/code-review.md");

// ── Helper: run git command ──
async function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, timeout: 15000 });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    child.on("close", code => resolve({ ok: code === 0, stdout, stderr, code }));
    child.on("error", err => resolve({ ok: false, stdout: "", stderr: err.message, code: -1 }));
  });
}

export default async function vibeFsRoute(req, res) {
  // ── GET /api/vibe-fs/list ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-fs/list")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const dirPath = params.get("path") || "";
    const absPath = dirPath ? resolve(dirPath) : resolve(process.env.HOME || "/");
    try {
      const entries = await readdir(absPath, { withFileTypes: true });
      const IGNORED = new Set([".git", "node_modules", ".DS_Store", ".cache", ".Trash", ".npm", ".vite", ".next", ".nuxt", "dist", "build", ".turbo"]);
      const items = entries
        .filter(e => !IGNORED.has(e.name) && !e.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .map(e => ({ name: e.name, path: normalizePath(join(absPath, e.name)), isDirectory: e.isDirectory(), extension: e.isDirectory() ? null : (e.name.includes(".") ? e.name.split(".").pop() : null) }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: normalizePath(absPath), items }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, path: normalizePath(absPath), items: [] }));
    }
    return true;
  }

  // ── GET /api/vibe-fs/read ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-fs/read")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const filePath = params.get("path");
    if (!filePath) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    try {
      const content = await readFile(resolve(filePath), "utf-8");
      const s = await stat(resolve(filePath));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: normalizePath(resolve(filePath)), content, size: s.size, modified: s.mtime.toISOString() }));
    } catch (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── PUT /api/vibe-fs/write ──
  if (req.method === "PUT" && req.url === "/api/vibe-fs/write") {
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { path: fPath, content: fContent } = body;
    if (!fPath) { res.writeHead(400); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    try {
      await mkdir(dirname(resolve(fPath)), { recursive: true });
      await writeFile(resolve(fPath), fContent, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: normalizePath(resolve(fPath)) }));
    } catch (err) {
      res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // ── GET /api/vibe-git/status ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/status")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const r = await runGit(["status", "--porcelain=v1", "--branch"], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    const branchMatch = r.stdout.match(/^## (.+?)(?:\.\.\.|$)/m);
    const branch = branchMatch ? branchMatch[1] : "(unknown)";
    const files = r.stdout.split("\n").filter(l => l && !l.startsWith("#")).map(l => ({
      status: l.slice(0, 2).trim(), path: l.slice(3),
    }));
    const staged = files.filter(f => "MARC".includes(f.status[0]));
    const unstaged = files.filter(f => "MD".includes(f.status[0] || f.status[1]));
    const untracked = files.filter(f => f.status === "??");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ branch, staged, unstaged, untracked, all: files }));
    return true;
  }

  // ── GET /api/vibe-git/log ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/log")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const count = params.get("count") || "20";
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const r = await runGit([
      "log", `--max-count=${count}`, "--pretty=format:%H|%h|%an|%ae|%at|%s",
      "--date=unix",
    ], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    const commits = r.stdout.split("\n").filter(Boolean).map(line => {
      const [hash, short, author, email, ts, subject] = line.split("|");
      return { hash, short, author, email, date: new Date(parseInt(ts) * 1000).toISOString(), subject };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ commits }));
    return true;
  }

  // ── GET /api/vibe-git/diff ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/diff")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const file = params.get("file") || "";
    const cached = params.get("cached") === "true";
    const commit = params.get("commit") || "";
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const args = ["diff"];
    if (cached) args.push("--cached");
    if (commit) args.push(commit);
    if (file) args.push("--", file);
    const r = await runGit(args, cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ diff: r.stdout, ok: r.ok, error: r.stderr }));
    return true;
  }

  // ── GET /api/vibe-git/blame ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/blame")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const file = params.get("file");
    if (!cwd || !file) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path or file" })); return true; }
    const r = await runGit(["blame", "--porcelain", "--", file], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    const lines = [];
    const blocks = r.stdout.split("\n");
    let current = null;
    for (const line of blocks) {
      const headerMatch = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?/);
      if (headerMatch) {
        current = { hash: headerMatch[1], origLine: parseInt(headerMatch[2]), finalLine: parseInt(headerMatch[3]), lineCount: headerMatch[4] ? parseInt(headerMatch[4]) : 1, author: "", authorMail: "", authorTime: "", summary: "" };
        continue;
      }
      if (line.startsWith("author ") && current) current.author = line.slice(7);
      else if (line.startsWith("author-mail ") && current) current.authorMail = line.slice(12);
      else if (line.startsWith("author-time ") && current) current.authorTime = new Date(parseInt(line.slice(11)) * 1000).toISOString();
      else if (line.startsWith("summary ") && current) current.summary = line.slice(8);
      else if (line.startsWith("\t") && current) {
        lines.push({ ...current, content: line.slice(1) });
        current = { ...current, origLine: current.origLine, finalLine: current.finalLine + 1 };
      }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ file, lines }));
    return true;
  }

  // ── POST /api/vibe-git/ai-comment ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/ai-comment")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { diff, commits, context } = body;

    // Load code review prompt from ai-settings
    let reviewPrompt = "";
    try { reviewPrompt = readFileSync(CODE_REVIEW_PROMPT_PATH, "utf-8"); } catch {}
    if (!reviewPrompt) reviewPrompt = "你是資深程式碼審查員。請 review 以下 git 變更並產生審查意見。";

    const prompt = `${reviewPrompt}\n\n${diff ? "## Diff\n```diff\n" + diff.slice(0, 8000) + "\n```" : ""}\n${commits?.length ? "\n## Recent Commits\n" + commits.map(c => `- ${c.short} ${c.subject} (${c.author})`).join("\n") : ""}\n${context ? "\n## Context\n" + context : ""}`;

    try {
      const chatRes = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          providerId: "default",
          appId: "git-review",
        }),
      });
      let comment = "";
      const text = await new Promise((ok) => {
        let buf = "";
        const chunks = [];
        chatRes.body.on("data", (c) => { buf += c.toString(); });
        chatRes.body.on("end", () => {
          for (const line of buf.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try { const j = JSON.parse(line.slice(6)); if (j.content) chunks.push(j.content); } catch {}
            }
          }
          ok(chunks.join(""));
        });
      });
      comment = text;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ comment }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ comment: `⚠️ AI review 不可用 (${err.message || err})，但以下是基本分析：\n\n${(diff || "").slice(0, 2000) || "No diff"}` }));
    }
    return true;
  }

  // ── GET /api/pick-directory ──
  if (req.method === "GET" && req.url === "/api/pick-directory") {
    try {
      const { execFile } = await import("child_process");
      const platform = process.platform;
      let path;

      if (platform === "darwin") {
        path = await new Promise((resolve, reject) => {
          execFile("osascript", ["-e", `POSIX path of (choose folder with prompt "Select Working Base")`], (err, stdout) => {
            if (err) { reject(err); return; }
            resolve(stdout.trim().replace(/\/$/, ""));
          });
        });
      } else if (platform === "win32") {
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$fb = New-Object System.Windows.Forms.FolderBrowserDialog
$fb.Description = 'Select Working Base'
if ($fb.ShowDialog() -eq 'OK') { $fb.SelectedPath } else { '' }
`.trim();
        path = await new Promise((resolve, reject) => {
          execFile("powershell", ["-NoProfile", "-Command", psScript], (err, stdout) => {
            if (err) { reject(err); return; }
            const p = stdout.trim();
            resolve(p || null);
          });
        });
      } else {
        const { execSync } = await import("child_process");
        let cmd;
        try { execSync("which zenity", { stdio: "ignore" }); cmd = "zenity"; } catch {
          try { execSync("which kdialog", { stdio: "ignore" }); cmd = "kdialog"; } catch { cmd = null; }
        }
        if (cmd === "zenity") {
          path = await new Promise((resolve, reject) => {
            execFile("zenity", ["--file-selection", "--directory", "--title=Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else if (cmd === "kdialog") {
          path = await new Promise((resolve, reject) => {
            execFile("kdialog", ["--getexistingdirectory", ".", "Select Working Base"], (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim() || null);
            });
          });
        } else {
          path = null;
        }
      }

      if (path) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: normalizePath(path) }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: null, error: "Cancelled or no dialog available" }));
      }
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: null, error: "Cancelled or not supported" }));
    }
    return true;
  }

  // ── GET /api/vibe-fs/search?q=...&path=... ──
  // Global content search using ripgrep
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-fs/search")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const query = params.get("q") || "";
    const searchPath = params.get("path") || "";
    const caseSensitive = params.get("case") === "true";
    const wholeWord = params.get("wholeword") === "true";
    const useRegex = params.get("regex") === "true";
    const includeGlob = params.get("include") || "";
    const excludeGlob = params.get("exclude") || "";
    const maxResults = parseInt(params.get("limit") || "200");

    if (!query.trim()) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results: [], truncated: false }));
      return true;
    }

    const cwd = searchPath || PAAW_ROOT;
    const args = ["--json", "--max-count", "50", "--max-filesize", "1M"];
    if (!caseSensitive) args.push("-i");
    if (wholeWord) args.push("-w");
    if (!useRegex) args.push("--fixed-strings");
    // Common ignore patterns
    args.push("-g", "!.git", "-g", "!node_modules", "-g", "!dist", "-g", "!build", "-g", "!.next", "-g", "!__pycache__");
    if (includeGlob) {
      for (const g of includeGlob.split(",").map(s => s.trim()).filter(Boolean)) {
        args.push("-g", g);
      }
    }
    if (excludeGlob) {
      for (const g of excludeGlob.split(",").map(s => s.trim()).filter(Boolean)) {
        args.push("-g", `!${g}`);
      }
    }
    args.push(query, cwd);

    try {
      const child = spawn("rg", args, { cwd, timeout: 15000 });
      let stdout = "", stderr = "", resultCount = 0;
      const results = [];
      const fileMap = new Map(); // path → { filename, matches: [] }

      child.stdout.on("data", (d) => {
        stdout += d;
        // Process complete lines
        const lines = stdout.split("\n");
        stdout = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === "match") {
              const relPath = evt.data.path.text;
              const absPath = resolve(cwd, relPath);
              const filePath = absPath;
              const fileName = relPath.split("/").pop();
              if (!fileMap.has(filePath)) {
                fileMap.set(filePath, { path: filePath, filename: fileName, matches: [] });
              }
              fileMap.get(filePath).matches.push({
                line: evt.data.line_number,
                content: evt.data.lines.text.trimEnd(),
                before: evt.data.submatches?.[0]?.start || 0,
                after: evt.data.submatches?.[0]?.end || 0,
              });
              resultCount++;
            }
          } catch {}
        }
      });

      child.stderr.on("data", (d) => { stderr += d; });

      child.on("close", () => {
        const allResults = Array.from(fileMap.values()).sort((a, b) => b.matches.length - a.matches.length);
        const truncated = allResults.reduce((sum, f) => sum + f.matches.length, 0) > maxResults;
        // Limit matches per file
        for (const f of allResults) {
          if (f.matches.length > 20) f.matches = f.matches.slice(0, 20);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          results: allResults.slice(0, maxResults),
          total: resultCount,
          truncated,
        }));
      });

      child.on("error", () => {
        // rg not found — fallback to grep
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [], error: "ripgrep not found", total: 0, truncated: false }));
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

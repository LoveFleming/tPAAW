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
export async function runGit(args, cwd) {
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
        .filter(e => !IGNORED.has(e.name))
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
    const mode = params.get("mode") || ""; // "HEAD" = show last commit diff, "staged" = cached
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const args = ["diff", "--no-color"];
    if (commit) { args.push(commit); args.push("^!"); }
    else if (mode === "HEAD") { args.push("HEAD~1"); args.push("HEAD"); }
    else if (cached || mode === "staged") args.push("--cached");
    if (file) args.push("--", file);
    const r = await runGit(args, cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ diff: r.stdout, ok: r.ok, error: r.stderr }));
    return true;
  }

  // ── GET /api/vibe-git/changes-since?path=...&since=YYYY-MM-DD ──
  if (req.method === "GET" && req.url?.startsWith("/api/vibe-git/changes-since")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    const sinceDate = params.get("since") || new Date().toISOString().split("T")[0];
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const sinceArg = sinceDate.includes("T") ? sinceDate : `${sinceDate}T00:00:00`;
    const logR = await runGit(["log", `--since=${sinceArg}`, "--oneline", "--no-decorate"], cwd);
    const commits = logR.ok ? logR.stdout.trim().split("\n").filter(Boolean) : [];
    const count = commits.length || 1;
    const diffR = await runGit(["diff", "--name-only", `HEAD~${Math.min(count, 50)}`, "HEAD"], cwd);
    const changedFiles = diffR.ok ? diffR.stdout.trim().split("\n").filter(Boolean) : [];
    const statR = await runGit(["diff", "--stat", `HEAD~${Math.min(count, 50)}`, "HEAD"], cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ since: sinceDate, commits, commitCount: commits.length, changedFiles, diffStat: statR.ok ? statR.stdout.trim() : "" }));
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

  // ── POST /api/vibe-git/add — git add files ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/add")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const files = body.files; // string[] or ["."] for all
    if (!files?.length) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing files" })); return true; }
    const r = await runGit(["add", ...files], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: `Added ${files.length} file(s)` }));
    return true;
  }

  // ── POST /api/vibe-git/unstage — git restore --staged ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/unstage")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const file = body.file; // single file path
    const files = body.files; // or array of file paths
    const targets = files || (file ? [file] : []);
    if (!targets.length) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing file(s)" })); return true; }
    const r = await runGit(["restore", "--staged", ...targets], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: `Unstaged ${targets.length} file(s)` }));
    return true;
  }

  // ── POST /api/vibe-git/commit — git commit ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/commit")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const message = body.message;
    if (!message) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing commit message" })); return true; }
    const r = await runGit(["commit", "-m", message], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Committed", output: r.stdout.trim() }));
    return true;
  }

  // ── POST /api/vibe-git/push — git push ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/push")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body = {};
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch {}
    const args = ["push"];
    if (body.remote) args.push(body.remote);
    if (body.branch) args.push(body.branch);
    const r = await runGit(args, cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Pushed", output: r.stdout.trim() + (r.stderr ? "\n" + r.stderr.trim() : "") }));
    return true;
  }

  // ── POST /api/vibe-git/pull — git pull ──
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/pull")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    const r = await runGit(["pull"], cwd);
    if (!r.ok) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: r.stderr })); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, message: "Pulled", output: r.stdout.trim() + (r.stderr ? "\n" + r.stderr.trim() : "") }));
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

  // ── POST /api/vibe-git/ai-commit-msg ──
  // Generates a commit message from staged/selected diff
  if (req.method === "POST" && req.url?.startsWith("/api/vibe-git/ai-commit-msg")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const cwd = params.get("path");
    if (!cwd) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Missing path" })); return true; }
    let body;
    try { body = JSON.parse(await new Promise((ok, fail) => { let d = ""; req.on("data", c => d += c); req.on("end", () => ok(d)); req.on("error", fail); })); } catch { res.writeHead(400); res.end("Invalid JSON"); return true; }
    const { diff, files } = body;

    if (!diff || diff.trim().length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "" }));
      return true;
    }

    const prompt = `You are an expert software engineer. Analyze the following git diff and write a concise commit message.

Rules:
- Use conventional commit format: type(scope): description
- Types: feat, fix, refactor, docs, test, chore, style, perf, build, ci
- Keep the first line under 72 characters
- If the change is complex, add a blank line then a brief body (2-3 lines max)
- Write in English
- Do NOT wrap in code blocks or quotes — just the raw message

${files?.length ? "## Files\n" + files.map(f => `- ${f}`).join("\n") + "\n" : ""}
## Diff
\`\`\`diff
${diff.slice(0, 6000)}
\`\`\`

Respond with ONLY the commit message, nothing else.`;

    try {
      const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
      const { callLLMWithRetry } = await import("../lib/llm-utils.mjs");
      const llm = resolveLLMConfig(cwd);

      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
        stream: false,
      }, { maxRetries: 2, timeoutMs: 30_000, caller: "vibe-fs", agentId: "assistant", fallbacks: llm.fallbacks || [] });

      let msg = result.content || "";
      // Strip code block wrapping if present
      msg = msg.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: msg }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "", error: err.message }));
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

      child.on("close", (code) => {
        // rg exit code 0 = found matches, 1 = no matches, 2+ = error
        if (code !== null && code > 1) {
          // rg errored — use native fallback
          console.log(`[search] rg exited with code ${code}, falling back to native search`);
          return nativeSearch(cwd, query, { caseSensitive, wholeWord, useRegex }, maxResults, res);
        }
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
        // rg not found — fallback to Node.js native search
        return nativeSearch(cwd, query, { caseSensitive, wholeWord, useRegex }, maxResults, res);
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
}

// ── Native cross-platform search (fallback when rg is unavailable or errors) ──

async function nativeSearch(cwd, query, opts, maxResults, res) {
  const { readdirSync, statSync } = await import("fs");
  const fileMap = new Map();
  const maxDepth = 10;
  const ignoreDirs = new Set([".git", "node_modules", "dist", "build", ".next", "__pycache__", ".paaw", ".cache"]);
  const { caseSensitive, wholeWord, useRegex } = opts;

  function walkDir(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (ignoreDirs.has(entry.name)) continue;
          walkDir(join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          try {
            const fullPath = join(dir, entry.name);
            const stat = statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // skip > 1MB
            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            const isBinary = /\0/.test(content.slice(0, 8000));
            if (isBinary) continue;
            const matches = [];
            let searchStr = query;
            let flags = "g";
            if (!caseSensitive) flags += "i";
            if (!useRegex) searchStr = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            if (wholeWord) searchStr = `\\b${searchStr}\\b`;
            const re = new RegExp(searchStr, flags);
            for (let i = 0; i < lines.length && matches.length < 20; i++) {
              if (re.test(lines[i])) {
                matches.push({ line: i + 1, content: lines[i].trimEnd(), before: 0, after: 0 });
                re.lastIndex = 0;
              }
            }
            if (matches.length > 0) {
              fileMap.set(fullPath, { path: fullPath, filename: entry.name, matches });
            }
          } catch {}
        }
      }
    } catch {}
  }

  try {
    walkDir(cwd, 0);
    const allResults = Array.from(fileMap.values()).sort((a, b) => b.matches.length - a.matches.length);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: allResults.slice(0, maxResults), total: allResults.reduce((s, f) => s + f.matches.length, 0), truncated: false }));
  } catch (err) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: [], error: "search failed: " + err.message, total: 0, truncated: false }));
  }
}

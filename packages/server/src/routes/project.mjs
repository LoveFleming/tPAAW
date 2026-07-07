/**
 * Project Route — .paaw/ project knowledge API
 *
 * Endpoints:
 *   GET    /api/coding-project/context?path=...        — Get full .paaw/ context
 *   POST   /api/coding-project/init?path=...           — Initialize .paaw/ directory
 *   GET    /api/coding-project/tree?path=...           — Get .paaw/ directory tree
 *   GET    /api/coding-project/sessions?path=...       — List sessions
 *   GET    /api/coding-project/sessions/:filename?path=... — Read specific session
 *   GET    /api/coding-project/standards?path=...      — List standards
 *   GET    /api/coding-project/standards/:name?path=...— Read standard
 *   PUT    /api/coding-project/standards/:name?path=...— Write standard
 *   GET    /api/coding-project/decisions?path=...      — Read decisions
 *   POST   /api/coding-project/decisions?path=...      — Add decision
 *   GET    /api/coding-project/changelog?path=...      — Read changelog
 *   GET    /api/coding-project/file?path=...&file=...  — Read any .paaw/ file
 *   PUT    /api/coding-project/file?path=...&file=...  — Write any .paaw/ file
 *   POST   /api/coding-project/generate-overview?path=... — Auto-generate PROJECT.md
 */

import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { exec as execCb } from "child_process";
import { createPaawProject } from "../lib/paaw-project.mjs";
import { callLLMWithRetry } from "../lib/llm-utils.mjs";

// ── Query parser ──

function parseQuery(url) {
  const u = new URL(url, "http://localhost");
  const params = {};
  u.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

// ── Route Handler ──

export default async function projectRoute(req, res) {
  const method = req.method;
  const url = req.url || "";
  const q = parseQuery(url);

  // All routes start with /api/coding-project
  if (!url.startsWith("/api/coding-project")) return false;

  const projectPath = q.path;
  if (!projectPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
    return true;
  }

  const root = resolve(projectPath);
  const paaw = createPaawProject(root);

  try {
    // ── GET /api/coding-project/context ──
    if (url.startsWith("/api/coding-project/context") && method === "GET") {
      const ctx = await paaw.loadContext();
      if (!ctx) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized", initialized: false }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, ...ctx }));
      return true;
    }

    // ── POST /api/coding-project/init ──
    if (url.startsWith("/api/coding-project/init") && method === "POST") {
      const result = await paaw.init();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/tree ──
    if (url.startsWith("/api/coding-project/tree") && method === "GET") {
      const tree = await paaw.listTree();
      if (!tree) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: ".paaw/ not initialized" }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return true;
    }

    // ── GET /api/coding-project/sessions/:filename ──
    const sessionMatch = url.match(/^\/api\/project\/sessions\/([^?]+)/);
    if (sessionMatch && method === "GET") {
      const content = await paaw.readSession(decodeURIComponent(sessionMatch[1]));
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── GET /api/coding-project/sessions ──
    if (url.startsWith("/api/coding-project/sessions") && method === "GET") {
      const sessions = await paaw.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return true;
    }

    // ── GET /api/coding-project/standards ──
    if (url.startsWith("/api/coding-project/standards") && !url.match(/\/api\/project\/standards\/[^?]+/) && method === "GET") {
      const standards = await paaw.listStandards();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(standards));
      return true;
    }

    // ── GET/PUT /api/coding-project/standards/:name ──
    const stdMatch = url.match(/^\/api\/project\/standards\/([^?]+)/);
    if (stdMatch) {
      const name = decodeURIComponent(stdMatch[1]);
      if (method === "GET") {
        const content = await paaw.readStandard(name);
        if (content === null) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Standard not found" }));
        } else {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(content);
        }
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req);
        const result = await paaw.writeStandard(name, body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return true;
      }
    }

    // ── GET /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "GET") {
      const content = await paaw.readFile("DECISIONS.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── POST /api/coding-project/decisions ──
    if (url.startsWith("/api/coding-project/decisions") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const result = await paaw.addDecision(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── GET /api/coding-project/changelog ──
    if (url.startsWith("/api/coding-project/changelog") && method === "GET") {
      const content = await paaw.readFile("CHANGELOG.md");
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content || "");
      return true;
    }

    // ── GET /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "GET" && q.file) {
      const content = await paaw.readFile(q.file);
      if (content === null) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      } else {
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      }
      return true;
    }

    // ── PUT /api/coding-project/file ──
    if (url.startsWith("/api/coding-project/file") && method === "PUT" && q.file) {
      const body = await readBody(req);
      const result = await paaw.writeFile(q.file, body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── POST /api/coding-project/generate-overview ──
    if (url.startsWith("/api/coding-project/generate-overview") && method === "POST") {
      // Ensure .paaw/ exists first
      if (!paaw.exists) await paaw.init();
      const content = await paaw.generateProjectOverview();
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(content);
      return true;
    }

    // ── GET /api/coding-project/templates ──
    if (url.startsWith("/api/coding-project/templates") && method === "GET") {
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      const templates = [];
      try {
        const entries = await readdir(templatesDir);
        for (const name of entries.filter(f => f.endsWith(".md")).sort()) {
          const content = await readFile(join(templatesDir, name), "utf-8");
          // Extract title from first heading
          const titleLine = content.split("\n").find(l => l.startsWith("# "));
          const title = titleLine ? titleLine.replace(/^#\s*/, "") : name.replace(".md", "");
          templates.push({ name, title, preview: content.slice(0, 200) });
        }
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(templates));
      return true;
    }

    // ── GET /api/coding-project/templates/:name ──
    const tplMatch = url.match(/^\/api\/project\/templates\/([^?]+)/);
    if (tplMatch && method === "GET") {
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      const name = decodeURIComponent(tplMatch[1]);
      const filePath = join(templatesDir, name);
      try {
        const content = await readFile(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/markdown" });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/import-template ──
    if (url.startsWith("/api/coding-project/import-template") && method === "POST") {
      const body = JSON.parse(await readBody(req));
      const templateName = body.template; // e.g. "typescript.md"
      const targetName = body.target || templateName; // save as
      if (!templateName) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'template' field" }));
        return true;
      }
      const templatesDir = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "templates", "standards"));
      try {
        const content = await readFile(join(templatesDir, templateName), "utf-8");
        // Ensure .paaw/ exists
        if (!paaw.exists) await paaw.init();
        await paaw.writeStandard(targetName, content);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: targetName, size: content.length }));
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Template not found" }));
      }
      return true;
    }

    // ── POST /api/coding-project/generate-standards ──
    // Uses LLM to analyze codebase and generate coding standards
    if (url.startsWith("/api/coding-project/generate-standards") && method === "POST") {
      if (!paaw.exists) await paaw.init();
      const generated = await generateStandardsFromCodebase(root);
      if (generated) {
        await paaw.writeStandard("auto-generated.md", generated);
      }
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(generated || "# Failed to generate standards");
      return true;
    }

    // ── GET /api/coding-project/all ──
    // Returns everything needed for the right-panel tabs in one call
    if (url.startsWith("/api/coding-project/all") && method === "GET") {
      if (!paaw.exists) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ initialized: false }));
        return true;
      }
      const [context, sessions, standards, decisions, changelog] = await Promise.all([
        paaw.loadContext(),
        paaw.listSessions(),
        paaw.listStandards(),
        paaw.readFile("DECISIONS.md"),
        paaw.readFile("CHANGELOG.md"),
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        initialized: true,
        context,
        sessions,
        standards,
        decisions,
        changelog,
      }));
      return true;
    }

    // ── GET /api/coding-project/health ──
    if (url.startsWith("/api/coding-project/health") && method === "GET") {
      const health = await collectProjectHealth(root, paaw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return true;
    }

    // ── Snapshot endpoints ──

    // POST /api/coding-project/snapshot — create manual snapshot
    if (url.startsWith("/api/coding-project/snapshot") && method === "POST" && !url.includes("/restore")) {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      if (!paaw.exists) await paaw.init();
      const body = JSON.parse(await readBody(req) || "{}");
      const result = await snap.create(body.label || "manual");
      await snap.cleanup(50);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // GET /api/coding-project/snapshots — list snapshots
    if (url.startsWith("/api/coding-project/snapshots") && method === "GET") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const list = await snap.list();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return true;
    }

    // POST /api/coding-project/snapshot/restore — restore file from snapshot
    if (url.startsWith("/api/coding-project/snapshot/restore") && method === "POST") {
      const { PaawSnapshot } = await import("../lib/paaw-snapshot.mjs");
      const snap = new PaawSnapshot(root, paaw.paawDir);
      const body = JSON.parse(await readBody(req));
      const result = await snap.restoreFile(body.snapshot, body.file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return true;
    }

    // ── Git tracking strategy ──

    // GET /api/coding-project/git-strategy — get .paaw gitignore status
    if (url.startsWith("/api/coding-project/git-strategy") && method === "GET") {
      const gitignorePath = join(root, ".gitignore");
      let paawTracked = true;
      let gitignoreContent = "";
      if (existsSync(gitignorePath)) {
        gitignoreContent = readSync(gitignorePath, "utf-8");
        paawTracked = !gitignoreContent.includes(".paaw/");
      }
      // Check if .paaw/ is already committed
      let committed = false;
      try {
        const check = await runShellCmd(`git ls-files .paaw/`, root, 5000);
        committed = check.trim().length > 0;
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ paawTracked, committed, gitignoreHasPaaw: !paawTracked }));
      return true;
    }

    // PUT /api/coding-project/git-strategy — set strategy
    if (url.startsWith("/api/coding-project/git-strategy") && method === "PUT") {
      const body = JSON.parse(await readBody(req));
      const strategy = body.strategy; // "track" | "ignore" | "branch"
      const gitignorePath = join(root, ".gitignore");
      let gitignoreContent = existsSync(gitignorePath) ? readSync(gitignorePath, "utf-8") : "";

      if (strategy === "ignore") {
        if (!gitignoreContent.includes(".paaw/")) {
          gitignoreContent = gitignoreContent.trimEnd() + "\n# PAAW AI-Native IDE\n.paaw/\n";
          await writeFile(gitignorePath, gitignoreContent, "utf-8");
        }
      } else if (strategy === "track") {
        // Remove .paaw/ from gitignore if present
        gitignoreContent = gitignoreContent
          .replace(/^\.paaw\/$/gm, "")
          .replace(/^# PAAW AI-Native IDE$/gm, "")
          .replace(/\n{3,}/g, "\n\n");
        await writeFile(gitignorePath, gitignoreContent, "utf-8");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, strategy }));
      return true;
    }

    // ── Recent projects (multi-project) ──

    // GET /api/coding-project/recent — list recently opened projects
    if (url.startsWith("/api/coding-project/recent") && method === "GET") {
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // DELETE /api/coding-project/recent — remove a project from recent list
    if (url.startsWith("/api/coding-project/recent") && method === "DELETE") {
      const params = new URL(req.url, "http://localhost").searchParams;
      const removePath = params.get("path");
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}
      if (removePath) {
        recent = recent.filter(r => r.path !== removePath);
        await mkdir(dirname(recentPath), { recursive: true });
        await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

    // POST /api/coding-project/recent — add/update recent project
    if (url.startsWith("/api/coding-project/recent") && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const recentPath = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "data", "config", "recent-projects.json");
      let recent = [];
      try {
        if (existsSync(recentPath)) recent = JSON.parse(readSync(recentPath, "utf-8"));
      } catch {}

      // Add or update
      const path = body.path || root;
      const name = body.name || path.split("/").pop();
      recent = recent.filter(r => r.path !== path);
      recent.unshift({ path, name, lastOpened: new Date().toISOString(), hasPaaw: existsSync(join(path, ".paaw")) });
      recent = recent.slice(0, 20); // keep last 20

      await mkdir(dirname(recentPath), { recursive: true });
      await writeFile(recentPath, JSON.stringify(recent, null, 2), "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(recent));
      return true;
    }

  } catch (err) {
    console.error("[project route] error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return true;
  }

  return false;
}

// ── Read request body ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Generate Standards from Codebase ──

async function generateStandardsFromCodebase(projectRoot) {
  // 1. Gather codebase info
  const samples = [];
  const root = projectRoot;

  // Read package.json
  try {
    const pkg = JSON.parse(readSync(join(root, "package.json"), "utf-8"));
    samples.push(`package.json scripts: ${JSON.stringify(pkg.scripts || {})}`);
    samples.push(`dependencies: ${Object.keys(pkg.dependencies || {}).join(", ")}`);
    samples.push(`devDependencies: ${Object.keys(pkg.devDependencies || {}).join(", ")}`);
  } catch {}

  // Read a few source files as samples
  const sourcePatterns = [
    "packages/server/src/lib/*.mjs",
    "packages/ui/src/pages/*.tsx",
    "packages/ui/src/components/*.tsx",
  ];

  for (const pattern of sourcePatterns) {
    try {
      const { glob } = await import("fs/promises");
      // Use readdir as fallback
      const dir = join(root, pattern.replace(/\/[^/]+$/, ""));
      const ext = pattern.match(/\*\.(.+)$/)?.[1] || "mjs";
      if (existsSync(dir)) {
        const files = await readdir(dir);
        const matching = files.filter(f => f.endsWith(`.${ext}`)).slice(0, 3);
        for (const f of matching) {
          const content = readSync(join(dir, f), "utf-8");
          samples.push(`--- ${f} (first 600 chars) ---\n${content.slice(0, 600)}`);
        }
      }
    } catch {}
  }

  if (samples.length === 0) return null;

  // 2. Build prompt
  const prompt = `Analyze the following codebase samples and generate a comprehensive Coding Standards document in Markdown format.
Focus on:
1. File naming conventions used
2. Code style (indentation, quotes, semicolons)
3. Error handling patterns
4. Export patterns (ESM vs CJS)
5. Framework-specific conventions (React, Node.js)
6. Any existing patterns that should be standardized

Codebase samples:

${samples.join("\n\n")}

Output ONLY the markdown document, starting with # Coding Standards (Auto-Generated).`;

  // 3. Call LLM
  try {
    const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "..", "..");
    const result = await callLLMWithRetry(rootDir, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
    });
    return result.content || null;
  } catch (err) {
    console.error("[project route] generate-standards error:", err.message);
    return null;
  }
}

// ── Shell helper ──

function runShellCmd(command, cwd, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execCb(command, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" }
    }, (err, stdout, stderr) => {
      resolve((stdout || "") + (stderr ? "\n" + stderr : ""));
    });
  });
}

// ── Collect Project Health ──

async function collectProjectHealth(root, paaw) {
  const health = {
    paawCompleteness: { initialized: paaw.exists, files: [], score: 0 },
    git: { branch: "", uncommitted: 0 },
    codeStats: { totalFiles: 0, totalLines: 0, languages: [] },
    sessions: { total: 0, recent: 0, successRate: 0 },
    dependencies: undefined,
  };

  // ── .paaw/ completeness ──
  const expectedFiles = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CHANGELOG.md", "CODING-STANDARDS.md"];
  let existCount = 0;
  for (const f of expectedFiles) {
    const content = await paaw.readFile(f);
    const exists = content !== null;
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: f, exists, size: exists ? content.length : undefined });
  }
  // Check subdirs
  for (const d of ["sessions", "standards"]) {
    const dirPath = join(paaw.paawDir, d);
    const exists = existsSync(dirPath);
    if (exists) existCount++;
    health.paawCompleteness.files.push({ name: d + "/", exists });
  }
  health.paawCompleteness.score = Math.round((existCount / (expectedFiles.length + 2)) * 100);

  // ── Git health ──
  try {
    const branch = (await runShellCmd("git rev-parse --abbrev-ref HEAD", root, 3000)).trim();
    const status = await runShellCmd("git status --porcelain", root, 5000);
    const uncommitted = status.trim().split("\n").filter(Boolean).length;
    const logLine = (await runShellCmd("git log -1 --oneline --format=%h___%s___%cr", root, 3000)).trim();
    const remote = (await runShellCmd("git remote get-url origin", root, 3000)).trim();

    const [hash, ...rest] = logLine.split("___");
    const subject = rest[0] || "";
    const when = rest[1] || "";

    health.git = {
      branch,
      uncommitted,
      lastCommit: subject ? `${hash} ${subject}` : undefined,
      lastCommitDate: when || undefined,
      remote: remote || undefined,
    };
  } catch {}

  // ── Code stats ──
  try {
    const gitFiles = (await runShellCmd("git ls-files", root, 5000)).trim().split("\n").filter(Boolean);
    health.codeStats.totalFiles = gitFiles.length;

    // Count lines and languages
    const langCount = {};
    let totalLines = 0;
    const extMap = { ".js": "JavaScript", ".mjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript", ".css": "CSS", ".html": "HTML", ".json": "JSON", ".md": "Markdown", ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".c": "C", ".cpp": "C++" };

    // Sample up to 500 files for performance
    const sample = gitFiles.slice(0, 500);
    for (const f of sample) {
      const ext = "." + (f.split(".").pop() || "");
      const lang = extMap[ext];
      if (lang) {
        langCount[lang] = (langCount[lang] || 0) + 1;
        try {
          const content = readSync(join(root, f), "utf-8");
          totalLines += content.split("\n").length;
        } catch {}
      } else if (!ext.includes("/")) {
        langCount[ext] = (langCount[ext] || 0) + 1;
      }
    }

    health.codeStats.totalLines = totalLines;

    // Language percentages
    const totalLangFiles = Object.values(langCount).reduce((a, b) => a + b, 0);
    health.codeStats.languages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => ({ lang, files: count, percent: Math.round((count / totalLangFiles) * 100) }));
  } catch {}

  // ── AI Sessions ──
  try {
    const sessions = await paaw.listSessions();
    health.sessions.total = sessions.length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    health.sessions.recent = sessions.filter(s => new Date(s.modified).getTime() > sevenDaysAgo).length;

    // Calculate success rate from session content
    let successCount = 0;
    let checked = 0;
    for (const s of sessions.slice(0, 20)) {
      try {
        const content = await paaw.readSession(s.filename);
        if (content) {
          checked++;
          if (content.includes("✅ 成功")) successCount++;
        }
      } catch {}
    }
    health.sessions.successRate = checked > 0 ? Math.round((successCount / checked) * 100) : 0;
  } catch {}

  // ── Dependencies ──
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readSync(pkgPath, "utf-8"));
      const total = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
      health.dependencies = { total };
    }
  } catch {}

  return health;
}

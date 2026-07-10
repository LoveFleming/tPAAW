/**
 * PaawProject — .paaw/ project knowledge directory manager
 *
 * Manages the AI-native project knowledge base:
 *   .paaw/
 *   ├── PROJECT.md
 *   ├── ARCHITECTURE.md
 *   ├── DECISIONS.md
 *   ├── CHANGELOG.md
 *   ├── CODING-STANDARDS.md
 *   ├── CONTEXT.md
 *   ├── sessions/
 *   ├── api-logs/
 *   ├── standards/
 *   ├── prompts/
 *   └── snapshots/
 *
 * Used by Agent Loop to inject project context, and by API routes for CRUD.
 */

import { readFile, writeFile, readdir, stat, mkdir, appendFile } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { exec as execCb } from "child_process";

// ── Helpers ──

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
}

function runShell(command, cwd, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execCb(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", TERM: "dumb" },
    }, (err, stdout, stderr) => {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;
      if (err && err.code) output += (output ? "\n" : "") + `Exit code: ${err.code}`;
      resolve(output || "");
    });
  });
}

// ── PaawProject Class ──

export class PaawProject {
  constructor(projectRoot) {
    this.root = projectRoot;
    this.paawDir = join(projectRoot, ".paaw");
  }

  // ── Existence check ──

  get exists() {
    return existsSync(this.paawDir);
  }

  // ── Initialization ──

  async init() {
    const subDirs = ["sessions", "api-logs", "standards", "prompts", "snapshots", "specs", "test-payloads", "runbook", "helpdesk"];
    for (const sub of subDirs) {
      const dir = join(this.paawDir, sub);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    }

    // Create default files if they don't exist
    const defaults = [
      { file: "PROJECT.md", content: DEFAULT_PROJECT_MD },
      { file: "DECISIONS.md", content: DEFAULT_DECISIONS_MD },
      { file: "CHANGELOG.md", content: DEFAULT_CHANGELOG_MD },
      { file: "CODING-STANDARDS.md", content: DEFAULT_STANDARDS_MD },
    ];

    for (const { file, content } of defaults) {
      const filePath = join(this.paawDir, file);
      if (!existsSync(filePath)) await writeFile(filePath, content, "utf-8");
    }

    return { ok: true, dir: this.paawDir };
  }

  // ── Read single file ──

  async readFile(name) {
    const filePath = join(this.paawDir, name);
    if (!existsSync(filePath)) return null;
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  // ── Write single file ──

  async writeFile(name, content) {
    const filePath = join(this.paawDir, name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    return { ok: true, path: filePath };
  }

  // ── Load full context for AI injection ──

  async loadContext() {
    if (!this.exists) return null;

    const [project, architecture, decisions, changelog, standards] = await Promise.all([
      this.readFile("PROJECT.md"),
      this.readFile("ARCHITECTURE.md"),
      this.readFile("DECISIONS.md"),
      this.readFile("CHANGELOG.md"),
      this.loadStandards(),
    ]);

    const recentSessions = await this.loadRecentSessions(3);

    return {
      project,
      architecture,
      decisions,
      changelog,
      standards,
      recentSessions,
    };
  }

  // ── Load context as text for system prompt injection ──

  async loadContextText() {
    const ctx = await this.loadContext();
    if (!ctx) return "";

    const parts = [];

    if (ctx.project) {
      parts.push(`\n=== 專案概覽 (.paaw/PROJECT.md) ===\n${ctx.project}`);
    }
    if (ctx.standards) {
      parts.push(`\n=== Coding Standards (.paaw/CODING-STANDARDS.md + standards/) ===\n${ctx.standards}`);
    }
    if (ctx.decisions) {
      // Only include last ~2000 chars to keep prompt manageable
      const dec = ctx.decisions.length > 2000
        ? ctx.decisions.slice(-2000)
        : ctx.decisions;
      parts.push(`\n=== 近期技術決策 (.paaw/DECISIONS.md) ===\n${dec}`);
    }
    if (ctx.recentSessions && ctx.recentSessions.length > 0) {
      const sessionText = ctx.recentSessions
        .map(s => `- ${s.filename}: ${s.summary || "(no summary)"}`)
        .join("\n");
      parts.push(`\n=== 最近 AI Session 記錄 ===\n${sessionText}`);
    }

    return parts.join("\n");
  }

  // ── Standards ──

  async loadStandards() {
    // Main file
    const main = await this.readFile("CODING-STANDARDS.md");
    if (!main && !existsSync(join(this.paawDir, "standards"))) return null;

    // Sub-files
    const stdDir = join(this.paawDir, "standards");
    const parts = [];
    if (main) parts.push(main);

    if (existsSync(stdDir)) {
      try {
        const files = await readdir(stdDir);
        for (const f of files.filter(f => f.endsWith(".md")).sort()) {
          const content = await readFile(join(stdDir, f), "utf-8");
          parts.push(`\n--- ${f} ---\n${content}`);
        }
      } catch {}
    }

    return parts.length > 0 ? parts.join("\n") : null;
  }

  async listStandards() {
    const stdDir = join(this.paawDir, "standards");
    const result = [];
    if (!existsSync(stdDir)) return result;
    try {
      const files = await readdir(stdDir);
      for (const f of files.filter(f => f.endsWith(".md")).sort()) {
        const stat_ = await stat(join(stdDir, f));
        result.push({ name: f, size: stat_.size, modified: stat_.mtime.toISOString() });
      }
    } catch {}
    return result;
  }

  async readStandard(name) {
    return this.readFile(`standards/${name}`);
  }

  async writeStandard(name, content) {
    return this.writeFile(`standards/${name}`, content);
  }

  // ── Sessions ──

  async loadRecentSessions(count = 3) {
    const sessDir = join(this.paawDir, "sessions");
    if (!existsSync(sessDir)) return [];

    try {
      const files = await readdir(sessDir);
      const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse().slice(0, count);
      const sessions = [];

      for (const f of mdFiles) {
        const content = await readFile(join(sessDir, f), "utf-8");
        // Extract first heading or first line as summary
        const firstLine = content.split("\n").find(l => l.startsWith("# "));
        const summary = firstLine ? firstLine.replace(/^#\s*/, "") : f.replace(".md", "");
        sessions.push({ filename: f, summary, content });
      }

      return sessions;
    } catch {
      return [];
    }
  }

  async listSessions() {
    const sessDir = join(this.paawDir, "sessions");
    if (!existsSync(sessDir)) return [];
    try {
      const files = await readdir(sessDir);
      const sessions = [];
      for (const f of files.filter(f => f.endsWith(".md")).sort().reverse()) {
        const stat_ = await stat(join(sessDir, f));
        sessions.push({ filename: f, modified: stat_.mtime.toISOString(), size: stat_.size });
      }
      return sessions;
    } catch {
      return [];
    }
  }

  async readSession(filename) {
    return this.readFile(`sessions/${filename}`);
  }

  // ── Record Session (called after Agent Loop completes) ──

  async recordSession(sessionData) {
    const sessDir = join(this.paawDir, "sessions");
    await mkdir(sessDir, { recursive: true });

    // ── Capture git diff stats ──
    let gitDiff = null;
    try {
      const status = await runShell("git status --porcelain", this.root, 5000);
      const diffStat = await runShell("git diff --stat", this.root, 5000);
      const diffCached = await runShell("git diff --cached --stat", this.root, 5000);
      if (status.trim() || diffStat.trim() || diffCached.trim()) {
        gitDiff = { status: status.trim(), diffStat: (diffStat + diffCached).trim() };
      }
    } catch {}

    // ── Capture branch ──
    let gitBranch = "";
    try {
      gitBranch = (await runShell("git rev-parse --abbrev-ref HEAD", this.root, 3000)).trim();
    } catch {}

    const enrichedData = { ...sessionData, gitDiff, gitBranch };

    const dateStr = today();
    const slug = slugify(sessionData.task || sessionData.prompt || "task");
    const filename = `${dateStr}-${slug}.md`;
    const content = this._renderSessionMd(enrichedData, dateStr);

    await writeFile(join(sessDir, filename), content, "utf-8");
    return { filename, path: join(sessDir, filename) };
  }

  _renderSessionMd(data, dateStr) {
    const lines = [];
    lines.push(`# ${data.task || data.prompt || "Session"}`);
    lines.push("");
    lines.push(`**日期**: ${dateStr}`);
    lines.push(`**耗時**: ${data.durationMs ? Math.round(data.durationMs / 1000) : "?"}s`);
    lines.push(`**結果**: ${data.success ? "✅ 成功" : "❌ 失敗"}`);
    if (data.gitBranch) lines.push(`**分支**: \`${data.gitBranch}\``);
    lines.push("");

    // Task
    if (data.prompt) {
      lines.push("## 任務");
      lines.push("");
      lines.push(data.prompt);
      lines.push("");
    }

    // Tool calls summary
    if (data.toolCalls && data.toolCalls.length > 0) {
      lines.push("## AI 操作步驟");
      lines.push("");
      // Group by tool name
      const byName = {};
      for (const tc of data.toolCalls) {
        byName[tc.name] = (byName[tc.name] || 0) + 1;
      }
      for (const [name, count] of Object.entries(byName)) {
        lines.push(`${count}× ${name}`);
      }

      // File changes
      const fileOps = data.toolCalls.filter(tc =>
        tc.name === "write_file" || tc.name === "edit_file"
      );
      if (fileOps.length > 0) {
        lines.push("");
        lines.push("### 變更檔案");
        const files = new Set();
        for (const op of fileOps) {
          try {
            const args = JSON.parse(op.args);
            if (args.path) files.add(args.path);
          } catch {}
        }
        for (const f of [...files].sort()) {
          lines.push(`- \`${f}\``);
        }
      }

      lines.push("");
    }

    // Git diff analysis
    if (data.gitDiff) {
      lines.push("## Git 變更分析");
      lines.push("");
      if (data.gitDiff.status) {
        lines.push("### Status");
        lines.push("```");
        lines.push(data.gitDiff.status);
        lines.push("```");
        lines.push("");
      }
      if (data.gitDiff.diffStat) {
        lines.push("### Diff Stat");
        lines.push("```");
        lines.push(data.gitDiff.diffStat);
        lines.push("```");
        lines.push("");
      }
    }

    // AI response
    if (data.content) {
      lines.push("## AI 回覆");
      lines.push("");
      lines.push(data.content.slice(0, 2000));
      if (data.content.length > 2000) lines.push("\n... (truncated)");
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Changelog ──

  async appendChangelog(entry) {
    const cl = join(this.paawDir, "CHANGELOG.md");
    const existing = existsSync(cl) ? await readFile(cl, "utf-8") : DEFAULT_CHANGELOG_MD;

    const dateStr = today();
    const lines = existing.split("\n");

    // Find or create today's section
    let insertIndex = lines.findIndex(l => l === `## ${dateStr}`);
    if (insertIndex === -1) {
      // Insert after "# Changelog" header
      const headerEnd = lines.findIndex(l => l.startsWith("# "));
      insertIndex = headerEnd + 1;

      const newSection = [``, `## ${dateStr}`, ``];
      lines.splice(insertIndex, 0, ...newSection);
      insertIndex += 2; // now points to the empty line after ## date
    } else {
      // Move to end of this date's section
      let i = insertIndex + 1;
      while (i < lines.length && !lines[i].startsWith("## ")) i++;
      insertIndex = i;
    }

    // Insert entry
    const category = entry.type || "changed"; // added, fixed, changed, deprecated
    const newLines = [`### ${category}`, `- ${entry.description}`, ""];
    lines.splice(insertIndex, 0, ...newLines);

    await writeFile(cl, lines.join("\n"), "utf-8");
    return { ok: true };
  }

  // ── Auto-generate Changelog from Session ──

  async generateChangelogFromSession(sessionData) {
    if (!sessionData.toolCalls || sessionData.toolCalls.length === 0) return null;

    // Extract changed files from tool calls
    const changedFiles = new Map(); // path -> { ops: Set, additions: 0, deletions: 0 }
    for (const tc of sessionData.toolCalls) {
      if (tc.name !== "write_file" && tc.name !== "edit_file") continue;
      try {
        const args = JSON.parse(tc.args);
        if (!args.path) continue;
        const rel = args.path.replace(this.root + "/", "");
        if (!changedFiles.has(rel)) {
          changedFiles.set(rel, { ops: new Set(), isNew: false });
        }
        const entry = changedFiles.get(rel);
        entry.ops.add(tc.name);
        if (tc.name === "write_file" && sessionData.toolCalls.filter(t => t.name === "write_file").indexOf(tc) === 0) {
          entry.isNew = true; // rough heuristic
        }
      } catch {}
    }

    // Try to get actual git diff for accuracy
    let gitAdded = 0, gitDeleted = 0;
    let fileStats = [];
    try {
      const diffStat = await runShell("git diff --stat --numstat", this.root, 5000);
      for (const line of diffStat.trim().split("\n").filter(Boolean)) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const added = parseInt(parts[0]) || 0;
          const deleted = parseInt(parts[1]) || 0;
          const file = parts[2];
          gitAdded += added;
          gitDeleted += deleted;
          fileStats.push({ file, added, deleted });
        }
      }
    } catch {}

    // Build changelog entries
    const entries = [];
    const newFiles = [];
    const modifiedFiles = [];

    for (const [file, info] of changedFiles) {
      if (info.isNew) newFiles.push(file);
      else modifiedFiles.push(file);
    }

    // Categorize changes
    const task = sessionData.task || sessionData.prompt || "code changes";
    const taskLower = task.toLowerCase();

    let category = "changed";
    if (/fix|bug|修復|修正/.test(taskLower)) category = "fixed";
    else if (/add|new|新增|create/.test(taskLower)) category = "added";
    else if (/refactor|重構/.test(taskLower)) category = "changed";
    else if (/remove|delete|移除/.test(taskLower)) category = "removed";

    // Build description
    let desc = task.slice(0, 80);
    if (newFiles.length > 0) desc += ` (${newFiles.length} new file${newFiles.length > 1 ? "s" : ""})`;
    if (modifiedFiles.length > 0) desc += ` (${modifiedFiles.length} modified)`;

    entries.push({ type: category, description: desc });

    // Add file-level details
    if (fileStats.length > 0) {
      const totalLine = `+${gitAdded} −${gitDeleted} lines across ${fileStats.length} file${fileStats.length > 1 ? "s" : ""}`;
      entries.push({ type: "changed", description: totalLine });
    }

    // Write to changelog
    for (const entry of entries) {
      await this.appendChangelog(entry);
    }

    return { entries, changedFiles: [...changedFiles.keys()], gitAdded, gitDeleted };
  }

  // ── Decision Records ──

  async addDecision(decision) {
    const df = join(this.paawDir, "DECISIONS.md");
    const existing = existsSync(df) ? await readFile(df, "utf-8") : DEFAULT_DECISIONS_MD;

    // Count existing ADRs
    const adrCount = (existing.match(/## ADR-\d+/g) || []).length;
    const adrNum = String(adrCount + 1).padStart(3, "0");
    const dateStr = today();

    const entry = [
      "",
      `## ADR-${adrNum}: ${decision.title || "Untitled Decision"}`,
      `- **日期**: ${dateStr}`,
      `- **狀態**: ${decision.status || "Proposed"}`,
    ];

    if (decision.context) entry.push(`- **背景**: ${decision.context}`);
    if (decision.decision) entry.push(`- **決定**: ${decision.decision}`);
    if (decision.consequences) entry.push(`- **後果**: ${decision.consequences}`);

    entry.push("");

    const newContent = existing.trimEnd() + "\n" + entry.join("\n") + "\n";
    await writeFile(df, newContent, "utf-8");
    return { adrNum, path: df };
  }

  // ── API Logs ──

  async logApiCall(logEntry) {
    const logDir = join(this.paawDir, "api-logs");
    await mkdir(logDir, { recursive: true });

    const filename = `${today()}-${Date.now()}.json`;
    const filepath = join(logDir, filename);
    await writeFile(filepath, JSON.stringify({ ...logEntry, ts: new Date().toISOString() }, null, 2), "utf-8");
    return { filename, path: filepath };
  }

  // ── Auto-generate PROJECT.md ──

  async generateProjectOverview() {
    const root = this.root;

    // Read package.json if exists
    let pkg = null;
    try {
      const pkgPath = join(root, "package.json");
      if (existsSync(pkgPath)) pkg = JSON.parse(readSync(pkgPath, "utf-8"));
    } catch {}

    // List top-level directories
    let topDirs = [];
    try {
      const entries = await readdir(root);
      topDirs = entries.filter(e =>
        !e.startsWith(".") && !["node_modules", "dist", "build", ".git"].includes(e)
      );
    } catch {}

    // Get git remote
    let gitRemote = "";
    try {
      gitRemote = await runShell("git remote get-url origin", root, 5000);
      gitRemote = gitRemote.trim();
    } catch {}

    const lines = [];
    lines.push("# Project Overview");
    lines.push("");
    lines.push(`**Name**: ${pkg?.name || root.split("/").pop()}`);
    lines.push(`**Path**: ${root}`);
    lines.push(`**Git**: ${gitRemote || "(no remote)"}`);
    lines.push("");

    if (pkg) {
      lines.push("## 技術棧");
      lines.push("");
      if (pkg.description) lines.push(`> ${pkg.description}`);
      lines.push("");

      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      if (deps.length > 0) {
        lines.push("**Dependencies**:");
        for (const d of deps.slice(0, 20)) lines.push(`- ${d}`);
        if (deps.length > 20) lines.push(`- ... (${deps.length - 20} more)`);
      }
      if (devDeps.length > 0) {
        lines.push("");
        lines.push("**Dev Dependencies**:");
        for (const d of devDeps.slice(0, 15)) lines.push(`- ${d}`);
        if (devDeps.length > 15) lines.push(`- ... (${devDeps.length - 15} more)`);
      }
      lines.push("");

      // Scripts
      const scripts = Object.keys(pkg.scripts || {});
      if (scripts.length > 0) {
        lines.push("## 啟動方式");
        lines.push("");
        for (const s of scripts.slice(0, 10)) {
          lines.push(`- \`npm run ${s}\` → ${pkg.scripts[s]}`);
        }
      }
    }

    lines.push("");
    lines.push("## 專案結構");
    lines.push("");
    lines.push("```");
    for (const d of topDirs) {
      lines.push(`${d}/`);
    }
    lines.push("```");
    lines.push("");
    lines.push("> 本文件由 PAAW AI-Native IDE 自動生成，可手動編輯補充。");

    const content = lines.join("\n");
    await this.writeFile("PROJECT.md", content);
    return content;
  }

  // ── Code Status Dashboard Scores ──

  async computeStatus() {
    if (!this.exists) return null;

    const scores = {
      architecture: { score: 0, items: [] },
      api: { score: 0, items: [] },
      test: { score: 0, items: [] },
      docs: { score: 0, items: [] },
      maintainability: { score: 0, items: [] },
    };

    // ════════ 🏗️ Architecture Health ════════
    const archItems = [];
    let archPoints = 0;

    const projectMd = await this.readFile("PROJECT.md");
    if (projectMd && !projectMd.includes("(auto-detect)") && projectMd.length > 100) {
      archPoints += 25;
      archItems.push({ name: "PROJECT.md", status: "ok", detail: "Filled" });
    } else if (projectMd) {
      archPoints += 10;
      archItems.push({ name: "PROJECT.md", status: "warn", detail: "Template only" });
    } else {
      archItems.push({ name: "PROJECT.md", status: "missing", detail: "Missing" });
    }

    const architectureMd = await this.readFile("ARCHITECTURE.md");
    if (architectureMd && architectureMd.length > 200) {
      archPoints += 35;
      archItems.push({ name: "Architecture Map", status: "ok", detail: `${architectureMd.length} chars` });
    } else {
      archItems.push({ name: "Architecture Map", status: "missing", detail: "Run Code Understanding" });
    }

    const decisionsMd = await this.readFile("DECISIONS.md");
    const adrCount = (decisionsMd || "").match(/## ADR-\d+/g)?.length || 0;
    if (adrCount >= 3) {
      archPoints += 25;
      archItems.push({ name: "Decision Records", status: "ok", detail: `${adrCount} ADRs` });
    } else if (adrCount > 0) {
      archPoints += 15;
      archItems.push({ name: "Decision Records", status: "warn", detail: `Only ${adrCount} ADRs` });
    } else {
      archItems.push({ name: "Decision Records", status: "missing", detail: "No ADRs" });
    }

    // Entry point clarity
    try {
      const pkgExists = existsSync(join(this.root, "package.json"));
      if (pkgExists) {
        archPoints += 15;
        archItems.push({ name: "Entry Points", status: "ok", detail: "package.json found" });
      } else {
        archItems.push({ name: "Entry Points", status: "warn", detail: "No package.json" });
      }
    } catch {}

    scores.architecture = { score: archPoints, items: archItems };

    // ════════ 📡 API Completeness ════════
    const apiItems = [];
    let apiPoints = 0;

    const apiSpec = await this.readFile("specs/api-contract.md");
    if (apiSpec && apiSpec.length > 100) {
      apiPoints += 35;
      apiItems.push({ name: "API Contract", status: "ok", detail: `${apiSpec.length} chars` });
    } else {
      apiItems.push({ name: "API Contract", status: "missing", detail: "Missing" });
    }

    const errorMapping = await this.readFile("specs/error-codes.md");
    if (errorMapping && errorMapping.length > 50) {
      apiPoints += 30;
      apiItems.push({ name: "Error Mapping", status: "ok", detail: "Defined" });
    } else {
      apiItems.push({ name: "Error Mapping", status: "missing", detail: "Missing" });
    }

    // Runbooks
    const rbDir = join(this.paawDir, "runbook");
    let rbCount = 0;
    if (existsSync(rbDir)) {
      try { const rbFiles = await readdir(rbDir); rbCount = rbFiles.filter(f => f.endsWith(".md")).length; } catch {}
    }
    if (rbCount > 0) {
      apiPoints += 20;
      apiItems.push({ name: "Runbooks", status: "ok", detail: `${rbCount} file(s)` });
    } else {
      apiItems.push({ name: "Runbooks", status: "missing", detail: "None" });
    }

    // API count
    let apiCount = 0;
    try {
      const routeCount = await runShell("grep -rc 'url.startsWith\\|if (url' --include='*.mjs' --include='*.js' --include='*.ts' packages/server/src/ 2>/dev/null | awk -F: '{s+=$2} END {print s}'", this.root, 5000);
      apiCount = parseInt(routeCount.trim()) || 0;
    } catch {}
    apiItems.push({ name: "API Endpoints", status: "info", detail: apiCount > 0 ? `~${apiCount} detected` : "Unknown" });
    apiPoints += 15;
    scores.api = { score: apiPoints, items: apiItems };

    // ════════ 🧪 Test Coverage ════════
    const testItems = [];
    let testPoints = 0;

    const tpDir = join(this.paawDir, "test-payloads");
    let tpCount = 0;
    if (existsSync(tpDir)) {
      try { const tpFiles = await readdir(tpDir); tpCount = tpFiles.filter(f => f.endsWith(".json")).length; } catch {}
    }
    if (tpCount > 0) {
      testPoints += 40;
      testItems.push({ name: "API Test Payloads", status: "ok", detail: `${tpCount} file(s)` });
    } else {
      testItems.push({ name: "API Test Payloads", status: "missing", detail: "Missing" });
    }

    let hasTests = false;
    let testFileCount = 0;
    try {
      const testCheck = await runShell("find . -name '*.test.*' -o -name '*.spec.*' 2>/dev/null | wc -l", this.root, 5000);
      testFileCount = parseInt(testCheck.trim()) || 0;
      hasTests = testFileCount > 0;
    } catch {}
    if (hasTests) {
      testPoints += 35;
      testItems.push({ name: "Unit Tests", status: "ok", detail: `${testFileCount} test file(s)` });
    } else {
      testItems.push({ name: "Unit Tests", status: "missing", detail: "None found" });
    }

    let hasE2E = false;
    try {
      const e2eCheck = await runShell("find . -maxdepth 1 -name 'playwright.config.*' -o -name 'cypress.config.*' 2>/dev/null", this.root, 3000);
      hasE2E = e2eCheck.trim().length > 0;
    } catch {}
    if (hasE2E) {
      testPoints += 25;
      testItems.push({ name: "E2E Tests", status: "ok", detail: "Configured" });
    } else {
      testItems.push({ name: "E2E Tests", status: "missing", detail: "Not configured" });
    }
    scores.test = { score: testPoints, items: testItems };

    // ════════ 📝 Documentation Quality ════════
    const docsItems = [];
    let docsPoints = 0;

    let readmeStatus = "missing";
    let readmeDetail = "Missing";
    try {
      const readmeCheck = await runShell("test -f README.md && echo yes || echo no", this.root, 3000);
      if (readmeCheck.trim() === "yes") {
        readmeStatus = "ok";
        docsPoints += 30;
        try {
          const readmeAge = await runShell("git log -1 --format='%ci' -- README.md 2>/dev/null", this.root, 3000);
          if (readmeAge.trim()) {
            const daysSince = Math.floor((Date.now() - new Date(readmeAge.trim()).getTime()) / 86400000);
            readmeDetail = daysSince > 90 ? `Outdated (${daysSince}d)` : `${daysSince}d ago`;
            if (daysSince > 90) { docsPoints -= 10; readmeStatus = "warn"; }
          } else { readmeDetail = "Exists"; }
        } catch { readmeDetail = "Exists"; }
      }
    } catch {}
    docsItems.push({ name: "README", status: readmeStatus, detail: readmeDetail });

    const faq = await this.readFile("helpdesk/faq.md");
    if (faq && faq.length > 50) {
      docsPoints += 30;
      docsItems.push({ name: "FAQ", status: "ok", detail: `${faq.length} chars` });
    } else {
      docsItems.push({ name: "FAQ", status: "missing", detail: "Missing" });
    }

    const changelog = await this.readFile("CHANGELOG.md");
    if (changelog && changelog.length > 100 && !changelog.includes("(自動生成)")) {
      docsPoints += 25;
      docsItems.push({ name: "Changelog", status: "ok", detail: "Has entries" });
    } else if (changelog) {
      docsPoints += 10;
      docsItems.push({ name: "Changelog", status: "warn", detail: "Template only" });
    } else {
      docsItems.push({ name: "Changelog", status: "missing", detail: "Missing" });
    }

    // Code stats (languages)
    try {
      const gitFiles = (await runShell("git ls-files 2>/dev/null | wc -l", this.root, 5000)).trim();
      const fileCount = parseInt(gitFiles) || 0;
      docsItems.push({ name: "Tracked Files", status: "info", detail: `${fileCount} files` });
      docsPoints += 15;
    } catch {}
    scores.docs = { score: docsPoints, items: docsItems };

    // ════════ 🔧 Maintainability ════════
    const maintainItems = [];
    let maintainPoints = 0;

    const standards = await this.readFile("standards/coding-style.md");
    const standardsDir = join(this.paawDir, "standards");
    let stdCount = 0;
    if (existsSync(standardsDir)) {
      try { const stdFiles = await readdir(standardsDir); stdCount = stdFiles.filter(f => f.endsWith(".md")).length; } catch {}
    }
    if ((standards && standards.length > 100) || stdCount > 0) {
      maintainPoints += 30;
      maintainItems.push({ name: "Coding Standards", status: "ok", detail: stdCount > 0 ? `${stdCount} file(s)` : "Main exists" });
    } else {
      maintainItems.push({ name: "Coding Standards", status: "missing", detail: "Missing" });
    }

    // Git hygiene
    try {
      const gitStatus = await runShell("git status --porcelain", this.root, 5000);
      const dirtyCount = gitStatus.trim().split("\n").filter(Boolean).length;
      if (dirtyCount === 0) {
        maintainPoints += 25;
        maintainItems.push({ name: "Git Status", status: "ok", detail: "Clean" });
      } else {
        maintainPoints += 10;
        maintainItems.push({ name: "Git Status", status: "warn", detail: `${dirtyCount} uncommitted` });
      }
    } catch {}

    // Error handling quality
    let errorHandlingFiles = 0;
    try {
      const ehCheck = await runShell("grep -rl 'try {' --include='*.mjs' --include='*.js' --include='*.ts' packages/server/src/ 2>/dev/null | wc -l", this.root, 5000);
      errorHandlingFiles = parseInt(ehCheck.trim()) || 0;
    } catch {}
    if (errorHandlingFiles > 3) {
      maintainPoints += 25;
      maintainItems.push({ name: "Error Handling", status: "ok", detail: `${errorHandlingFiles} files` });
    } else {
      maintainItems.push({ name: "Error Handling", status: "warn", detail: "Limited try/catch" });
    }

    // Dependency count
    try {
      const pkgPath = join(this.root, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readSync(pkgPath, "utf-8"));
        const depCount = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
        maintainItems.push({ name: "Dependencies", status: "info", detail: `${depCount} packages` });
        maintainPoints += 20;
      }
    } catch {}
    scores.maintainability = { score: maintainPoints, items: maintainItems };

    return scores;
  }

  // ── List .paaw/ directory tree ──

  async listTree() {
    if (!this.exists) return null;

    const tree = { name: ".paaw", path: this.paawDir, type: "dir", children: [] };

    const walk = async (dirPath, parentNode, depth = 0) => {
      if (depth > 3) return;
      try {
        const entries = await readdir(dirPath);
        for (const name of entries.sort()) {
          const fullPath = join(dirPath, name);
          const stat_ = await stat(fullPath);
          const node = {
            name,
            path: fullPath,
            type: stat_.isDirectory() ? "dir" : "file",
            size: stat_.size,
            children: stat_.isDirectory() ? [] : undefined,
          };
          parentNode.children.push(node);
          if (stat_.isDirectory()) {
            await walk(fullPath, node, depth + 1);
          }
        }
      } catch {}
    };

    await walk(this.paawDir, tree);
    return tree;
  }
}

// ── Default File Contents ──

const DEFAULT_PROJECT_MD = `# Project Overview

> 由 PAAW AI-Native IDE 自動生成。點擊「Initialize」掃描專案，或手動填寫。

**Name**: (auto-detect)
**Path**: (project root)

## 技術棧

(待補充)

## 啟動方式

(待補充)

## 專案結構

(待補充)
`;

const DEFAULT_DECISIONS_MD = `# Technical Decisions

> 記錄架構和技術決策 (ADR format)。AI 在做決策時會自動追加。

`;

const DEFAULT_CHANGELOG_MD = `# Changelog

> 由 PAAW AI-Native IDE 自動維護。每次 AI 完成任務後自動追加變更記錄。

`;

const DEFAULT_STANDARDS_MD = `# Coding Standards

> 本專案的 Coding 規範。AI 在寫碼時必須遵守。

## 通用原則

1. 改完碼一定要 commit + push，不留 uncommitted local change
2. 新字串必須用 t() + 加 locale key（如適用）
3. 永遠處理 IME composition（useRef，不要用 useState）

## 規範子目錄

將各語言/框架的規範放在 \`standards/\` 子目錄：

- \`standards/typescript.md\` — TypeScript 規範
- \`standards/react.md\` — React 規範
- \`standards/naming.md\` — 命名規範
- \`standards/git-commit.md\` — Commit message 規範

> 可透過 Coding IDE 的 Standards Editor 編輯，或點「Import」匯入範本。
`;

// ── Export singleton factory ──

export function createPaawProject(projectRoot) {
  return new PaawProject(projectRoot);
}

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
import { shellExec, IS_WIN } from "./shell-exec.mjs";
import { countSourceFiles } from "./cu-source-scan.mjs";

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

async function runShell(command, cwd, timeoutMs = 10_000) {
  try {
    const { stdout } = await shellExec(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout || "";
  } catch (e) {
    let output = e.stdout || "";
    if (e.stderr) output += (output ? "\n" : "") + e.stderr;
    return output;
  }
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
    const subDirs = ["features", "specs", "standards", "prompts", "issues", "runbook", "code-intelligence", "security", "changes", "operations", "quality", "api-logs", "test-payloads", "sessions",
      // New organized subdirectories
      "project", "decisions", "changelog", "actions"];
    for (const sub of subDirs) {
      const dir = join(this.paawDir, sub);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    }

    // ── Migrate flat md files into subdirectories ──
    await this._migrateFlatFiles();

    // Create default files if they don't exist
    const defaults = [
      { file: "PROJECT.md", content: DEFAULT_PROJECT_MD },
      { file: "DECISIONS.md", content: DEFAULT_DECISIONS_MD },
      { file: "CHANGELOG.md", content: DEFAULT_CHANGELOG_MD },
      { file: "CODING-STANDARDS.md", content: DEFAULT_STANDARDS_MD },
    ];

    for (const { file, content } of defaults) {
      // Use readFile which auto-resolves mapped paths (including fallback to flat)
      const existing = await this.readFile(file);
      if (!existing) await this.writeFile(file, content);
    }

    return { ok: true, dir: this.paawDir };
  }

  // ── Migrate flat .paaw/*.md files into organized subdirectories ──
  async _migrateFlatFiles() {
    const { rename } = await import("fs/promises");
    for (const [flatName, mappedPath] of Object.entries(PaawProject.FILE_MAP)) {
      const flatFilePath = join(this.paawDir, flatName);
      const mappedFilePath = join(this.paawDir, mappedPath);
      // Only migrate if flat file exists AND mapped file doesn't
      if (existsSync(flatFilePath) && !existsSync(mappedFilePath)) {
        try {
          await mkdir(dirname(mappedFilePath), { recursive: true });
          await rename(flatFilePath, mappedFilePath);
          console.log(`[paaw-migrate] ${flatName} → ${mappedPath}`);
        } catch (e) {
          console.error(`[paaw-migrate] Failed to move ${flatName}:`, e.message);
        }
      }
    }
  }

  // ── Async file scanner (Windows-safe, no find/grep) ──
  async *_scanFiles(dir, ext) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { yield* this._scanFiles(full, ext); }
      else if (e.isFile() && e.name.endsWith(ext)) { yield full; }
    }
  }

  // ── Read single file ──

  // ── Path mapping: md files organized in subdirectories ──
  // Old flat structure: .paaw/PROJECT.md
  // New organized:      .paaw/project/PROJECT.md
  // readFile/writeFile auto-resolve, so callers don't need to change.
  static FILE_MAP = {
    "PROJECT.md": "project/PROJECT.md",
    "ARCHITECTURE.md": "project/ARCHITECTURE.md",
    "STATUS.md": "project/STATUS.md",
    "AI-OPERATING-GUIDE.md": "project/AI-OPERATING-GUIDE.md",
    "CODING-STANDARDS.md": "project/CODING-STANDARDS.md",
    "TEST-EVIDENCE.md": "project/TEST-EVIDENCE.md",
    "DECISIONS.md": "decisions/DECISIONS.md",
    "CHANGELOG.md": "changelog/CHANGELOG.md",
    "KNOWN-ISSUES.md": "actions/KNOWN-ISSUES.md",
    "NEXT-ACTIONS.md": "actions/NEXT-ACTIONS.md",
  };

  _resolvePath(name) {
    // If mapped, use mapped path; otherwise use name as-is
    const mapped = PaawProject.FILE_MAP[name];
    if (mapped) {
      const mappedPath = join(this.paawDir, mapped);
      if (existsSync(mappedPath)) return mappedPath;
      // Fall back to flat path if mapped doesn't exist yet (migration)
      const flatPath = join(this.paawDir, name);
      if (existsSync(flatPath)) return flatPath;
      // Neither exists — return mapped path (for writes)
      return mappedPath;
    }
    return join(this.paawDir, name);
  }

  async readFile(name) {
    const filePath = this._resolvePath(name);
    if (!existsSync(filePath)) return null;
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  // ── Write single file ──

  async writeFile(name, content) {
    const filePath = this._resolvePath(name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    return { ok: true, path: filePath };
  }

  // ── Load full context for AI injection ──

  async loadContext() {
    if (!this.exists) return null;

    const [project, codingStandards] = await Promise.all([
      this.readFile("PROJECT.md"),
      this.readFile("CODING-STANDARDS.md"),
    ]);

    const recentSessions = await this.loadRecentSessions(3);

    // Feature Map + File-to-Feature mapping
    let featureMap = null;
    let fileFeatureMap = null;
    // 實際檔案是 FEATURES.json（feature-map step 寫入）— feature-map.json 是舊/不存在的路徑
    try {
      const fmRaw = await this.readFile("features/FEATURES.json");
      if (fmRaw) {
        const fm = JSON.parse(fmRaw);
        // Compact summary: feature name → key files
        featureMap = (fm.features || []).map(f => ({
          id: f.id,
          name: f.name,
          codeFiles: (f.codeFiles || []).slice(0, 8),
          apis: (f.apis || []).slice(0, 5).map(a => `${a.method} ${a.path}`),
        }));
      }
    } catch {}
    // File → Feature mapping (reverse index from FILE-FEATURES.json — file→features，非 API routes)
    try {
      const ffRaw = await this.readFile("features/FILE-FEATURES.json");
      if (ffRaw) {
        const ffm = JSON.parse(ffRaw);
        fileFeatureMap = Object.entries(ffm.files || {}).slice(0, 30).map(([file, feats]) => ({
          file,
          feature: (feats || []).map(f => f.name).join(", ") || "",
        }));
      }
    } catch {}

    return {
      project,
      codingStandards,
      recentSessions,
      featureMap,
      fileFeatureMap,
    };
  }

  // ── Load context as text for system prompt injection ──

  async loadContextText() {
    const ctx = await this.loadContext();
    if (!ctx) return "";

    const parts = [];

    if (ctx.project) {
      parts.push(`\n=== 專案概覽 (PROJECT.md) ===\n${ctx.project}`);
    }
    if (ctx.codingStandards) {
      // 人寫的 CODING-STANDARDS.md — 精簡注入（前 3000 chars）
      parts.push(`\n=== Coding Standards (精簡，完整用 project_info(category=content)) ===\n${ctx.codingStandards.length > 3000 ? ctx.codingStandards.slice(0, 3000) + "\n… (truncated)" : ctx.codingStandards}`);
    }
    // Feature Map: feature → files（保留，加 Hint）
    if (ctx.featureMap && ctx.featureMap.length > 0) {
      const fmLines = ctx.featureMap.map(f => {
        const files = f.codeFiles.length > 0 ? f.codeFiles.slice(0, 5).join(", ") : "(unmapped)";
        const apis = f.apis.length > 0 ? ` | APIs: ${f.apis.slice(0, 3).join(", ")}` : "";
        return `- ${f.name} (${f.id}): ${files}${apis}`;
      });
      parts.push(`\n=== Feature Map (${ctx.featureMap.length} features, 用 project_info(category=feature_detail, id=...) 查完整 detail) ===\n${fmLines.join("\n")}`);
    }
    // File → Feature mapping (reverse index)
    if (ctx.fileFeatureMap && ctx.fileFeatureMap.length > 0) {
      const ffLines = ctx.fileFeatureMap.map(r => {
        const feat = r.feature ? `[${r.feature}] ` : "";
        return `- ${r.file}${feat}`;
      });
      parts.push(`\n=== File → Feature Map (${ctx.fileFeatureMap.length} files) ===\n${ffLines.join("\n")}`);
    }
    // Sessions: 只列 summary，不展開
    if (ctx.recentSessions && ctx.recentSessions.length > 0) {
      const sessionText = ctx.recentSessions.slice(0, 2)
        .map(s => `- ${s.summary || s.filename}`)
        .join("\n");
      parts.push(`\n=== 最近 Session ===\n${sessionText}`);
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

  // ── CU Step Status Tracking ──

  async getCuStatus() {
    if (!this.exists) return { steps: {} };
    try {
      const raw = await readFile(join(this.paawDir, "cu-status.json"), "utf-8");
      return JSON.parse(raw);
    } catch {
      // Fallback: infer from file existence
      const steps = {};
      const checks = [
        { id: "scan", file: "scan.json" },
        { id: "architecture", file: "ARCHITECTURE.md" },
        { id: "feature-map", file: "features/FEATURES.json" },
        { id: "api-spec", file: "specs/api-contract.md" },
        { id: "code-intelligence", file: "code-intelligence/summary.json" },
        { id: "test-intelligence", file: "code-intelligence/test-intelligence.json" },
        { id: "error-mapping", file: "specs/error-codes.md" },
        { id: "security-scan", file: "security/scan-results.json" },
        { id: "standards", file: "standards/coding-style.md" },
        { id: "overview", file: "PROJECT.md" },
        { id: "change-intelligence", file: "changes/change-intelligence.json" },
      ];
      for (const c of checks) {
        const content = await this.readFile(c.file);
        if (content && content.length > 50 && !content.includes("(待補充)") && !content.includes("(auto-detect)")) {
          steps[c.id] = { status: "done", size: content.length, updatedAt: null };
        } else {
          steps[c.id] = { status: "pending" };
        }
      }
      return { steps };
    }
  }

  async setCuStepStatus(stepId, status, extra = {}) {
    if (!this.exists) return;
    let cuStatus = await this.getCuStatus();
    cuStatus.steps = cuStatus.steps || {};
    // CU watermark（2026-08-30）：step 標 done 時記下「當時 source 最新 mtime」
    // 重掃無變更（diffWriteJson skip → 檔案 mtime 不動）也會刷新 watermark，
    // staleness 改以 watermark 為基準 → 「確認過這版 code」不會被誤判 stale
    let patch = { ...extra };
    if (status === "done" && patch.codeMtime === undefined) {
      try { patch.codeMtime = countSourceFiles(this.root).lastModifiedMs; } catch {}
    }
    // merge 語意：保留先前欄位（如 codeMtime / summary）— 重複標 done 不會清掉寶貴 meta
    cuStatus.steps[stepId] = { ...cuStatus.steps[stepId], status, ...patch, updatedAt: new Date().toISOString() };
    await writeFile(join(this.paawDir, "cu-status.json"), JSON.stringify(cuStatus, null, 2), "utf-8");
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

// ── Export singleton instance ──

export function createPaawProject(projectRoot) {
  return new PaawProject(projectRoot);
}

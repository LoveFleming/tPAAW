// coding-health.mjs — 2026-11-07 從 routes/coding.mjs 機械抽取（不改行為）
// 專案健康收集：shell / 檔案掃描 / .paaw 完整性 / git / code stats / fix items
import { readFile, writeFile, readdir, mkdir, unlink, appendFile, stat as fsStat } from "fs/promises";
import { existsSync, readFileSync as readSync, readdirSync, statSync, openSync, readSync as fsReadSync, closeSync as fsCloseSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "../lib/shell-exec.mjs";
import { createPaawProject, maybeWriteProjectDraft } from "../lib/paaw-project.mjs";
import { parseProjectMd, buildProjectMd, regenerateProjectMd, USER_START, USER_END, AI_START, AI_END } from "../lib/project-md.mjs";
import { callLLMWithRetry, dateTimeContextBlock, parseModelReference } from "../lib/llm-utils.mjs";
import { sanitizeId, sendPathTraversalError } from "../lib/coding-security.mjs";
import { parseProject, formatForAI, formatCondensed } from "../lib/tree-sitter-parser.mjs";
import { runSemgrep } from "../lib/semgrep-runner.mjs";
import { buildCodeIntelligence, buildContextPackage } from "../lib/code-intelligence.mjs";
import { buildTestIntelligence } from "../lib/test-intelligence.mjs";
import { buildChangeIntelligence } from "../lib/change-intelligence.mjs";
import { rescanMechanicalLayer } from "../lib/cu-mechanical.mjs";
import { countSourceFiles, walkSourceFiles, changedSourceFilesSince } from "../lib/cu-source-scan.mjs";
import { appendFileSync, existsSync as existsSyncSync, mkdirSync } from "fs";
import { AGENT_RULES } from "../lib/agent-rules.mjs";
import { SECURITY_RULES } from "../lib/security-rules.mjs";
import { resolveDefaultModel } from "../lib/llm-utils.mjs";
import { runningCodingAgents } from "../lib/running-agents.mjs";
import { DATA_HOME, LOG_HOME, logSlug } from "../data-home.mjs";

async function runShellCmd(command, cwd, timeoutMs = 10_000) {
  try {
    const { stdout, stderr } = await shellExec(command, {
      cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024,
    });
    return (stdout || "") + (stderr ? "\n" + stderr : "");
  } catch (e) {
    let output = e.stdout || "";
    if (e.stderr) output += (output ? "\n" : "") + e.stderr;
    return output;
  }
}

// ── Cross-platform file tree scan (Windows has no Unix 'find') ──
async function scanProjectFiles(cwd, maxFiles = 0) {
  // 2026-09-06：改純 Node walker（共用 cu-source-scan）— 支援 .gitignore、刪掉 Windows/macOS 雙分支 shell find
  const { files } = walkSourceFiles(cwd, { maxFiles });
  return files.join("\n");
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

  // ── .paaw/ completeness with fix plans ──
  const expectedFiles = ["PROJECT.md", "ARCHITECTURE.md", "DECISIONS.md", "CHANGELOG.md"];
  // Fix plans for each missing file
  const fixPlans = {
    "PROJECT.md": { steps: [{ agent: "architect", task: "建立 .paaw/PROJECT.md，分析專案結構，撰寫專案概述、技術棧、目標使用者等" }], estimatedMinutes: 60 },
    "ARCHITECTURE.md": { steps: [{ agent: "architect", task: "建立 .paaw/ARCHITECTURE.md，分析專案目錄結構、模組依賴、資料流，畫出架構圖" }], estimatedMinutes: 60 },
    "DECISIONS.md": { steps: [{ agent: "doc-writer", task: "建立 .paaw/DECISIONS.md，根據現有程式碼和架構推導技術決策，記錄 ADR (Architecture Decision Records)" }], estimatedMinutes: 60 },
    "CHANGELOG.md": { steps: [{ agent: "doc-writer", task: "建立 .paaw/CHANGELOG.md，從 git log 推導版本歷史和重要變更" }], estimatedMinutes: 60 },
  };
  const fixHints = {
    "PROJECT.md": "No project overview",
    "ARCHITECTURE.md": "No architecture map",
    "DECISIONS.md": "No ADRs",
    "CHANGELOG.md": "No changelog",
    "sessions/": "No session history",
  };
  let existCount = 0;
  for (const f of expectedFiles) {
    const content = await paaw.readFile(f);
    const exists = content !== null;
    if (exists) existCount++;
    health.paawCompleteness.files.push({
      name: f,
      exists,
      size: exists ? content.length : undefined,
      hint: !exists ? (fixHints[f] || `Missing ${f}`) : undefined,
      fixPlan: !exists ? (fixPlans[f] || { steps: [{ agent: "developer", task: `建立 .paaw/${f}` }], estimatedMinutes: 60 }) : undefined,
    });
  }
  // Check subdirs
  const dirFixPlans = {
    "sessions/": { steps: [{ agent: "developer", task: "建立 .paaw/sessions/ 目錄，確保 AI session 歷史可以儲存" }], estimatedMinutes: 60 },
  };
  for (const d of ["sessions"]) {
    const dirPath = join(paaw.paawDir, d);
    const exists = existsSync(dirPath);
    if (exists) existCount++;
    const name = d + "/";
    health.paawCompleteness.files.push({
      name,
      exists,
      hint: !exists ? (fixHints[name] || `Missing ${name}`) : undefined,
      fixPlan: !exists ? (dirFixPlans[name] || { steps: [{ agent: "developer", task: `建立 .paaw/${name}` }], estimatedMinutes: 60 }) : undefined,
    });
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

  // ── Fix items (actionable health issues with fixPlan) ──
  const fixItems = [];
  const fixId = (cat, name) => `health-${cat}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // Missing .paaw/ docs → docWriter
  for (const f of health.paawCompleteness.files) {
    if (!f.exists && !f.name.endsWith("/")) {
      fixItems.push({
        id: fixId("paaw", f.name),
        severity: "medium",
        category: "documentation",
        title: `缺少 .paaw/${f.name}`,
        description: `${f.name} 是重要的專案知識文件，建議補齊`,
        fixPlan: {
          steps: [
            { agent: "doc-writer", task: `建立 .paaw/${f.name}，內容根據現有專案程式碼和架構推導` },
          ],
          estimatedMinutes: 60,
        },
      });
    }
  }

  // Missing .paaw/ subdirs
  for (const f of health.paawCompleteness.files) {
    if (!f.exists && f.name.endsWith("/")) {
      fixItems.push({
        id: fixId("paaw", f.name),
        severity: "low",
        category: "structure",
        title: `缺少 .paaw/${f.name} 目錄`,
        description: `建議建立 ${f.name} 目錄以組織專案知識`,
        fixPlan: {
          steps: [
            { agent: "doc-writer", task: `建立 .paaw/${f.name} 目錄及基本內容` },
          ],
          estimatedMinutes: 60,
        },
      });
    }
  }

  // Git: uncommitted changes → commit
  if (health.git.uncommitted > 5) {
    fixItems.push({
      id: fixId("git", "uncommitted"),
      severity: "medium",
      category: "git",
      title: `${health.git.uncommitted} 個未提交的變更`,
      description: "工作目錄有大量未提交變更，建議整理後提交",
      fixPlan: {
        steps: [
          { agent: "developer", task: "整理 uncommitted 變更，分組 stage + 準備 commit message（只 git add，不 commit）" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  // Git: no remote
  if (!health.git.remote) {
    fixItems.push({
      id: fixId("git", "no-remote"),
      severity: "high",
      category: "git",
      title: "沒有設定 Git Remote",
      description: "建議設定 remote origin 以便 push 和協作",
      fixPlan: {
        steps: [
          { agent: "developer", task: "幫使用者設定 git remote origin（詢問 repo URL）" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  // Low paaw score → comprehensive doc fix
  if (health.paawCompleteness.score < 50) {
    fixItems.push({
      id: fixId("paaw", "low-score"),
      severity: "high",
      category: "documentation",
      title: `.paaw/ 健康分數過低 (${health.paawCompleteness.score}/100)`,
      description: "知識文件嚴重不足，建議全面補齊",
      fixPlan: {
        steps: [
          { agent: "doc-writer", task: "建立 .paaw/PROJECT.md，描述專案目標和架構" },
          { agent: "doc-writer", task: "建立 .paaw/DECISIONS.md，記錄重要架構決策" },
        ],
        estimatedMinutes: 60,
      },
    });
  }

  health.fixItems = fixItems;

  return health;
}

export { runShellCmd, scanProjectFiles, collectProjectHealth };

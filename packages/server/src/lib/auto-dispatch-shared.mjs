/**
 * auto-dispatch-shared.mjs — Auto Dispatch 共用邏輯
 *
 * 抽出 auto-dispatch-manager.mjs 和 coding-auto-dispatch.mjs 的重複功能：
 * - gatherContext() — 收集 git context（統一版）
 * - buildSituationReport() — 整理成現況摘要
 * - refreshFeatureMapping() — Feature Map 刷新（不再兩邊複製）
 * - runFullValidation() — L3 驗證 wrapper
 *
 * 由誰使用：
 * - auto-dispatch-manager.mjs（EM 模式）
 * - coding-auto-dispatch.mjs（Parallel 模式）
 */

import { execSync } from "child_process";
import { shellExecSync } from "./shell-exec.mjs";
import { exec as execCb } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadFeatureData, matchFeaturesForFiles, buildFeatureFileTree, buildContextBoundary } from "./feature-boundary.mjs";
import { PaawProject } from "./paaw-project.mjs";
import { listActionLog } from "./action-log.mjs";


// ── Context Gathering（統一版） ──

/**
 * 收集專案的 git + .paaw context
 * 合併自 auto-dispatch-manager.gatherContext 和 coding-auto-dispatch.getChangesSince
 */
export async function gatherContext(rootDir, sinceDate) {
  const safeDir = JSON.stringify(rootDir);
  const projectRoot = rootDir; // fix: parameter was named rootDir but body used undefined projectRoot
  const since = sinceDate || new Date().toISOString().split("T")[0];
  const sinceArg = since.includes("T") ? since : `${since}T00:00:00`;

  const ctx = {};

  // 1. Git status (uncommitted changes)
  try {
    ctx.gitStatus = shellExecSync(`git status --short`, { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }).trim();
  } catch { ctx.gitStatus = ""; }

  // 2. Git log since date
  try {
    ctx.gitLog = shellExecSync(`git log --since="${sinceArg}" --oneline --no-decorate -20`, { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }).trim();
  } catch { ctx.gitLog = ""; }

  // 3. Commit count since date
  try {
    // 2026-08-29: `find /c /v ""` 是 Windows CMD idiom — 在 mac/linux 會炸 find: /c: No such file or directory
    // 且 commitCount 永遠 0（間接產生空的 `nul` 檔案）；改平台分支（比照 scanProjectFiles 作法）
    const countCmd = process.platform === "win32"
      ? `git log --since="${sinceArg}" --oneline 2>nul | find /c /v ""`
      : `git log --since="${sinceArg}" --oneline | wc -l`;
    ctx.commitCount = parseInt(shellExecSync(countCmd, { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }).trim()) || 0;
  } catch { ctx.commitCount = 0; }

  // 4. Changed files (diff names)
  const commitCount = Math.max(ctx.commitCount, 1);
  const safeCommitCount = Math.min(commitCount, 50);
  try {
    ctx.changedFiles = shellExecSync(
      `git diff --name-only HEAD~${safeCommitCount} HEAD`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }
    ).trim().split("\n").filter(Boolean);
  } catch { ctx.changedFiles = []; }

  // 5. Diff stat
  try {
    ctx.diffStat = shellExecSync(
      `git diff --stat HEAD~${safeCommitCount} HEAD`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch { ctx.diffStat = ""; }

  // 6. Unpushed commits
  try {
    ctx.unpushed = shellExecSync(
      `git log --oneline origin/dev..HEAD`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch { ctx.unpushed = ""; }

  // 7. Action log (change water level)
  try {
    const actionLog = await listActionLog({ cwd: rootDir, limit: 20, maxChars: 3000 });
    ctx.actionLog = actionLog.text;
  } catch { ctx.actionLog = ""; }

  // 8. .paaw/ context files
  const paaw = new PaawProject(rootDir);
  ctx.paawContext = "";
  for (const f of ["PROJECT.md", "STATUS.md", "DECISIONS.md", "CODING-STANDARDS.md", "CHANGELOG.md", "KNOWN-ISSUES.md", "NEXT-ACTIONS.md", "AI-OPERATING-GUIDE.md"]) {
    const fp = paaw._resolvePath(f);
    if (existsSync(fp)) {
      const content = readFileSync(fp, "utf-8").slice(0, 2000);
      ctx.paawContext += `\n### ${f}\n${content}\n`;
    }
  }

  // 9. Feature summary
  ctx.featuresSummary = getFeatureSummaryText(rootDir);

  // 10. Context Boundary — feature file tree for changed files
  try {
    const boundary = buildContextBoundary(rootDir, ctx.changedFiles);
    ctx.featureBoundary = boundary.boundaryText;
    ctx.matchedFeatureIds = boundary.featureIds;
    ctx.allowedFiles = boundary.allowedFiles;
    ctx.unmatchedFiles = boundary.unmatchedFiles;
  } catch {
    ctx.featureBoundary = "";
    ctx.matchedFeatureIds = [];
    ctx.allowedFiles = [];
    ctx.unmatchedFiles = [];
  }

  // 11. Open Issues
  ctx.issues = await gatherOpenIssues(rootDir);

  // 11. Open Tasks
  ctx.tasks = await gatherOpenTasks(rootDir);

  // 12. Security findings summary
  ctx.securitySummary = gatherSecuritySummary(rootDir);

  return ctx;
}

// ── Helper: gather open issues from coding-issues ──

async function gatherOpenIssues(rootDir) {
  const issuesFile = join(rootDir, ".paaw", "issues.json");
  if (!existsSync(issuesFile)) return { summary: "", count: 0, items: [] };
  try {
    const data = JSON.parse(readFileSync(issuesFile, "utf-8"));
    const issues = Array.isArray(data) ? data : (data.issues || []);
    const open = issues.filter(i => i.status === "open" || i.status === "in_progress");
    if (open.length === 0) return { summary: "No open issues.", count: 0, items: [] };
    const items = open.map(i => ({
      id: i.id,
      priority: i.priority || "medium",
      type: i.type || "bug",
      title: i.title || i.description?.slice(0, 80) || "(no title)",
      file: i.file,
      assignee: i.assignee,
    }));
    const summary = items.map(i => `- [${i.priority}] ${i.type}: ${i.title}${i.file ? ` (${i.file})` : ""}`).join("\n");
    return { summary, count: open.length, items };
  } catch {
    return { summary: "(error reading issues)", count: 0, items: [] };
  }
}

// ── Helper: gather open tasks from coding-tasks ──

async function gatherOpenTasks(rootDir) {
  // Try new pipeline path first, fall back to old path
  const tasksFile = join(rootDir, ".paaw", "tasks", "TASKS.json");
  const oldTasksFile = join(rootDir, ".paaw", "tasks.json");
  const filePath = existsSync(tasksFile) ? tasksFile : (existsSync(oldTasksFile) ? oldTasksFile : null);
  if (!filePath) return { summary: "", count: 0, items: [] };
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    const tasks = Array.isArray(data) ? data : (data.tasks || []);
    if (tasks.length === 0) return { summary: "No tasks.", count: 0, items: [] };

    // Include open/in_progress tasks AND tasks with pending pipeline phases
    // 2026-08-16: normalize status — tasks use "in-progress" (hyphen) or "in_progress" (underscore)
    const actionable = tasks.filter(t => {
      const st = String(t.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (st === "open" || st === "in_progress" || st === "pending" || st === "todo") return true;
      // Also check pipeline for pending phases
      if (t.pipeline) {
        return Object.values(t.pipeline).some(p => p && p.status === "pending");
      }
      return false;
    });

    if (actionable.length === 0) return { summary: "No open tasks.", count: 0, items: [] };

    const items = actionable.map(t => {
      // Extract pending pipeline phases
      const pendingPhases = [];
      if (t.pipeline) {
        for (const [phase, p] of Object.entries(t.pipeline)) {
          if (p && p.status === "pending") {
            pendingPhases.push({ phase, assignTo: p.assignTo || null });
          }
        }
      }
      return {
        id: t.id,
        priority: t.priority || "medium",
        type: t.type || "chore",
        title: t.title || "(no title)",
        assignee: t.assignee,
        parentId: t.parentId,
        status: t.status,
        description: t.description ? t.description.slice(0, 200) : "",
        relatedFiles: t.relatedFiles || [],
        pendingPhases,
      };
    });

    const summary = items.map(t => {
      let line = `- [${t.priority}] ${t.type} → ${t.assignee || "unassigned"}: ${t.title}`;
      if (t.pendingPhases.length > 0) {
        const phases = t.pendingPhases.map(p => `${p.phase}${p.assignTo ? `→${p.assignTo}` : ""}`).join(", ");
        line += ` (pending: ${phases})`;
      }
      return line;
    }).join("\n");

    return { summary, count: actionable.length, items };
  } catch {
    return { summary: "(error reading tasks)", count: 0, items: [] };
  }
}

// ── Helper: security findings summary ──

function gatherSecuritySummary(rootDir) {
  const scanFile = join(rootDir, ".paaw", "security", "scan-results.json");
  if (!existsSync(scanFile)) return { summary: "", count: 0, topFindings: [] };
  try {
    const data = JSON.parse(readFileSync(scanFile, "utf-8"));
    const findings = (data.findings || []).filter(f => f.severity !== "INFO");
    if (findings.length === 0) return { summary: "No WARNING+ findings.", count: 0, topFindings: [] };
    // Group by file, pick top 10 most relevant (WARNING+ with unique files)
    const byFile = {};
    for (const f of findings) {
      const relFile = (f.file || "").replace(rootDir + "/", "");
      if (!byFile[relFile]) byFile[relFile] = [];
      byFile[relFile].push(f);
    }
    const topFindings = Object.entries(byFile)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 10)
      .map(([file, fs]) => ({ file, count: fs.length, severity: fs[0].severity, sample: fs[0].message?.slice(0, 100) }));
    const summary = `${findings.length} findings (${Object.keys(byFile).length} files affected). Top: ${topFindings.slice(0, 5).map(f => `${f.file} (${f.count})`).join(", ")}`;
    return { summary, count: findings.length, topFindings };
  } catch {
    return { summary: "(error reading security scan)", count: 0, topFindings: [] };
  }
}

// ── Helper: feature summary text ──

function getFeatureSummaryText(rootDir) {
  const featuresFile = join(rootDir, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) return "(no features registered)";
  try {
    const data = JSON.parse(readFileSync(featuresFile, "utf-8"));
    const features = Array.isArray(data) ? data : (data.features || []);
    if (features.length === 0) return "(no features)";
    return features.map(f => `- [${f.id}] ${f.name} (${f.status}): ${f.codeFiles?.length || 0} files`).join("\n");
  } catch {
    return "(error reading features)";
  }
}

// ── Situation Report Builder（統一版） ──

export function buildSituationReport(ctx) {
  let report = `## 專案現況摘要\n\n`;

  if (ctx.gitStatus) {
    report += `### Git Status（未提交變更）\n\`\`\`\n${ctx.gitStatus}\n\`\`\`\n\n`;
  } else {
    report += `### Git Status\n工作目錄乾淨，沒有未提交變更。\n\n`;
  }

  if (ctx.diffStat) {
    report += `### Diff Stat（最近變更統計）\n\`\`\`\n${ctx.diffStat}\n\`\`\`\n\n`;
  }

  if (ctx.gitLog) {
    report += `### 最近 commit\n\`\`\`\n${ctx.gitLog}\n\`\`\`\n\n`;
  }

  if (ctx.unpushed) {
    report += `### ⚠️ 未 Push 的 commit\n\`\`\`\n${ctx.unpushed}\n\`\`\`\n\n`;
  }

  if (ctx.actionLog) {
    report += `### Action Log（Change 水位 — 最近 20 條 agent 變更紀錄）\n${ctx.actionLog}\n\n`;
  } else {
    report += `### Action Log\n目前沒有 agent 變更紀錄。\n\n`;
  }

  if (ctx.paawContext) {
    report += `### 專案知識\n${ctx.paawContext}\n`;
  }

  if (ctx.featureBoundary) {
    report += `### 🎯 Feature Context Boundary\n${ctx.featureBoundary}\n`;
  }

  // Open Issues
  if (ctx.issues && ctx.issues.count > 0) {
    report += `### 🔥 Open Issues (${ctx.issues.count})\n${ctx.issues.summary}\n\n`;
  }

  // Open Tasks
  if (ctx.tasks && ctx.tasks.count > 0) {
    report += `### 📝 Open Tasks (${ctx.tasks.count})\n`;
    for (const t of ctx.tasks.items) {
      report += `\n**${t.id}** [${t.priority}] ${t.type} → ${t.assignee || "unassigned"}\n`;
      report += `${t.title}\n`;
      if (t.pendingPhases?.length > 0) {
        const phases = t.pendingPhases.map(p => `${p.phase}${p.assignTo ? `→${p.assignTo}` : ""}`).join(", ");
        report += `Pipeline pending: ${phases}\n`;
      }
      if (t.description) {
        report += `${t.description}\n`;
      }
      if (t.relatedFiles?.length > 0) {
        report += `Files: ${t.relatedFiles.join(", ")}\n`;
      }
    }
    report += "\n";
  }

  // Security Findings
  if (ctx.securitySummary && ctx.securitySummary.count > 0) {
    report += `### 🔒 Security Findings (${ctx.securitySummary.count})\n${ctx.securitySummary.summary}\n`;
    if (ctx.securitySummary.topFindings?.length > 0) {
      report += `\n**Top affected files:**\n`;
      for (const f of ctx.securitySummary.topFindings.slice(0, 8)) {
        report += `- ${f.file} (${f.count} findings, ${f.severity}): ${f.sample}\n`;
      }
      report += "\n";
    }
  }

  return report;
}

// ── Task-driven dispatch scan（2026-09-01 feature-first 簡化）──
// 只挑 status === "open" 且掛了 featureId 的 task。pending/close/ignore 一律不派。
// type 決定 agent：test → tester、docs → doc-writer、其他（dev）→ developer。
// loop mode（mini/full）與 EM cron 只是觸發器，不影響這裡的挑選邏輯。
export function scanTasksForDispatch(rootDir, opts = {}) {
  const maxTasks = opts.maxTasks || 100;
  const tasksFile = join(rootDir, ".paaw", "tasks", "TASKS.json");

  let all = [];
  try {
    const data = JSON.parse(readFileSync(tasksFile, "utf-8"));
    all = data.tasks || (Array.isArray(data) ? data : []);
  } catch (err) {
    const situationReport = `## 📋 Task 檢查（deterministic）\n\n❌ 無法讀取 TASKS.json：${err.message}`;
    return { workList: [], situationReport, openCount: 0, noWorkReason: `TASKS.json 讀取失敗：${err.message}` };
  }

  const norm = s => String(s || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const toStatus = s => {
    const st = norm(s);
    if (st === "open" || st === "todo") return "open";
    if (["in_progress", "review", "testing", "pending", "awaiting_human"].includes(st)) return "pending";
    if (["done", "completed", "resolved", "closed"].includes(st)) return "close";
    if (["skipped", "wontfix", "ignore"].includes(st)) return "ignore";
    return "open";
  };
  const agentFor = t => {
    // spec-driven：SA 勾了「要不要測試/文件/review」→ 依勾選決定 pipeline
    if (t.spec) {
      // 有 spec → 用 spec 決定執行鏈（返回第一個要做、還沒做的 agent）
      // 實際多輪編排交給 em-orchestrator；這裡只要回「developer」作為起點
      return "developer";
    }
    const ty = norm(t.type);
    if (ty === "test" || ty === "testing") return "tester";
    if (ty === "docs" || ty === "doc" || ty === "documentation") return "doc-writer";
    return "developer";
  };

  const roots = all.filter(t => !t.parentId); // 主 task（subtask 跟 parent 一起算）
  const open = roots.filter(t => toStatus(t.status) === "open");
  const pendingCount = roots.filter(t => toStatus(t.status) === "pending").length;
  const closeCount = roots.filter(t => toStatus(t.status) === "close").length;
  const ignoreCount = roots.filter(t => toStatus(t.status) === "ignore").length;
  const noFeature = open.filter(t => !t.featureId);

  const prioRank = { critical: 0, urgent: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...open].sort((a, b) => (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1));

  const workList = [];
  const excluded = []; // [{id, title, reason}] — 供 preview API / 確認卡結構化使用
  const excludedLines = [];
  for (const t of sorted) {
    // 2026-09-02: task 不綁 feature 也可派工 — 只要 open（或 pending 待派）即可；
    // 有 spec（SA 勾選要測試/文件/review）或 featureId 都算可派。
    const hasSpec = t.spec && Object.keys(t.spec).some(k => t.spec[k]);
    const hasFeature = !!t.featureId;
    if (!hasSpec && !hasFeature) {
      excluded.push({ id: t.id, title: (t.title || "").slice(0, 80), reason: "既無 spec（要測試/文件/review）也無 featureId — 無從決定派誰" });
      excludedLines.push(`- ${t.id} ${(t.title || "").slice(0, 80)}（⚠️ 無 spec / featureId，不派工）`);
      continue;
    }
    if (workList.length >= maxTasks) {
      excluded.push({ id: t.id, title: (t.title || "").slice(0, 80), reason: `超出單次上限 ${maxTasks}，留到下一輪` });
      excludedLines.push(`- ${t.id} ${(t.title || "").slice(0, 80)}（超出單次上限 ${maxTasks}，留到下一輪）`);
      continue;
    }
    workList.push({
      agent: t.assignee || agentFor(t),
      task: `執行 ${t.id}${t.featureId ? `（feature ${t.featureId}）` : ""}：${t.title || "(無標題)"}。先讀 .paaw/tasks/TASKS.json 中 ${t.id} 的 description 與 notes，依內容實作並自我驗收。${t.spec && (t.spec.tests || t.spec.review || t.spec.docs) ? `（EM 協調：需測試=${!!t.spec.tests} review=${!!t.spec.review} 文件=${!!t.spec.docs}，走多 agent 協調）` : ""}`,
      priority: t.priority || "medium",
      reason: `${t.id} 為 open task${t.featureId ? `（feature: ${t.featureId}` : ""}，priority: ${t.priority || "medium"}）`,
      source: "task_scan",
      sourceRef: t.id,
    });
  }

  const lines = [
    "## 📋 Task 檢查（deterministic — feature-first：只派 open + 有 featureId）",
    "",
    `TASKS.json 共 ${roots.length} 個主 task：open **${open.length}**、pending ${pendingCount}、close ${closeCount}、ignore ${ignoreCount}`,
    "",
    `本輪派工：**${workList.length}** 項${workList.length ? `（依 priority 排序，上限 ${maxTasks}）` : ""}`,
  ];
  if (workList.length) lines.push("", ...workList.map(w => `- ${w.sourceRef} → ${w.agent}（${w.priority}）`));
  if (noFeature.length) lines.push("", "⚠️ open 但未掛 featureId（不派工，請先掛 feature）：", ...noFeature.map(t => `- ${t.id} ${(t.title || "").slice(0, 80)}`));
  if (excluded.length) lines.push("", "排除項：", ...excludedLines);
  const situationReport = lines.join("\n");

  const stats = { total: roots.length, open: open.length, pending: pendingCount, close: closeCount, ignore: ignoreCount, noFeature: noFeature.length, excluded: excluded.length };

  const noWorkReason = open.length === 0
    ? `沒有 open task（共 ${roots.length} 個主 task：close ${closeCount}、pending ${pendingCount}、ignore ${ignoreCount}）`
    : noFeature.length === open.length
      ? `open task ${open.length} 個全部未掛 featureId（詳見報告）`
      : `open task ${open.length} 個但全部被排除（詳見報告排除清單）`;

  return { workList, situationReport, stats, excluded, openCount: open.length, noWorkReason };
}

// ── Feature Map Refresh（統一版，不再兩邊複製） ──

/**
 * Refresh feature mappings based on current codebase
 * @param {string} projRoot - Project root directory
 * @param {string} modelOverride - Optional model override
 * @param {string[]} fallbackModels - Optional fallback model list
 * @param {function} [sendSSE] - Optional SSE callback for progress
 * @returns {Promise<{ok: boolean, updated?: number, total?: number, error?: string}>}
 */
export async function refreshFeatureMapping(projRoot, modelOverride, fallbackModels = [], sendSSE) {
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");

  // Load existing features
  const featuresFile = join(projRoot, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) {
    return { ok: false, error: "No FEATURES.json found. Run Code Understanding first." };
  }

  let features;
  try {
    const data = JSON.parse(readFileSync(featuresFile, "utf-8"));
    // 2026-08-29: CU 寫入的是 {features: [...], updatedAt} dict 形狀，其他讀取端（validator/tools）
    // 都支援雙形狀，這裡之前只接 array → 誤報「No features to update」
    features = data.features || (Array.isArray(data) ? data : []);
    if (features.length === 0) {
      return { ok: false, error: "No features to update." };
    }
  } catch (err) {
    return { ok: false, error: `Failed to load features: ${err.message}` };
  }

  // Resolve LLM config
  let llm;
  try {
    llm = resolveLLMConfig(projRoot, modelOverride);
  } catch (err) {
    return { ok: false, error: `LLM config error: ${err.message}` };
  }

  // ── LLM call with model fallback ──
  async function callWithFallback(body, opts = {}) {
    const models = [modelOverride, ...fallbackModels].filter(Boolean);
    if (models.length === 0) {
      // No override, use default
      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, body, {
        maxRetries: 3,
        timeoutMs: 300000,
        validateContent: true,
        sanitize: true,
        caller: "auto-dispatch",
        agentId: "auto-dispatch",
        disableThinking: true, // 結構化輸出 — thinking 燒額度風險（2026-08-30）
        ...opts,
      });
      return result;
    }
    for (let i = 0; i < models.length; i++) {
      try {
        const m = resolveLLMConfig(projRoot, models[i]);
        const result = await callLLMWithRetry(m.apiUrl, m.headers, { ...body, model: m.model || m.defaultModel }, {
          maxRetries: 2,
          timeoutMs: 300000,
          validateContent: true,
          sanitize: true,
          caller: "auto-dispatch",
          agentId: "auto-dispatch",
          disableThinking: true, // 結構化輸出 — thinking 燒額度風險（2026-08-30）
          ...opts,
        });
        if (result) return result;
      } catch (err) {
        console.log(`[FeatureMap] Model ${models[i]} failed: ${err.message.slice(0, 100)}`);
        if (i === models.length - 1) throw err;
      }
    }
    return null;
  }

  // Scan ALL source files
  const isWin = process.platform === "win32";
  const scanCmd = isWin
    ? `node -e "const{readdirSync:r,statSync:s}=require('fs');const{join:j}=require('path');function walk(d,a){for(const e of r(d)){const p=j(d,e);try{if(s(p).isDirectory()){if(!e.includes('node_modules')&&!e.includes('dist')&&!e.startsWith('.'))walk(p,a)}else if(/\\.(ts|tsx|mjs|js|jsx)$/.test(e))a.push(p.replace(/\\\\\\\\/g,'/'))}}catch{}}const f=[];walk('.',f);console.log(f.join('\\n'))"`
    : "find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.jsx' \\) -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.paaw/*'";

  const allFiles = await new Promise((resolve) => {
    execCb(scanCmd, { cwd: projRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      resolve(stdout.trim().split("\n").filter(Boolean));
    });
  });

  if (allFiles.length === 0) {
    return { ok: false, error: "No source files found." };
  }

  // Read API contract if exists
  let apiContract = "";
  const apiSpecFile = join(projRoot, ".paaw", "specs", "api-contract.md");
  if (existsSync(apiSpecFile)) {
    try { apiContract = readFileSync(apiSpecFile, "utf-8").slice(0, 3000); } catch {}
  }

  const prompt = `You are a code analyst. Update the file mappings for existing features based on the current codebase.

## Current Features
${JSON.stringify(features.map(f => ({ id: f.id, name: f.name, description: f.description, currentCodeFiles: f.codeFiles, currentApis: f.apis, currentTests: f.tests, currentRunbooks: f.runbooks })), null, 2)}

## All Source Files in Codebase (${allFiles.length} files)
${allFiles.join("\n")}

## API Contract
${apiContract || "(not available)"}

## Task
For EACH feature, review its current file mappings and update them based on what files actually exist now.

Rules:
1. If files were renamed/moved, update the paths
2. If new files belong to this feature, add them
3. If mapped files no longer exist, remove them
4. Check API endpoints — add new ones, remove deleted ones
5. Check test files — add new ones, remove deleted ones
6. Check runbooks — same
7. Do NOT change feature id, name, description, or status
8. Do NOT invent files that don't exist in the file list above

Output a JSON array with updated mappings. Each element:
{ "id": "F-001", "codeFiles": [...], "apis": [{"method":"GET","path":"/api/x","file":"src/x.mjs"}], "tests": [...], "runbooks": [...] }

Output ONLY the JSON array, no markdown fences.`;

  try {
    const body = {
      model: llm.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: llm.maxTokens || 16384,
      stream: false,
    };
    const result = await callWithFallback(body);
    const content = (result?.content || "").replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    if (!content) {
      return { ok: false, error: "AI 回應為空" };
    }

    let updates;
    try {
      updates = JSON.parse(content);
    } catch {
      // Recovery: find last complete object
      let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
      for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') braceCount++;
        if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
      }
      if (lastComplete === 0) {
        return { ok: false, error: "No valid JSON in AI response" };
      }
      const recovered = content.substring(0, lastComplete + 1).trim() + '\n]';
      try {
        updates = JSON.parse(recovered);
      } catch {
        return { ok: false, error: "Truncated JSON, could not recover" };
      }
    }

    if (!Array.isArray(updates)) throw new Error("AI did not return an array");

    // Apply updates
    let updatedCount = 0;
    const now = new Date().toISOString();
    for (const upd of updates) {
      const idx = features.findIndex(f => f.id === upd.id);
      if (idx < 0) continue;
      if (upd.codeFiles) features[idx].codeFiles = upd.codeFiles;
      if (upd.apis) features[idx].apis = upd.apis;
      if (upd.tests) features[idx].tests = upd.tests;
      if (upd.runbooks) features[idx].runbooks = upd.runbooks;
      features[idx].updatedAt = now;
      updatedCount++;
    }

    // Save features
    const featuresDir = join(projRoot, ".paaw", "features");
    if (!existsSync(featuresDir)) mkdirSync(featuresDir, { recursive: true });
    writeFileSync(featuresFile, JSON.stringify(features, null, 2), "utf-8");

    if (sendSSE) sendSSE("info", { message: `🗺️ Feature Map 已更新：${updatedCount}/${features.length} features` });
    return { ok: true, updated: updatedCount, total: features.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── L3 Validation wrapper ──

export async function validateFeatureMap(projRoot, sendSSE) {
  try {
    const { runFullValidation } = await import("./feature-map-validator.mjs");
    const validation = await runFullValidation(projRoot);
    if (validation.ok) {
      const s = validation.summary;
      if (sendSSE) {
        sendSSE("info", {
          message: `🔍 Feature Map 驗證：${s.mappingErrors} errors, ${s.coveragePct}% coverage, ${s.orphanFiles} orphan files`,
          validation: s,
        });
        if (s.mappingErrors > 0) {
          sendSSE("warning", { message: `⚠️ Feature Map 有 ${s.mappingErrors} 個錯誤（檔案不存在），建議重新刷新` });
        }
        if (s.coveragePct < 30) {
          sendSSE("warning", { message: `⚠️ Feature Map 覆蓋率只有 ${s.coveragePct}%，大部分檔案沒有被歸類` });
        }
      }
      return { ok: true, summary: s };
    }
    return { ok: false };
  } catch (err) {
    if (sendSSE) sendSSE("warning", { message: `🔍 Feature Map 驗證略過：${err.message}` });
    return { ok: false, error: err.message };
  }
}

// ── Unified Report Storage ──

/**
 * Save report to .paaw/auto-dispatch/reports/YYYY-MM-DD.md
 */
export function saveAutoDispatchReport(rootDir, report, mode = "em") {
  const reportsDir = join(rootDir, ".paaw", "auto-dispatch", "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${dateStr}.md`;
  writeFileSync(join(reportsDir, filename), report, "utf-8");
  return { filename, path: join(reportsDir, filename), dateStr, mode };
}

/**
 * List all reports from .paaw/auto-dispatch/reports/
 */
export async function listAutoDispatchReports(rootDir) {
  const { readdir, stat, readFile } = await import("fs/promises");
  const reports = [];

  const dir = join(rootDir, ".paaw", "auto-dispatch", "reports");
  if (!existsSync(dir)) return reports;

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const date = file.replace(".md", "");
      const fullPath = join(dir, file);
      const stats = await stat(fullPath);
      const content = await readFile(fullPath, "utf-8");
      reports.push({
        date,
        filename: file,
        path: fullPath,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        ...extractReportMetadata(content),
      });
    }
  } catch {}

  reports.sort((a, b) => b.date.localeCompare(a.date));
  return reports;
}

/**
 * Read a specific report by date
 */
export async function readAutoDispatchReport(rootDir, date) {
  const { readFile } = await import("fs/promises");
  const filePath = join(rootDir, ".paaw", "auto-dispatch", "reports", `${date}.md`);
  if (!existsSync(filePath)) return null;
  return await readFile(filePath, "utf-8");
}

/**
 * Delete a report by date
 */
export async function deleteAutoDispatchReport(rootDir, date) {
  const { unlink } = await import("fs/promises");
  const filePath = join(rootDir, ".paaw", "auto-dispatch", "reports", `${date}.md`);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  return true;
}

// ── Helper: extract metadata from report content ──

function extractReportMetadata(content) {
  const lines = content.split("\n");
  let resultLine = "";
  let summary = "";

  // Extract result from header (e.g. "**結果：** ✅ 3 成功 / ❌ 1 失敗")
  const resultMatch = lines.find(l => l.includes("**結果") || l.includes("**Result"));
  if (resultMatch) resultLine = resultMatch.replace(/\*\*/g, "").trim();

  // First paragraph after project status as summary
  const summaryStart = lines.findIndex(l => l.startsWith("## 📊") || l.startsWith("## 專案") || l.startsWith("## 📋"));
  if (summaryStart >= 0) {
    summary = lines.slice(summaryStart + 1, summaryStart + 4).join(" ").trim().slice(0, 200);
  }

  // Detect mode from title
  let mode = "em";
  if (content.includes("🌙 Auto Dispatch")) mode = "parallel";
  else if (content.includes("🎖️ Engineering Manager")) mode = "em";

  return { result: resultLine, summary, mode };
}

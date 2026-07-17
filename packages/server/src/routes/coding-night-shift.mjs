/**
 * Coding Night Shift — POST /api/coding-night-shift/start
 *
 * Reads today's git changes, dispatches tasks to all 6 coding agents
 * via runAgentLoop, collects results, and generates a Night Shift Report.
 *
 * Also: GET /api/coding-night-shift/status — check last run status
 *       GET /api/coding-night-shift/report — get last report
 */
import { readFileSync as readSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

const NIGHT_SHIFT_DIR = ".paaw/night-shift";
const STATUS_FILE = "status.json";
const REPORT_FILE = "report.md";

// ── Agent task templates ──
const AGENT_TASKS = {
  architect: {
    crewId: "coding.architect",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: Architecture Review

Today's git changes:
\`\`\`
${gitLog}
\`\`\`

Changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

Current features:
${featuresSummary}

## Your Tasks
1. Review today's architecture changes — are there any design concerns?
2. Check if any decisions need to be recorded as ADRs
3. If you see important decisions, use record_decision to log them
4. Update ARCHITECTURE.md if the architecture changed (use update_docs)
5. Summarize your findings briefly

Use your tools (project_context, project_decisions, read_file) to understand the codebase.
Write your findings to .paaw/night-shift/architect-report.md using write_file.`,
  },
  developer: {
    crewId: "coding.developer",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: Build & Fix

Today's changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

## Your Tasks
1. Run the build: \`cd packages/ui && npx vite build\` and \`cd packages/server && node --check src/paaw-server.mjs\`
2. If build fails, fix the errors
3. Run lint if available
4. Update feature mapping for any files you changed (use project_feature_update_mapping)
5. Commit and push any fixes with message "fix(night-shift): build/lint fixes"

Use bash for commands, write_file/edit_file for fixes.
Write a summary to .paaw/night-shift/developer-report.md using write_file.`,
  },
  tester: {
    crewId: "coding.tester",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: Test Coverage

Changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

Current features:
${featuresSummary}

## Your Tasks
1. Check if there are existing tests for the changed files
2. Identify changed features that lack test coverage
3. Write basic tests for critical new functionality
4. Run existing tests to check for regressions
5. Report test results

Use read_file, grep, glob to explore tests. Use write_file to create new tests.
Write a summary to .paaw/night-shift/tester-report.md using write_file.`,
  },
  "doc-writer": {
    crewId: "coding.doc-writer",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: Documentation Update

Today's changes:
\`\`\`
${gitLog}
\`\`\`

Changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

Current features:
${featuresSummary}

## Your Tasks
1. Update CHANGELOG.md with today's changes (use update_changelog)
2. For each changed feature, update its documentation (use project_feature_update_docs)
3. Update any README or inline docs that reference changed APIs
4. Check if PROJECT.md needs updating

Use project_feature_detail to see current docs, project_feature_update_docs to update.
Write a summary to .paaw/night-shift/doc-writer-report.md using write_file.`,
  },
  qa: {
    crewId: "coding.qa",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: Code Review

Today's changes:
\`\`\`
${gitLog}
\`\`\`

Changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

## Your Tasks
1. Read each changed file and review for:
   - Potential bugs (null checks, error handling, race conditions)
   - Security issues (input validation, injection risks)
   - Performance concerns
   - Code style consistency
2. For each issue found, create an issue using the issues API pattern (write to .paaw/issues/)
3. Record your findings

Use read_file, grep to review code. Use action_log_add to log findings.
Write a summary to .paaw/night-shift/qa-report.md using write_file.`,
  },
  helpdesk: {
    crewId: "coding.helpdesk",
    task: (gitLog, changedFiles, featuresSummary) => `## Night Shift Task: HelpDesk & FAQ Update

Today's changes:
${changedFiles.map(f => `- ${f}`).join("\n")}

## Your Tasks
1. Check for any new error patterns in the changed code
2. Update FAQ if new features were added that users might ask about
3. Check .paaw/issues/ for any new issues — summarize them
4. Update known issues list if needed

Use project_issues to list issues. Use read_file to check specs.
Write a summary to .paaw/night-shift/helpdesk-report.md using write_file.`,
  },
};

// ── Helper: exec as promise ──
function execAsync(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 5 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || "", stderr: stderr || "", error: err });
    });
  });
}

// ── Helper: get git changes since a date ──
async function getChangesSince(cwd, sinceDate) {
  const since = sinceDate || new Date().toISOString().split("T")[0];
  // If sinceDate is just a date like "2026-07-14", use it directly
  const sinceArg = since.includes("T") ? since : `${since}T00:00:00`;

  const { stdout: gitLog } = await execAsync(
    `git log --since="${sinceArg}" --oneline --no-decorate 2>/dev/null`,
    { cwd }
  );

  const commitCount = gitLog.trim().split("\n").filter(Boolean).length || 1;
  const { stdout: diffNames } = await execAsync(
    `git diff --name-only HEAD~${Math.min(commitCount, 50)} HEAD 2>/dev/null || git diff --name-only 2>/dev/null`,
    { cwd }
  );

  // Also get diff stat for summary
  const { stdout: diffStat } = await execAsync(
    `git diff --stat HEAD~${Math.min(commitCount, 50)} HEAD 2>/dev/null || git diff --stat 2>/dev/null`,
    { cwd }
  );

  const changedFiles = diffNames.trim().split("\n").filter(Boolean);
  return {
    gitLog: gitLog.trim() || "(no commits in this period)",
    changedFiles,
    diffStat: diffStat.trim() || "",
    since: sinceArg,
    commitCount,
  };
}

// ── Helper: get feature summary ──
function getFeatureSummaryText(cwd) {
  const featuresFile = join(cwd, ".paaw", "features", "FEATURES.json");
  if (!existsSync(featuresFile)) return "(no features registered)";
  try {
    const data = JSON.parse(readSync(featuresFile, "utf-8"));
    const features = data.features || [];
    if (features.length === 0) return "(no features)";
    return features.map(f => `- [${f.id}] ${f.name} (${f.status}): ${f.codeFiles?.length || 0} files`).join("\n");
  } catch {
    return "(error reading features)";
  }
}

// ── Helper: load crew member (always from PAAW_ROOT) ──
function loadCrewMember(crewId) {
  const crewFile = join(PAAW_ROOT, "data", "crews", `${crewId}.json`);
  if (!existsSync(crewFile)) return null;
  try {
    return JSON.parse(readSync(crewFile, "utf-8"));
  } catch {
    return null;
  }
}

export default async function codingNightShiftRoute(req, res) {
  const urlObj = new URL(req.url, "http://localhost");
  const method = req.method;

  // Helper: read body
  const readBody = (req) => new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

  // Helper: send JSON
  const sendJSON = (res, code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // Resolve code project root from query param or body, fallback to PAAW_ROOT
  let projRoot = urlObj.searchParams.get("path") || PAAW_ROOT;

  // ── POST /api/coding-night-shift/start ──
  if (urlObj.pathname === "/api/coding-night-shift/start" && method === "POST") {
    const nsDir = join(projRoot, NIGHT_SHIFT_DIR);
    if (!existsSync(nsDir)) mkdirSync(nsDir, { recursive: true });

    // Initialize status
    const startTime = Date.now();
    const status = {
      startedAt: new Date().toISOString(),
      status: "running",
      agents: {},
      totalAgents: Object.keys(AGENT_TASKS).length,
      completedAgents: 0,
    };
    writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(status, null, 2));

    // Respond immediately — run async
    sendJSON(res, 200, { ok: true, message: "Night shift started", startedAt: status.startedAt });

    // Gather context
    let reqBody = {};
    try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}
    const sinceDate = reqBody.since || urlObj.searchParams.get("since") || new Date().toISOString().split("T")[0];
    const { gitLog, changedFiles, diffStat, commitCount } = await getChangesSince(projRoot, sinceDate);
    const featuresSummary = getFeatureSummaryText(projRoot);

    if (changedFiles.length === 0 && gitLog === "(no commits in this period)") {
      // No changes today — still run but with lighter tasks
      status.status = "completed";
      status.completedAt = new Date().toISOString();
      status.duration = Date.now() - startTime;
      status.report = "## Night Shift Report\n\nℹ️ No changes today. Nothing to review.";
      writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(status, null, 2));
      writeFileSync(join(nsDir, REPORT_FILE), status.report);
      return true;
    }

    // Run agents in parallel for speed
    const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");
    const { loadAgentMemory, listActionLog } = await import("../lib/action-log.mjs");

    const agentRoles = Object.entries(AGENT_TASKS);

    const results = await Promise.allSettled(agentRoles.map(async ([role, config]) => {
      const crew = loadCrewMember(config.crewId);
      if (!crew) {
        return { role, status: "skipped", reason: "crew member not found" };
      }

      const agentId = config.crewId;
      const taskPrompt = config.task(gitLog, changedFiles, featuresSummary);

      // Load agent memory + action log for context
      let memoryText = "";
      try { memoryText = await loadAgentMemory(projRoot, agentId) || ""; } catch {}
      let actionLogText = "";
      try { actionLogText = (await listActionLog(projRoot, 5)).map(e => `- ${e.agentId}: ${e.action}`).join("\n"); } catch {}

      const systemPrompt = (crew.rolePrompt || "") +
        (memoryText ? `\n\n## Your Long-term Memory\n${memoryText}` : "") +
        (actionLogText ? `\n\n## Recent Action Log\n${actionLogText}` : "");

      try {
        const result = await runAgentLoop({
          prompt: taskPrompt,
          cwd: projRoot,
          rootDir: PAAW_ROOT,  // providers.json is in PAAW_ROOT
          systemPrompt,
          agentId,
          maxTurns: 15,
          timeout: 120,
          onEvent: (event) => {
            if (event.type === "tool_call") {
              console.log(`[NightShift:${role}] tool: ${event.name}`);
            }
          },
        });

        // Read agent's report file if it wrote one
        const reportFile = join(projRoot, NIGHT_SHIFT_DIR, `${role}-report.md`);
        let agentReport = "";
        if (existsSync(reportFile)) {
          agentReport = readSync(reportFile, "utf-8");
        }

        return {
          role,
          status: "completed",
          codename: crew.codename,
          result: typeof result === "string" ? result.slice(-500) : "ok",
          report: agentReport.slice(0, 2000) || (typeof result === "string" ? result.slice(-500) : "done"),
        };
      } catch (err) {
        console.error(`[NightShift:${role}] failed:`, err.message);
        return {
          role,
          status: "failed",
          codename: crew.codename,
          error: err.message,
        };
      }
    }));

    // Collect results
    for (const r of results) {
      const data = r.status === "fulfilled" ? r.value : { role: "unknown", status: "failed", error: r.reason?.message };
      status.agents[data.role] = data;
      status.completedAgents++;
      writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(status, null, 2));
    }

    // ── Generate Night Shift Report ──
    const crewLabels = {
      architect: "🏛️ 林曉薇 (Architect)",
      developer: "💻 Priya (Developer)",
      tester: "🧪 Divya (Tester)",
      "doc-writer": "📝 Megan (Doc Writer)",
      qa: "🔍 武大安 (QA)",
      helpdesk: "🎫 小春 (Helpdesk)",
    };

    let report = `# 🌙 Night Shift Report\n\n`;
    report += `**Date:** ${new Date().toLocaleDateString("zh-TW")}\n`;
    report += `**Started:** ${new Date(startTime).toLocaleTimeString("zh-TW")}\n`;
    report += `**Duration:** ${Math.round((Date.now() - startTime) / 1000)}s\n`;
    report += `**Changes since ${sinceDate}:** ${changedFiles.length} files, ${commitCount} commits\n\n`;
    report += `---\n\n`;

    for (const [role, label] of Object.entries(crewLabels)) {
      const agentStatus = status.agents[role];
      if (!agentStatus) {
        report += `### ${label}\n⚠️ Not executed.\n\n`;
        continue;
      }
      const icon = agentStatus.status === "completed" ? "✅" : agentStatus.status === "failed" ? "❌" : "⏭️";
      report += `### ${label} ${icon}\n`;
      if (agentStatus.report) {
        report += `${agentStatus.report}\n\n`;
      } else if (agentStatus.error) {
        report += `Error: ${agentStatus.error}\n\n`;
      } else {
        report += `${agentStatus.result || "No output"}\n\n`;
      }
      report += `---\n\n`;
    }

    // Today's git log
    report += `## 📋 Commits since ${sinceDate}\n\`\`\`\n${gitLog}\n\`\`\`\n`;
    report += `\n## 📁 Changed Files\n${changedFiles.map(f => `- \`${f}\``).join("\n")}\n`;

    status.status = "completed";
    status.completedAt = new Date().toISOString();
    status.duration = Date.now() - startTime;
    status.report = report;

    writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(status, null, 2));
    writeFileSync(join(nsDir, REPORT_FILE), report);

    console.log(`[NightShift] Complete in ${status.duration}ms`);
    return true;
  }

  // ── GET /api/coding-night-shift/last-run ──
  if (urlObj.pathname === "/api/coding-night-shift/last-run" && method === "GET") {
    // Check both Night Shift status.json and EM overnight-reports for latest run time
    let lastRunAt = null;
    let lastRunBy = null;

    // Night Shift
    const nsStatusFile = join(projRoot, NIGHT_SHIFT_DIR, STATUS_FILE);
    if (existsSync(nsStatusFile)) {
      try {
        const ns = JSON.parse(readSync(nsStatusFile, "utf-8"));
        if (ns.completedAt) { lastRunAt = ns.completedAt; lastRunBy = "night-shift"; }
        else if (ns.startedAt) { lastRunAt = ns.startedAt; lastRunBy = "night-shift"; }
      } catch {}
    }

    // EM overnight reports — find latest file by date
    const emDir = join(projRoot, ".paaw", "overnight-reports");
    if (existsSync(emDir)) {
      try {
        const { readdirSync } = await import("fs");
        const files = readdirSync(emDir).filter(f => f.endsWith(".md")).sort().reverse();
        if (files.length > 0) {
          const fileDate = files[0].replace(".md", "");
          // If the overnight report is newer than night shift, use it
          const emTime = new Date(fileDate + "T23:59:59").toISOString();
          if (!lastRunAt || emTime > lastRunAt) { lastRunAt = emTime; lastRunBy = "em"; }
        }
      } catch {}
    }

    // Also check action-log for EM activity
    try {
      const { listActionLog } = await import("../lib/action-log.mjs");
      const logs = await listActionLog(projRoot, 20);
      const emLog = logs.find(e => e.agent === "em" && e.ts);
      if (emLog?.ts && (!lastRunAt || emLog.ts > lastRunAt)) { lastRunAt = emLog.ts; lastRunBy = "em-action-log"; }
    } catch {}

    // Default: if never run, return today
    const since = lastRunAt ? lastRunAt.split("T")[0] : new Date().toISOString().split("T")[0];
    sendJSON(res, 200, { lastRunAt, lastRunBy, since, hasRun: !!lastRunAt });
    return true;
  }

  // ── GET /api/coding-night-shift/status ──
  if (urlObj.pathname === "/api/coding-night-shift/status" && method === "GET") {
    const statusFile = join(projRoot, NIGHT_SHIFT_DIR, STATUS_FILE);
    if (!existsSync(statusFile)) {
      sendJSON(res, 200, { status: "never", message: "No night shift has been run yet." });
      return true;
    }
    try {
      const data = JSON.parse(readSync(statusFile, "utf-8"));
      sendJSON(res, 200, data);
    } catch {
      sendJSON(res, 200, { status: "error", message: "Failed to read status" });
    }
    return true;
  }

  // ── GET /api/coding-night-shift/report ──
  if (urlObj.pathname === "/api/coding-night-shift/report" && method === "GET") {
    const reportFile = join(projRoot, NIGHT_SHIFT_DIR, REPORT_FILE);
    if (!existsSync(reportFile)) {
      sendJSON(res, 200, { report: "" });
      return true;
    }
    const report = readSync(reportFile, "utf-8");
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(report);
    return true;
  }

  return false;
}

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
// ── Agent task prompts: loaded from .paaw/night-shift/prompts.json ──
// Defaults are in coding-night-shift-prompts.mjs (getPromptsFile)
let AGENT_TASKS = {};

async function loadAgentTasks(rootDir) {
  const { getPromptsFile } = await import("./coding-night-shift-prompts.mjs");
  const prompts = await getPromptsFile(rootDir);
  AGENT_TASKS = {};
  for (const [role, config] of Object.entries(prompts)) {
    AGENT_TASKS[role] = {
      crewId: config.crewId,
      task: (gitLog, changedFiles, featuresSummary) => {
        const fileList = Array.isArray(changedFiles) ? changedFiles.map(f => `- ${f}`).join("\n") : changedFiles;
        return (config.task || "")
          .replace(/\{\{gitLog\}\}/g, gitLog)
          .replace(/\{\{changedFiles\}\}/g, fileList)
          .replace(/\{\{featuresSummary\}\}/g, featuresSummary);
      },
    };
  }
  return AGENT_TASKS;
}


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

    // ── Global timeout: if night shift runs > 10 minutes, force-fail ──
    const NIGHT_SHIFT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
    const timeoutId = setTimeout(() => {
      try {
        const currentStatus = JSON.parse(readSync(join(nsDir, STATUS_FILE), "utf-8"));
        if (currentStatus.status === "running") {
          currentStatus.status = "failed";
          currentStatus.completedAt = new Date().toISOString();
          currentStatus.duration = Date.now() - startTime;
          currentStatus.error = `Timed out after ${NIGHT_SHIFT_TIMEOUT_MS / 1000}s`;
          writeFileSync(join(nsDir, STATUS_FILE), JSON.stringify(currentStatus, null, 2));
          console.error(`[NightShift] Timed out after ${NIGHT_SHIFT_TIMEOUT_MS / 1000}s, force-failed`);
        }
      } catch {}
    }, NIGHT_SHIFT_TIMEOUT_MS);

    // Ensure timeout is cleared when done
    const originalClearTimer = () => clearTimeout(timeoutId);

    // Gather context
    let reqBody = {};
    try { reqBody = JSON.parse(await readBody(req) || "{}"); } catch {}
    const modelOverride = reqBody.model;
    const sinceDate = reqBody.since || urlObj.searchParams.get("since") || new Date().toISOString().split("T")[0];

    // ── Read Night Shift config (model fallback chain) ──
    let nsConfig = null;
    try {
      const nsConfigPath = join(projRoot, ".paaw", "night-shift", "config.json");
      if (existsSync(nsConfigPath)) {
        nsConfig = JSON.parse(readSync(nsConfigPath, "utf-8"));
      }
    } catch {}
    // Effective model: UI model > config model.primary > providers default
    const effectiveModel = modelOverride || nsConfig?.model?.primary || undefined;
    const fallbackModels = nsConfig?.model?.fallbacks || [];

    // ── Phase 0: Refresh Feature Map ──
    console.log("[NightShift] Phase 0: Refreshing feature map...");
    try {
      const { resolveLLMConfig } = await import("../lib/paaw-agent-loop.mjs");
      const { callLLMWithRetry } = await import("../lib/llm-utils.mjs");

      // ── LLM call with model fallback ──
      async function callWithFallback(body, opts = {}) {
        const models = [effectiveModel, ...fallbackModels].filter(Boolean);
        for (let i = 0; i < models.length; i++) {
          try {
            const llm = resolveLLMConfig(PAAW_ROOT, models[i]);
            const result = await callLLMWithRetry(llm.apiUrl, llm.headers, { ...body, model: llm.model || llm.defaultModel }, { maxRetries: 2, timeoutMs: 120000, ...opts });
            if (result) return result;
          } catch (err) {
            console.log(`[NightShift] Model ${models[i]} failed: ${err.message.slice(0, 100)}`);
            if (i === models.length - 1) throw err;
          }
        }
        return null;
      }
      const featuresFile = join(projRoot, ".paaw", "features", "FEATURES.json");
      if (existsSync(featuresFile)) {
        let features = JSON.parse(readSync(featuresFile, "utf-8"));
        if (Array.isArray(features) && features.length > 0) {
          // Scan ALL source files
          const { exec: execCb } = await import("child_process");
          const isWin = process.platform === "win32";
          const scanCmd = isWin
            ? `node -e "const{readdirSync:r,statSync:s}=require('fs');const{join:j}=require('path');function walk(d,a){for(const e of r(d)){const p=j(d,e);try{if(s(p).isDirectory()){if(!e.includes('node_modules')&&!e.includes('dist')&&!e.startsWith('.'))walk(p,a)}else if(/\.(ts|tsx|mjs|js|jsx)$/.test(e))a.push(p.replace(/\\\\/g,'/'))}}catch{}}const f=[];walk('.',f);console.log(f.join('\\n'))"`
            : "find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.js' -o -name '*.jsx' \\) -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.paaw/*'";
          const allFiles = await new Promise((resolve) => {
            execCb(scanCmd, { cwd: projRoot, maxBuffer: 10*1024*1024 }, (err, stdout) => {
              resolve(stdout.trim().split("\n").filter(Boolean));
            });
          });
          let apiContract = "";
          const apiSpecFile = join(projRoot, ".paaw", "specs", "api-contract.md");
          if (existsSync(apiSpecFile)) {
            try { apiContract = readSync(apiSpecFile, "utf-8").slice(0, 3000); } catch {}
          }
          const llm = resolveLLMConfig(PAAW_ROOT, effectiveModel);
          const refreshPrompt = `You are a code analyst. Update the file mappings for existing features based on the current codebase.

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
          const refreshBody = { model: llm.model, messages: [{ role: "user", content: refreshPrompt }], temperature: 0.2, max_tokens: 8000, stream: false };
          const refreshResult = await callWithFallback(refreshBody, { validateContent: true, sanitize: true });
          const refreshContent = (refreshResult.content || "").replace(/^\s*```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
          if (refreshContent) {
            let updates;
            try { updates = JSON.parse(refreshContent); } catch {
              // Recovery: find last complete object
              let lastComplete = 0, braceCount = 0, inStr = false, esc = false;
              for (let i = 0; i < refreshContent.length; i++) {
                const c = refreshContent[i];
                if (esc) { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === '{') braceCount++;
                if (c === '}') { braceCount--; if (braceCount === 0) lastComplete = i; }
              }
              if (lastComplete > 0) {
                const recovered = refreshContent.substring(0, lastComplete + 1).trim() + '\n]';
                try { updates = JSON.parse(recovered); } catch {}
              }
            }
            if (Array.isArray(updates)) {
              let updatedCount = 0;
              const nowTs = new Date().toISOString();
              for (const upd of updates) {
                const idx = features.findIndex(f => f.id === upd.id);
                if (idx < 0) continue;
                if (upd.codeFiles) features[idx].codeFiles = upd.codeFiles;
                if (upd.apis) features[idx].apis = upd.apis;
                if (upd.tests) features[idx].tests = upd.tests;
                if (upd.runbooks) features[idx].runbooks = upd.runbooks;
                features[idx].updatedAt = nowTs;
                updatedCount++;
              }
              writeFileSync(featuresFile, JSON.stringify(features, null, 2), "utf-8");
              console.log(`[NightShift] Feature map refreshed: ${updatedCount}/${features.length} features updated`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[NightShift] Feature map refresh failed:", err.message);
    }

    // ── L3 Validation: verify AI feature map output ──
    try {
      const { runFullValidation } = await import("../lib/feature-map-validator.mjs");
      const validation = await runFullValidation(projRoot);
      if (validation.ok) {
        const s = validation.summary;
        console.log(`[NightShift] L3 validation: ${s.mappingErrors} errors, ${s.coveragePct}% coverage, ${s.orphanFiles} orphans`);
        if (s.mappingErrors > 0) {
          console.warn(`[NightShift] ⚠️ Feature map has ${s.mappingErrors} mapping errors — files referenced but not found`);
        }
      }
    } catch (err) {
      console.error("[NightShift] L3 validation failed:", err.message);
    }

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
      clearTimeout(timeoutId);
      return true;
    }

    // Run agents in parallel for speed
    const { runAgentLoop } = await import("../lib/paaw-agent-loop.mjs");
    const { loadAgentMemory, listActionLog } = await import("../lib/action-log.mjs");

    // Load prompts from config file
    await loadAgentTasks(projRoot);
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
          model: effectiveModel,
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

    clearTimeout(timeoutId);
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

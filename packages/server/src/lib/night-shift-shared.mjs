/**
 * night-shift-shared.mjs — Night Shift 共用邏輯
 *
 * 抽出 overnight-manager.mjs 和 coding-night-shift.mjs 的重複功能：
 * - gatherContext() — 收集 git context（統一版）
 * - buildSituationReport() — 整理成現況摘要
 * - refreshFeatureMapping() — Feature Map 刷新（不再兩邊複製）
 * - runFullValidation() — L3 驗證 wrapper
 *
 * 由誰使用：
 * - overnight-manager.mjs（EM 模式）
 * - coding-night-shift.mjs（Parallel 模式）
 */

import { execSync } from "child_process";
import { exec as execCb } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { PaawProject } from "./paaw-project.mjs";
import { listActionLog } from "./action-log.mjs";

// ── Context Gathering（統一版） ──

/**
 * 收集專案的 git + .paaw context
 * 合併自 overnight-manager.gatherContext 和 coding-night-shift.getChangesSince
 */
export async function gatherContext(rootDir, sinceDate) {
  const safeDir = JSON.stringify(rootDir);
  const since = sinceDate || new Date().toISOString().split("T")[0];
  const sinceArg = since.includes("T") ? since : `${since}T00:00:00`;

  const ctx = {};

  // 1. Git status (uncommitted changes)
  try {
    ctx.gitStatus = execSync(`cd ${safeDir} && git status --short`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { ctx.gitStatus = ""; }

  // 2. Git log since date
  try {
    ctx.gitLog = execSync(`cd ${safeDir} && git log --since="${sinceArg}" --oneline --no-decorate -20`, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch { ctx.gitLog = ""; }

  // 3. Commit count since date
  try {
    ctx.commitCount = parseInt(
      execSync(`cd ${safeDir} && git log --since="${sinceArg}" --oneline 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 10000 }).trim()
    ) || 0;
  } catch { ctx.commitCount = 0; }

  // 4. Changed files (diff names)
  const commitCount = Math.max(ctx.commitCount, 1);
  const safeCommitCount = Math.min(commitCount, 50);
  try {
    ctx.changedFiles = execSync(
      `cd ${safeDir} && git diff --name-only HEAD~${safeCommitCount} HEAD 2>/dev/null || git diff --name-only 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim().split("\n").filter(Boolean);
  } catch { ctx.changedFiles = []; }

  // 5. Diff stat
  try {
    ctx.diffStat = execSync(
      `cd ${safeDir} && git diff --stat HEAD~${safeCommitCount} HEAD 2>/dev/null || git diff --stat 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch { ctx.diffStat = ""; }

  // 6. Unpushed commits
  try {
    ctx.unpushed = execSync(
      `cd ${safeDir} && git log --oneline origin/dev..HEAD 2>/dev/null || echo ""`,
      { encoding: "utf-8", timeout: 10000 }
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

  return ctx;
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

  return report;
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
    features = JSON.parse(readFileSync(featuresFile, "utf-8"));
    if (!Array.isArray(features) || features.length === 0) {
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
        timeoutMs: 120000,
        validateContent: true,
        sanitize: true,
        caller: "night-shift",
        agentId: "night-shift",
        ...opts,
      });
      return result;
    }
    for (let i = 0; i < models.length; i++) {
      try {
        const m = resolveLLMConfig(projRoot, models[i]);
        const result = await callLLMWithRetry(m.apiUrl, m.headers, { ...body, model: m.model || m.defaultModel }, {
          maxRetries: 2,
          timeoutMs: 120000,
          validateContent: true,
          sanitize: true,
          caller: "night-shift",
          agentId: "night-shift",
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
      max_tokens: 8000,
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
 * Save report to .paaw/night-shift/reports/YYYY-MM-DD.md
 */
export function saveNightShiftReport(rootDir, report, mode = "em") {
  const reportsDir = join(rootDir, ".paaw", "night-shift", "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${dateStr}.md`;
  writeFileSync(join(reportsDir, filename), report, "utf-8");
  return { filename, path: join(reportsDir, filename), dateStr, mode };
}

/**
 * List all reports from .paaw/night-shift/reports/
 */
export async function listNightShiftReports(rootDir) {
  const { readdir, stat, readFile } = await import("fs/promises");
  const reports = [];

  const dir = join(rootDir, ".paaw", "night-shift", "reports");
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
export async function readNightShiftReport(rootDir, date) {
  const { readFile } = await import("fs/promises");
  const filePath = join(rootDir, ".paaw", "night-shift", "reports", `${date}.md`);
  if (!existsSync(filePath)) return null;
  return await readFile(filePath, "utf-8");
}

/**
 * Delete a report by date
 */
export async function deleteNightShiftReport(rootDir, date) {
  const { unlink } = await import("fs/promises");
  const filePath = join(rootDir, ".paaw", "night-shift", "reports", `${date}.md`);
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
  if (content.includes("🌙 Night Shift")) mode = "parallel";
  else if (content.includes("🎖️ Engineering Manager")) mode = "em";

  return { result: resultLine, summary, mode };
}

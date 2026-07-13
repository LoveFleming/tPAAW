/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 * 
 * Acts as PAAW's built-in SAST (like Fortify/SonarQube but lightweight)
 * - Security vulnerabilities (p/javascript, p/typescript, p/java, p/python)
 * - Code quality issues (p/owasp-top-ten, p/cwe-top-25)
 * - Best practice violations
 * 
 * Output: JSON findings → stored in .paaw/security/scan-results.json
 */

import { exec as execCb } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";

const exec = promisify(execCb);

/**
 * Detect which language rule packs to use based on project files
 */
function detectRulePacks(projectRoot) {
  const packs = [];
  const has = (ext) => {
    try {
      execSync(`find "${projectRoot}" -maxdepth 4 -name "*${ext}" -not -path "*/node_modules/*" -not -path "*/.git/*" | head -1`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  };

  // Use file extension detection via shell
  const langs = new Set();
  try {
    const { execSync } = require("child_process");
    const out = execSync(
      `find "${projectRoot}" -maxdepth 4 -type f \\( -name "*.js" -o -name "*.mjs" -o -name "*.cjs" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.java" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" 2>/dev/null | head -5`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();
    if (out) {
      for (const line of out.split("\n")) {
        if (line.endsWith(".js") || line.endsWith(".mjs") || line.endsWith(".cjs") || line.endsWith(".jsx")) langs.add("javascript");
        if (line.endsWith(".ts") || line.endsWith(".tsx")) langs.add("typescript");
        if (line.endsWith(".py")) langs.add("python");
        if (line.endsWith(".java")) langs.add("java");
      }
    }
  } catch {}

  if (langs.has("javascript")) packs.push("p/javascript");
  if (langs.has("typescript")) packs.push("p/typescript");
  if (langs.has("python")) packs.push("p/python");
  if (langs.has("java")) packs.push("p/java");

  // Always include these security-focused packs
  packs.push("p/owasp-top-ten");
  packs.push("p/cwe-top-25");

  return packs;
}

/**
 * Check if semgrep is installed
 */
import { execSync } from "child_process";

export function isSemgrepAvailable() {
  try {
    execSync("semgrep --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run Semgrep on a project and return structured results
 * 
 * @param {string} projectRoot - Project root directory
 * @param {object} options - { maxFileCount, timeoutMs, rulePacks }
 * @returns {Promise<{ findings: array[], stats: object, raw: object }>}
 */
export async function runSemgrep(projectRoot, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000; // 2 min default
  const customPacks = options.rulePacks;

  // Detect rule packs
  const rulePacks = customPacks || detectRulePacks(projectRoot);
  if (rulePacks.length === 0) {
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {}, filesScanned: 0, rulesRun: 0 },
      error: "No supported source files found",
    };
  }

  // Build command
  const configArgs = rulePacks.map(p => `--config "${p}"`).join(" ");
  const cmd = `semgrep --json ${configArgs} --metrics off --quiet "${projectRoot}"`;

  // Exclude common dirs
  const excludeArg = "--exclude node_modules --exclude .git --exclude .paaw --exclude dist --exclude build --exclude coverage --exclude '*.min.js' --exclude '*.map'";

  const fullCmd = `semgrep --json ${configArgs} ${excludeArg} --metrics off --quiet "${projectRoot}"`;

  try {
    const { stdout } = await exec(fullCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    const raw = JSON.parse(stdout);
    const findings = (raw.results || []).map(r => ({
      id: r.check_id || "unknown",
      severity: r.extra?.severity || "INFO",
      confidence: r.extra?.metadata?.confidence || "UNKNOWN",
      category: r.extra?.metadata?.category || r.extra?.metadata?.owasp || "general",
      cwe: r.extra?.metadata?.cwe || [],
      message: r.extra?.message || "",
      file: r.path || "",
      line: r.start?.line || 0,
      column: r.start?.col || 0,
      endLine: r.end?.line || 0,
      snippet: r.extra?.lines || "",
      fix: r.extra?.fix || null,
      references: r.extra?.metadata?.references || [],
    }));

    // Build stats
    const bySeverity = {};
    const byCategory = {};
    const filesAffected = new Set();

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      const cat = typeof f.category === "string" ? f.category : Array.isArray(f.category) ? f.category[0] : "general";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (f.file) filesAffected.add(f.file);
    }

    return {
      findings,
      stats: {
        total: findings.length,
        bySeverity,
        byCategory,
        filesScanned: raw.paths?.scanned || 0,
        filesAffected: filesAffected.size,
        rulesRun: raw.checks?.performed || rulePacks.length,
        rulePacks,
      },
      raw: {
        version: raw.version,
        paths: raw.paths,
      },
    };
  } catch (err) {
    if (err.killed) {
      return {
        findings: [],
        stats: { total: 0, bySeverity: {}, byCategory: {} },
        error: `Semgrep timed out after ${timeoutMs / 1000}s`,
      };
    }
    // Semgrep might output JSON to stderr on partial failures
    try {
      const stderr = err.stderr || "";
      if (stderr.includes("{")) {
        const jsonStart = stderr.indexOf("{");
        const raw = JSON.parse(stderr.slice(jsonStart));
        if (raw.results) {
          return {
            findings: raw.results.map(r => ({
              id: r.check_id,
              severity: r.extra?.severity || "INFO",
              message: r.extra?.message || "",
              file: r.path,
              line: r.start?.line || 0,
            })),
            stats: { total: raw.results.length, bySeverity: {}, byCategory: {} },
            error: "Partial scan with errors",
          };
        }
      }
    } catch {}
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {} },
      error: err.message.slice(0, 500),
    };
  }
}

/**
 * Format scan results for AI consumption
 */
export function formatForAI(scanResult) {
  if (!scanResult.findings || scanResult.findings.length === 0) {
    return "No security or code quality issues found by Semgrep.";
  }

  const lines = [];
  lines.push(`# Security & Code Quality Scan (Semgrep)`);
  lines.push(`Total findings: ${scanResult.stats.total}`);
  lines.push(`By severity: ${JSON.stringify(scanResult.stats.bySeverity)}`);
  lines.push(`By category: ${JSON.stringify(scanResult.stats.byCategory)}`);
  lines.push(`Files affected: ${scanResult.stats.filesAffected || 0}`);
  lines.push("");

  // Group by file
  const byFile = {};
  for (const f of scanResult.findings) {
    if (!byFile[f.file]) byFile[f.file] = [];
    byFile[f.file].push(f);
  }

  for (const [file, findings] of Object.entries(byFile)) {
    lines.push(`## ${file} (${findings.length} findings)`);
    for (const f of findings) {
      lines.push(`  [${f.severity}] Line ${f.line}: ${f.id}`);
      lines.push(`    ${f.message.slice(0, 200)}`);
      if (f.snippet) {
        lines.push(`    Code: ${f.snippet.trim().slice(0, 150)}`);
      }
      if (f.fix) {
        lines.push(`    Fix: ${f.fix.slice(0, 150)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format for UI display (condensed)
 */
export function formatCondensed(scanResult) {
  if (!scanResult.findings || scanResult.findings.length === 0) {
    return "✅ No issues found";
  }

  const lines = [];
  for (const f of scanResult.findings) {
    const icon = f.severity === "ERROR" ? "🔴" : f.severity === "WARNING" ? "🟡" : "🔵";
    lines.push(`${icon} ${f.file}:${f.line} [${f.severity}] ${f.id} — ${f.message.slice(0, 80)}`);
  }
  return lines.join("\n");
}

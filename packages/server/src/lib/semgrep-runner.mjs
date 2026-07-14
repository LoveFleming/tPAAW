/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 * 
 * Acts as PAAW's built-in SAST (like Fortify/SonarQube but lightweight)
 * - Security vulnerabilities (p/javascript, p/typescript, p/java, p/python)
 * - Code quality issues (p/owasp-top-ten, p/cwe-top-25)
 * - Best practice violations
 * 
 * Output: JSON findings → stored in .paaw/security/scan-results.json
 * 
 * ⚠️ Cross-platform: uses Node.js fs for file detection (no Unix `find`),
 *    and shell:true for exec so Windows pip-installed semgrep is found.
 */

import { exec as execCb, execSync as execSyncCb } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { readdirSync, statSync } from "fs";
import { join, resolve, extname } from "path";
import { promisify } from "util";

const exec = promisify(execCb);
const isWin = process.platform === "win32";

// ── Cross-platform file scanning (replaces Unix `find`) ──

/**
 * Recursively scan for source files, returning matched extensions.
 * Uses Node.js fs — works identically on Windows, macOS, Linux.
 */
function scanSourceExtensions(projectRoot, maxDepth = 4) {
  const found = new Set();
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".paaw"]);
  const targetExts = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java"]);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!excludeDirs.has(name)) {
          walk(full, depth + 1);
        }
      } else if (st.isFile()) {
        const ext = extname(name).toLowerCase();
        if (targetExts.has(ext)) {
          found.add(ext);
        }
      }
    }
  }

  walk(projectRoot, 0);
  return found;
}

/**
 * Detect which language rule packs to use based on project files
 */
function detectRulePacks(projectRoot) {
  const packs = [];
  const exts = scanSourceExtensions(projectRoot);

  if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) {
    packs.push("p/javascript");
  }
  if (exts.has(".ts") || exts.has(".tsx")) {
    packs.push("p/typescript");
  }
  if (exts.has(".py")) {
    packs.push("p/python");
  }
  if (exts.has(".java")) {
    packs.push("p/java");
  }

  // Always include these security-focused packs
  packs.push("p/owasp-top-ten");
  packs.push("p/cwe-top-25");

  return packs;
}

/**
 * Build the semgrep command for the current platform.
 * On Windows, use `shell: true` so pip-installed semgrep is found.
 */
function buildSemgrepCmd(projectRoot, rulePacks, excludeArgs) {
  const configArgs = rulePacks.map(p => `--config "${p}"`).join(" ");
  return `semgrep --json ${configArgs} ${excludeArgs} --metrics off --quiet "${projectRoot}"`;
}

/**
 * Check if semgrep is installed (cross-platform)
 */
export function isSemgrepAvailable() {
  const candidates = isWin
    ? ["semgrep --version", "semgrep.exe --version", "python -m semgrep --version"]
    : ["semgrep --version"];

  for (const cmd of candidates) {
    try {
      execSyncCb(cmd, {
        stdio: "pipe",
        timeout: 8000,
        shell: true,       // ← critical for Windows PATH resolution
        env: { ...process.env },
      });
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
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

  const excludeArgs = [
    "--exclude node_modules",
    "--exclude .git",
    "--exclude .paaw",
    "--exclude dist",
    "--exclude build",
    "--exclude coverage",
    "--exclude '*.min.js'",
    "--exclude '*.map'",
  ].join(" ");

  const fullCmd = buildSemgrepCmd(projectRoot, rulePacks, excludeArgs);

  try {
    const { stdout } = await exec(fullCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      shell: true,       // ← critical for Windows PATH resolution
      env: { ...process.env },
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

/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 *
 * Simple approach: just run `semgrep` directly. If it's not available,
 * show installation instructions. No complex PATH scanning or version detection.
 *
 * Windows: automatically sets PYTHONUTF8=1 and PYTHONIOENCODING=utf-8
 * to avoid Python encoding errors.
 */

import { exec as execCb, execSync as execSyncCb } from "child_process";
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, resolve, extname, dirname } from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

const exec = promisify(execCb);
const isWin = process.platform === "win32";

const LOG = (...args) => console.log("[semgrep]", ...args);

/** Normalize path: Windows backslashes → forward slashes */
function safePath(p) {
  if (!isWin || !p) return p;
  return p.replace(/\\/g, "/");
}

/** Build env with Windows Python UTF-8 fix */
function _semgrepEnv() {
  const env = { ...process.env };
  if (isWin) {
    env.PYTHONUTF8 = "1";
    env.PYTHONIOENCODING = "utf-8";
  }
  return env;
}

// ── Installation instructions ──

const INSTALL_INSTRUCTIONS = isWin
  ? [
      "Semgrep is not installed or not in PATH.",
      "",
      "Install steps (Windows):",
      "  1. pip install semgrep",
      "  2. Make sure Python Scripts directory is in your PATH:",
      "     Usually: %APPDATA%\\Python\\PythonXX\\Scripts",
      "  3. Or set environment variable: set SEMGREP_PATH=C:\\path\\to\\semgrep.exe",
      "  4. Set PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 to avoid encoding errors",
      "",
      "Quick test in command line:",
      "  set PYTHONUTF8=1",
      "  set PYTHONIOENCODING=utf-8",
      "  semgrep --version",
    ].join("\n")
  : [
      "Semgrep is not installed or not in PATH.",
      "",
      "Install steps (macOS/Linux):",
      "  1. pip install semgrep",
      "  Or: brew install semgrep",
      "  2. Or set environment variable: export SEMGREP_PATH=/path/to/semgrep",
      "",
      "Quick test:",
      "  semgrep --version",
    ].join("\n");

// ── File scanning for rule detection ──

function scanSourceExtensions(projectRoot, maxDepth = 4) {
  const found = new Set();
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".paaw"]);
  const targetExts = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java"]);

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (!excludeDirs.has(name)) walk(full, depth + 1);
      } else if (st.isFile()) {
        const ext = extname(name).toLowerCase();
        if (targetExts.has(ext)) found.add(ext);
      }
    }
  }
  walk(projectRoot, 0);
  return found;
}

export function detectRulePacks(projectRoot) {
  const LOCAL_RULES_DIR = resolve(PAAW_ROOT, "data/semgrep-rules");
  const hasLocal = existsSync(LOCAL_RULES_DIR);
  const packs = [];
  const exts = scanSourceExtensions(projectRoot);

  if (hasLocal) {
    if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) {
      packs.push(join(LOCAL_RULES_DIR, "javascript"));
    }
    if (exts.has(".ts") || exts.has(".tsx")) {
      packs.push(join(LOCAL_RULES_DIR, "typescript"));
    }
    if (exts.has(".py")) {
      packs.push(join(LOCAL_RULES_DIR, "python"));
    }
    if (exts.has(".java")) {
      packs.push(join(LOCAL_RULES_DIR, "java"));
    }
    if (existsSync(join(LOCAL_RULES_DIR, "problem-based-packs"))) {
      packs.push(join(LOCAL_RULES_DIR, "problem-based-packs"));
    }
  } else {
    // No local rules → registry (needs internet)
    if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) packs.push("p/javascript");
    if (exts.has(".ts") || exts.has(".tsx")) packs.push("p/typescript");
    if (exts.has(".py")) packs.push("p/python");
    if (exts.has(".java")) packs.push("p/java");
    packs.push("p/owasp-top-ten");
    packs.push("p/cwe-top-25");
  }
  return packs;
}

// ── Command building ──

function buildSemgrepCmd(projectRoot, rulePacks, excludeArgs) {
  const semgrepBin = process.env.SEMGREP_PATH || "semgrep";
  const bin = safePath(semgrepBin).includes(" ") ? `"${safePath(semgrepBin)}"` : safePath(semgrepBin);
  const root = safePath(projectRoot).includes(" ") ? `"${safePath(projectRoot)}"` : safePath(projectRoot);

  const configArgs = rulePacks.map(p => {
    const sp = safePath(p);
    return sp.includes(" ") ? `--config "${sp}"` : `--config ${sp}`;
  }).join(" ");

  return `${bin} --metrics off --json ${configArgs} ${excludeArgs} --quiet ${root}`;
}

export function buildFullScanCommand(projectRoot) {
  const rulePacks = detectRulePacks(projectRoot);
  if (rulePacks.length === 0) return null;
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
  return buildSemgrepCmd(projectRoot, rulePacks, excludeArgs);
}

// ── Public API ──

export function isSemgrepAvailable() {
  const bin = process.env.SEMGREP_PATH || "semgrep";
  try {
    execSyncCb(`${bin} --version`, {
      stdio: "pipe",
      timeout: 15000,
      shell: true,
      env: _semgrepEnv(),
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

export function diagnoseSemgrep() {
  const bin = process.env.SEMGREP_PATH || "semgrep";
  try {
    const result = execSyncCb(`${bin} --version`, {
      stdio: "pipe",
      timeout: 15000,
      shell: true,
      env: _semgrepEnv(),
      encoding: "utf-8",
    });
    return {
      available: true,
      cmd: bin,
      version: (result || "").trim(),
    };
  } catch {
    return {
      available: false,
      cmd: bin,
      installInstructions: INSTALL_INSTRUCTIONS,
    };
  }
}

/**
 * Run Semgrep on a project and return structured results
 */
export async function runSemgrep(projectRoot, options = {}) {
  const timeoutMs = options.timeoutMs || 300_000; // 5 min default — semgrep scans can be slow
  const customPacks = options.rulePacks;

  LOG("runSemgrep() called, projectRoot:", projectRoot, "timeout:", timeoutMs);

  // Check if semgrep is available first
  const diag = diagnoseSemgrep();
  if (!diag.available) {
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {} },
      error: INSTALL_INSTRUCTIONS,
    };
  }

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
  LOG("runSemgrep: full command:", fullCmd);

  // Write JSON output to a temp file (avoids stdout truncation/encoding issues)
  const jsonOutPath = join(tmpdir(), `semgrep-result-${randomUUID()}.json`);
  const fileCmd = fullCmd.replace("--json ", `--json --json-output ${safePath(jsonOutPath)} `);

  // Write command to a temp script file to avoid Windows cmd.exe line length issues
  const scriptExt = isWin ? ".bat" : ".sh";
  const scriptPath = join(tmpdir(), `semgrep-scan-${randomUUID()}${scriptExt}`);
  const scriptContent = isWin
    ? `@echo off\r\nset PYTHONUTF8=1\r\nset PYTHONIOENCODING=utf-8\r\n${fileCmd}\r\n`
    : `#!/bin/sh\n${fileCmd}\n`;
  writeFileSync(scriptPath, scriptContent, "utf-8");
  LOG("runSemgrep: script file:", scriptPath);
  LOG("runSemgrep: json output:", jsonOutPath);

  const runCmd = isWin ? `cmd /c "${safePath(scriptPath)}"` : `sh "${scriptPath}"`;

  try {
    const { stdout, stderr } = await exec(runCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
      env: _semgrepEnv(),
    });

    // Clean up temp script
    try { require("fs").unlinkSync(scriptPath); } catch {}

    // Read JSON output from file
    let raw;
    if (existsSync(jsonOutPath)) {
      try {
        const jsonText = readFileSync(jsonOutPath, "utf-8");
        raw = JSON.parse(jsonText);
        LOG("runSemgrep: read result from file, size:", jsonText.length);
      } catch (parseErr) {
        LOG("runSemgrep: json-output file parse error:", parseErr.message);
        raw = JSON.parse(stdout);
      }
      try { require("fs").unlinkSync(jsonOutPath); } catch {}
    } else {
      LOG("runSemgrep: json-output file not found, falling back to stdout");
      raw = JSON.parse(stdout);
    }

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

    const bySeverity = {};
    const byCategory = {};
    const filesAffected = new Set();

    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      const cat = typeof f.category === "string" ? f.category : Array.isArray(f.category) ? f.category[0] : "general";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      if (f.file) filesAffected.add(f.file);
    }

    LOG("runSemgrep: done —", findings.length, "findings,", filesAffected.size, "files affected");

    // Save results to .paaw/security/scan-results.json
    const secDir = join(projectRoot, ".paaw", "security");
    try {
      if (!existsSync(secDir)) mkdirSync(secDir, { recursive: true });
      const scanResult = {
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
        raw: { version: raw.version, paths: raw.paths },
        scannedAt: new Date().toISOString(),
      };
      writeFileSync(join(secDir, "scan-results.json"), JSON.stringify(scanResult, null, 2), "utf-8");
      LOG("runSemgrep: results saved to", join(secDir, "scan-results.json"));
    } catch (saveErr) {
      LOG("runSemgrep: failed to save results:", saveErr.message);
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
      raw: { version: raw.version, paths: raw.paths },
    };
  } catch (err) {
    try { require("fs").unlinkSync(scriptPath); } catch {}
    try { require("fs").unlinkSync(jsonOutPath); } catch {}
    LOG("runSemgrep ERROR:", err.message?.slice(0, 300));
    if (err.killed) {
      return {
        findings: [],
        stats: { total: 0, bySeverity: {}, byCategory: {} },
        error: `Semgrep timed out after ${timeoutMs / 1000}s`,
      };
    }
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
      if (f.snippet) lines.push(`    Code: ${f.snippet.trim().slice(0, 150)}`);
      if (f.fix) lines.push(`    Fix: ${f.fix.slice(0, 150)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function formatCondensed(scanResult) {
  if (!scanResult.findings || scanResult.findings.length === 0) return "✅ No issues found";
  const lines = [];
  for (const f of scanResult.findings) {
    const icon = f.severity === "ERROR" ? "🔴" : f.severity === "WARNING" ? "🟡" : "🔵";
    lines.push(`${icon} ${f.file}:${f.line} [${f.severity}] ${f.id} — ${f.message.slice(0, 80)}`);
  }
  return lines.join("\n");
}

/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 *
 * Simple & robust: just run `semgrep` directly. Detailed logging at every step
 * so Windows issues are visible. No pre-scan diagnose — if semgrep fails,
 * the error + stderr is returned so the user can see what happened.
 *
 * Windows fixes:
 *   - PYTHONUTF8=1 + PYTHONIOENCODING=utf-8 (via _semgrepEnv)
 *   - Python Scripts directories auto-added to PATH (via _semgrepEnv)
 *   - Run semgrep directly via exec(), no .bat script
 *   - _semgrepEnv() handles all env setup
 */

import { exec as execCb, execSync as execSyncCb } from "child_process";
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "fs";
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

// ── Logging ──
// Always log — these go to server console and are critical for debugging Windows issues

const LOG = (...args) => console.log(`[semgrep ${new Date().toISOString().slice(11, 19)}]`, ...args);
const LOG_ERR = (...args) => console.error(`[semgrep ${new Date().toISOString().slice(11, 19)}]`, ...args);

/** Normalize path: Windows backslashes → forward slashes */
function safePath(p) {
  if (!isWin || !p) return p;
  return p.replace(/\\/g, "/");
}

/** Build env with Windows Python UTF-8 fix + Python Scripts in PATH */
function _semgrepEnv() {
  const env = { ...process.env };
  if (isWin) {
    env.PYTHONUTF8 = "1";
    env.PYTHONIOENCODING = "utf-8";
    // Append Python Scripts directories to PATH so semgrep can be found
    const pathParts = [env.PATH];
    // User-level pip install: %APPDATA%\Python\PythonXX\Scripts
    const appData = env.APPDATA || "";
    if (appData) {
      try {
        const pythonDir = join(appData, "Python");
        if (existsSync(pythonDir)) {
          const entries = readdirSync(pythonDir).filter(e => e.startsWith("Python"));
          for (const ver of entries) {
            const scriptsDir = join(pythonDir, ver, "Scripts");
            if (existsSync(scriptsDir)) {
              pathParts.push(scriptsDir);
              LOG("_semgrepEnv: added Python Scripts to PATH:", scriptsDir);
            }
          }
        }
      } catch (e) {
        LOG("_semgrepEnv: failed to scan Python Scripts dirs:", e.message);
      }
    }
    // System-level Python Scripts (common on some installs)
    const systemRoot = env.SystemRoot || "C:\\Windows";
    // Also check %LOCALAPPDATA%\Programs\Python\PythonXX\Scripts (very common pip install location)
    const localAppData = env.LOCALAPPDATA || "";
    if (localAppData) {
      try {
        const pythonProgDir = join(localAppData, "Programs", "Python");
        if (existsSync(pythonProgDir)) {
          const entries = readdirSync(pythonProgDir).filter(e => e.startsWith("Python"));
          for (const ver of entries) {
            const scriptsDir = join(pythonProgDir, ver, "Scripts");
            if (existsSync(scriptsDir)) {
              pathParts.push(scriptsDir);
              LOG("_semgrepEnv: added LOCALAPPDATA Python Scripts to PATH:", scriptsDir);
            }
          }
        }
      } catch (e) {
        LOG("_semgrepEnv: failed to scan LOCALAPPDATA Python dirs:", e.message);
      }
    }
    // Also check standard Python install paths
    for (const pf of [env["ProgramFiles"] || "C:\\Program Files", env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"]) {
      try {
        const entries = readdirSync(pf).filter(e => e.startsWith("Python"));
        for (const ver of entries) {
          const scriptsDir = join(pf, ver, "Scripts");
          if (existsSync(scriptsDir)) {
            pathParts.push(scriptsDir);
            LOG("_semgrepEnv: added system Python Scripts to PATH:", scriptsDir);
          }
        }
      } catch {}
    }
    env.PATH = pathParts.join(";");
  }
  LOG("_semgrepEnv: PYTHONUTF8=", env.PYTHONUTF8, "PYTHONIOENCODING=", env.PYTHONIOENCODING);
  return env;
}

// ── Installation instructions (returned when semgrep not found) ──

const INSTALL_INSTRUCTIONS = isWin
  ? [
      "Semgrep is not installed or not in PATH.",
      "",
      "Install steps (Windows):",
      "  1. Open command prompt as Administrator",
      "  2. pip install semgrep",
      "  3. Make sure Python Scripts directory is in your system PATH",
      "     (usually %APPDATA%\\Python\\PythonXX\\Scripts)",
      "  4. Test: set PYTHONUTF8=1 && set PYTHONIOENCODING=utf-8 && semgrep --version",
      "",
      "If semgrep is installed but not in PATH, set env var:",
      "  set SEMGREP_PATH=C:\\path\\to\\semgrep.exe",
      "",
      "Note: PAAW auto-sets PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 when running semgrep.",
    ].join("\n")
  : [
      "Semgrep is not installed or not in PATH.",
      "",
      "Install steps (macOS/Linux):",
      "  1. pip install semgrep",
      "  Or: brew install semgrep",
      "  2. Or set: export SEMGREP_PATH=/path/to/semgrep",
      "",
      "Quick test: semgrep --version",
    ].join("\n");

// ── File scanning for rule detection ──

function scanSourceExtensions(projectRoot, maxDepth = 4) {
  const found = new Set();
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".paaw", "semgrep-rules"]);
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
  const LOCAL_RULES_DIR = resolve(PAAW_ROOT, "data", "semgrep-rules");
  LOG("detectRulePacks: LOCAL_RULES_DIR=", LOCAL_RULES_DIR, "exists=", existsSync(LOCAL_RULES_DIR));
  const hasLocal = existsSync(LOCAL_RULES_DIR);
  const packs = [];
  const exts = scanSourceExtensions(projectRoot);
  LOG("detectRulePacks: found extensions:", [...exts].join(", "));

  if (hasLocal) {
    if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) {
      packs.push(safePath(join(LOCAL_RULES_DIR, "javascript")));
    }
    if (exts.has(".ts") || exts.has(".tsx")) {
      packs.push(safePath(join(LOCAL_RULES_DIR, "typescript")));
    }
    if (exts.has(".py")) {
      packs.push(safePath(join(LOCAL_RULES_DIR, "python")));
    }
    if (exts.has(".java")) {
      packs.push(safePath(join(LOCAL_RULES_DIR, "java")));
    }
    if (existsSync(join(LOCAL_RULES_DIR, "problem-based-packs"))) {
      packs.push(safePath(join(LOCAL_RULES_DIR, "problem-based-packs")));
    }
    // Also add registry packs for broader coverage (owasp, cwe) — local rules cover language-specific, registry covers cross-cutting security
    packs.push("p/owasp-top-ten");
    packs.push("p/cwe-top-25");
  } else {
    // No local rules → registry (needs internet)
    if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) packs.push("p/javascript");
    if (exts.has(".ts") || exts.has(".tsx")) packs.push("p/typescript");
    if (exts.has(".py")) packs.push("p/python");
    if (exts.has(".java")) packs.push("p/java");
    packs.push("p/owasp-top-ten");
    packs.push("p/cwe-top-25");
  }
  LOG("detectRulePacks: rule packs:", packs.length, packs);
  return packs;
}

// ── Command building ──

// ── Universal scan filter ──
// Scan all common source code extensions — works for any project (JS/TS/Python/Java/Go/etc).
// Rule example files inside data/semgrep-rules/ are excluded via directory exclude below.
const SOURCE_INCLUDES = [
  '--include "*.js"',
  '--include "*.mjs"',
  '--include "*.cjs"',
  '--include "*.jsx"',
  '--include "*.ts"',
  '--include "*.tsx"',
  '--include "*.py"',
  '--include "*.java"',
  '--include "*.go"',
  '--include "*.rb"',
  '--include "*.php"',
  '--include "*.c"',
  '--include "*.cpp"',
  '--include "*.cs"',
].join(" ");

function buildSemgrepCmd(projectRoot, rulePacks, excludeArgs) {
  const semgrepBin = process.env.SEMGREP_PATH || "semgrep";
  const bin = safePath(semgrepBin).includes(" ") ? `"${safePath(semgrepBin)}"` : safePath(semgrepBin);
  const root = safePath(projectRoot).includes(" ") ? `"${safePath(projectRoot)}"` : safePath(projectRoot);

  const configArgs = rulePacks.map(p => {
    const sp = safePath(p);
    return sp.includes(" ") ? `--config "${sp}"` : `--config ${sp}`;
  }).join(" ");

  const cmd = `${bin} --metrics off --json ${configArgs} ${SOURCE_INCLUDES} ${excludeArgs} --quiet ${root}`;
  LOG("buildSemgrepCmd:", cmd);
  return cmd;
}

export function buildFullScanCommand(projectRoot) {
  const rulePacks = detectRulePacks(projectRoot);
  if (rulePacks.length === 0) return null;
  const excludeArgs = [
    "--exclude node_modules",
    "--exclude .git",
    "--exclude dist",
    "--exclude build",
    "--exclude coverage",
    "--exclude data/semgrep-rules",
  ].join(" ");
  return buildSemgrepCmd(projectRoot, rulePacks, excludeArgs);
}

// ── Quick check (used by import-check only) ──

export function isSemgrepAvailable() {
  const bin = process.env.SEMGREP_PATH || "semgrep";
  try {
    LOG("isSemgrepAvailable: testing", bin);
    execSyncCb(`${bin} --version`, {
      stdio: "pipe",
      timeout: 15000,
      shell: true,
      env: _semgrepEnv(),
      encoding: "utf-8",
    });
    LOG("isSemgrepAvailable: true");
    return true;
  } catch (e) {
    LOG("isSemgrepAvailable: false —", e.message?.slice(0, 200));
    return false;
  }
}

export function diagnoseSemgrep() {
  // Kept for import-check compatibility — just wraps isSemgrepAvailable
  const available = isSemgrepAvailable();
  const bin = process.env.SEMGREP_PATH || "semgrep";
  return available
    ? { available: true, cmd: bin }
    : { available: false, cmd: bin, installInstructions: INSTALL_INSTRUCTIONS };
}

// ── Core: run semgrep scan ──

export async function runSemgrep(projectRoot, options = {}) {
  const timeoutMs = options.timeoutMs || 1_800_000; // 30 min
  const customPacks = options.rulePacks;

  LOG("━━━ runSemgrep START ━━━");
  LOG("projectRoot:", projectRoot);
  LOG("platform:", process.platform, "| isWin:", isWin);
  LOG("timeout:", timeoutMs, "ms");
  LOG("SEMGREP_PATH env:", process.env.SEMGREP_PATH || "(not set)");
  LOG("PATH (first 300):", (process.env.PATH || "").slice(0, 300));

  // ── Step 1: Detect rules ──
  const rulePacks = customPacks || detectRulePacks(projectRoot);
  if (rulePacks.length === 0) {
    LOG("runSemgrep: no rule packs detected — aborting");
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {}, filesScanned: 0, rulesRun: 0 },
      error: "No supported source files found. Semgrep needs .js/.ts/.py/.java files to scan.",
    };
  }

  // ── Step 2: Build command ──
  const excludeArgs = [
    "--exclude node_modules",
    "--exclude .git",
    "--exclude dist",
    "--exclude build",
    "--exclude coverage",
    "--exclude data/semgrep-rules",
  ].join(" ");

  const semgrepBin = process.env.SEMGREP_PATH || "semgrep";
  const fullCmd = buildSemgrepCmd(projectRoot, rulePacks, excludeArgs);
  LOG("runSemgrep: full command:", fullCmd);

  // ── Step 3: Prepare log directory ──
  const logDir = join(projectRoot, ".paaw", "logs");
  try { if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true }); } catch {}
  const scanTs = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logBase = join(logDir, `semgrep-${scanTs}`);

  // ── Step 4: Prepare execution ──
  // On Windows: semgrep command easily exceeds cmd.exe 8191-char limit.
  // Must write .bat file and run that instead of passing the raw command.
  // The .bat is saved in .paaw/logs/ so users can also manually re-run it.
  // On macOS/Linux: temp .sh script + copy to .paaw/logs/.
  let scriptPath = null;
  let scriptLogPath = null; // persistent copy in .paaw/logs/
  let runCmd;
  if (isWin) {
    // Build .bat with Python Scripts PATH + env + full semgrep command
    // Use simple IF EXIST checks for common Python Scripts locations —
    // more reliable than FOR loops in .bat (which have escaping/quoting issues)
    let batLines = "@echo off\r\n";
    batLines += "set PYTHONUTF8=1\r\n";
    batLines += "set PYTHONIOENCODING=utf-8\r\n";
    // Auto-detect Python Scripts directories and add to PATH
    // Check LOCALAPPDATA first (most common pip install location)
    batLines += "if exist \"%LOCALAPPDATA%\Programs\Python\Python312\Scripts\semgrep.exe\" set \"PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python312\Scripts\"\r\n";
    batLines += "if exist \"%LOCALAPPDATA%\Programs\Python\Python313\Scripts\semgrep.exe\" set \"PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python313\Scripts\"\r\n";
    batLines += "if exist \"%LOCALAPPDATA%\Programs\Python\Python311\Scripts\semgrep.exe\" set \"PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python311\Scripts\"\r\n";
    batLines += "if exist \"%LOCALAPPDATA%\Programs\Python\Python310\Scripts\semgrep.exe\" set \"PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python310\Scripts\"\r\n";
    batLines += "if exist \"%LOCALAPPDATA%\Programs\Python\Python39\Scripts\semgrep.exe\" set \"PATH=%PATH%;%LOCALAPPDATA%\Programs\Python\Python39\Scripts\"\r\n";
    // Also check APPDATA (user-level pip install)
    batLines += "if exist \"%APPDATA%\Python\Python312\Scripts\semgrep.exe\" set \"PATH=%PATH%;%APPDATA%\Python\Python312\Scripts\"\r\n";
    batLines += "if exist \"%APPDATA%\Python\Python313\Scripts\semgrep.exe\" set \"PATH=%PATH%;%APPDATA%\Python\Python313\Scripts\"\r\n";
    batLines += "if exist \"%APPDATA%\Python\Python311\Scripts\semgrep.exe\" set \"PATH=%PATH%;%APPDATA%\Python\Python311\Scripts\"\r\n";
    // If SEMGREP_PATH is set, use it directly
    batLines += "if defined SEMGREP_PATH set \"PATH=%PATH%;%SEMGREP_PATH%\..\"\r\n";
    batLines += fullCmd + "\r\n";
    scriptLogPath = `${logBase}.bat`;
    scriptPath = scriptLogPath; // .bat is both the log and the executable
    writeFileSync(scriptPath, batLines, "utf-8");
    LOG("runSemgrep: .bat written to", safePath(scriptPath), `(${batLines.length} bytes)`);
    // Run the .bat file — avoids cmd.exe 8191-char limit
    runCmd = `call "${scriptPath}"`;
  } else {
    const scriptExt = ".sh";
    scriptPath = join(tmpdir(), `semgrep-scan-${randomUUID()}${scriptExt}`);
    const scriptContent = `#!/bin/sh\nexport PYTHONUTF8=1\nexport PYTHONIOENCODING=utf-8\n${fullCmd}\n`;
    writeFileSync(scriptPath, scriptContent, "utf-8");
    // Also save a copy to .paaw/logs/
    scriptLogPath = `${logBase}.sh`;
    writeFileSync(scriptLogPath, scriptContent, "utf-8");
    LOG("runSemgrep: script written to:", safePath(scriptPath), "| log copy:", safePath(scriptLogPath));
    runCmd = `sh "${safePath(scriptPath)}"`;
  }
  LOG("runSemgrep: run command:", runCmd);


  let stdout = "";
  let stderr = "";
  let execError = null;

  try {
    const result = await exec(runCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
      env: _semgrepEnv(),
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
    LOG("runSemgrep: exec completed. stdout:", stdout.length, "bytes, stderr:", stderr.length, "bytes");
    if (stderr.length > 0 && stderr.length < 2000) {
      LOG("runSemgrep: stderr content:", stderr.slice(0, 1000));
    }
  } catch (err) {
    execError = err;
    stdout = err.stdout || "";
    stderr = err.stderr || "";
    LOG_ERR("runSemgrep: exec FAILED —", err.message?.slice(0, 300));
    LOG_ERR("runSemgrep: exit code:", err.code, "killed:", err.killed);
    if (stderr.length > 0) LOG_ERR("runSemgrep: stderr:", stderr.slice(0, 2000));
    if (stdout.length > 0) LOG("runSemgrep: stdout (error):", stdout.slice(0, 1000));
  }

  // ── Step 6: Save raw output to .paaw/logs/ ──
  try {
    if (stdout.length > 0) writeFileSync(`${logBase}-stdout.json`, stdout, "utf-8");
    if (stderr.length > 0) writeFileSync(`${logBase}-stderr.txt`, stderr, "utf-8");
    if (execError) writeFileSync(`${logBase}-error.txt`, `Exit code: ${execError.code || "unknown"}\nKilled: ${execError.killed}\nMessage: ${execError.message?.slice(0, 1000)}\n`, "utf-8");
    LOG("runSemgrep: raw output saved to", safePath(logBase) + "-*");
  } catch (saveErr) { LOG_ERR("runSemgrep: failed to save raw output:", saveErr.message); }

  // ── Step 6b: Clean up temp script (keep .paaw/logs/ copy, delete tmp only) ──
  // Windows: scriptPath is in .paaw/logs/ — keep it for debugging
  // macOS/Linux: scriptPath is in tmpdir — delete after use (.paaw/logs/ copy stays)
  if (scriptPath && !isWin) { try { unlinkSync(scriptPath); } catch { LOG("runSemgrep: could not delete script:", safePath(scriptPath)); } }

  // ── Step 7: Parse results ──
  let raw = null;
  let parseSource = "none";

  // Parse stdout JSON (--json outputs to stdout)
  if (stdout.length > 0) {
    LOG("runSemgrep: parsing stdout JSON, size:", stdout.length, "bytes");
    try {
      raw = JSON.parse(stdout);
      parseSource = "stdout";
    } catch (parseErr) {
      LOG_ERR("runSemgrep: stdout parse error:", parseErr.message);
      LOG("runSemgrep: stdout first 500 chars:", stdout.slice(0, 500));
    }
  }

  // Fallback: try parsing stderr for JSON
  if (!raw && stderr.length > 0) {
    const jsonStart = stderr.indexOf("{");
    if (jsonStart >= 0) {
      LOG("runSemgrep: trying to extract JSON from stderr at offset", jsonStart);
      try {
        raw = JSON.parse(stderr.slice(jsonStart));
        parseSource = "stderr";
      } catch {
        LOG_ERR("runSemgrep: stderr JSON extraction failed");
      }
    }
  }

  // ── Step 8: Handle no results ──
  if (!raw) {
    // semgrep didn't produce any output — probably not installed or crashed
    const errorDetail = [];
    if (execError) {
      errorDetail.push(`Exit code: ${execError.code || "unknown"}`);
      errorDetail.push(`Error: ${execError.message?.slice(0, 300)}`);
    }
    if (stderr.length > 0) {
      errorDetail.push(`stderr: ${stderr.slice(0, 500)}`);
    }
    if (stdout.length > 0) {
      errorDetail.push(`stdout: ${stdout.slice(0, 500)}`);
    }
    // Check if it's "command not found" type error
    const stdLower = (stderr + stdout).toLowerCase();
    const isNotFound = stdLower.includes("'semgrep' is not recognized") ||
                       stdLower.includes("semgrep: not found") ||
                       stdLower.includes("command not found") ||
                       stdLower.includes("is not recognized as an internal or external command") ||
                       stdLower.includes("no such file or directory") ||
                       (execError && execError.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" === false && !raw);

    LOG_ERR("runSemgrep: no parseable output. isNotFound:", isNotFound, "details:", errorDetail.join(" | "));

    if (isNotFound || (execError && !raw)) {
      return {
        findings: [],
        stats: { total: 0, bySeverity: {}, byCategory: {} },
        error: INSTALL_INSTRUCTIONS,
        _debug: { parseSource, execError: execError?.message?.slice(0, 200), stderr: stderr.slice(0, 300), stdout: stdout.slice(0, 300) },
      };
    }

    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {} },
      error: `Semgrep produced no output.\n${errorDetail.join("\n")}`,
      _debug: { parseSource, stderr: stderr.slice(0, 500), stdout: stdout.slice(0, 500) },
    };
  }

  // ── Step 9: Map findings ──
  LOG("runSemgrep: parsed results from:", parseSource, "version:", raw.version, "paths.scanned:", raw.paths?.scanned);

  const findings = (raw.results || []).map(r => {
    const rawSeverity = r.extra?.severity || "INFO";
    const confidence = (r.extra?.metadata?.confidence || "").toUpperCase();
    const subcategory = (r.extra?.metadata?.subcategory || []).map(s => s.toLowerCase());
    const isAudit = subcategory.includes("audit") || (r.check_id || "").includes("audit");
    let severity;
    if (rawSeverity === "ERROR" && confidence === "HIGH" && !isAudit) {
      severity = "CRITICAL";
    } else if (rawSeverity === "ERROR") {
      severity = "WARNING";
    } else {
      severity = rawSeverity;
    }
    return {
      id: r.check_id || "unknown",
      severity,
      rawSeverity,
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
    };
  });

  const bySeverity = {};
  const byCategory = {};
  const filesAffected = new Set();

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    const cat = typeof f.category === "string" ? f.category : Array.isArray(f.category) ? f.category[0] : "general";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (f.file) filesAffected.add(f.file);
  }

  LOG("runSemgrep: done —", findings.length, "findings,", filesAffected.size, "files affected, parsed from:", parseSource);

  // ── Step 10: Save results ──
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
    LOG("runSemgrep: results saved to", safePath(join(secDir, "scan-results.json")));
  } catch (saveErr) {
    LOG_ERR("runSemgrep: failed to save results:", saveErr.message);
  }

  // ── Step 11: Return ──
  const result = {
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

  if (execError && findings.length === 0) {
    // semgrep ran but exited with error and no findings — include warning
    result.warning = `Semgrep exited with code ${execError.code}. stderr: ${stderr.slice(0, 200)}`;
    LOG("runSemgrep: adding warning to result:", result.warning);
  }

  LOG("━━━ runSemgrep END ━━━", findings.length, "findings");
  return result;
}

// ── Formatters ──

export function formatForAI(scanResult) {
  if (!scanResult.findings || scanResult.findings.length === 0) {
    if (scanResult.error) return `Scan failed: ${scanResult.error}`;
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
  if (!scanResult.findings || scanResult.findings.length === 0) {
    if (scanResult.error) return `❌ ${scanResult.error.split("\n")[0]}`;
    return "✅ No issues found";
  }
  const lines = [];
  for (const f of scanResult.findings) {
    const icon = f.severity === "CRITICAL" ? "🔴" : f.severity === "WARNING" ? "🟡" : "🔵";
    lines.push(`${icon} ${f.file}:${f.line} [${f.severity}] ${f.id} — ${f.message.slice(0, 80)}`);
  }
  return lines.join("\n");
}

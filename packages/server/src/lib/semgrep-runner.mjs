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
 * 
 * ⚠️ Windows PATH fix: Node.js child_process may not inherit the full
 *    user PATH. We use fs.existsSync to locate semgrep.exe and Python,
 *    then patch process.env.PATH before running any commands.
 *    You can also set SEMGREP_PATH env var to the absolute path.
 */

import { exec as execCb, execSync as execSyncCb } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, extname, dirname } from "path";
import { promisify } from "util";
import { homedir } from "os";

const exec = promisify(execCb);
const isWin = process.platform === "win32";

const LOG = (...args) => console.log("[semgrep]", ...args);

// ── Windows PATH patching ──
// Node.js may not inherit full user PATH. We find Python/semgrep dirs
// and add them to process.env.PATH so all exec calls can find them.

let _pathPatched = false;

function patchWindowsPath() {
  if (!isWin || _pathPatched) return;
  _pathPatched = true;

  const dirsToAdd = new Set();
  const home = process.env.USERPROFILE || homedir();

  // 1. SEMGREP_PATH env var — user can set this directly
  if (process.env.SEMGREP_PATH) {
    const semgrepDir = dirname(process.env.SEMGREP_PATH);
    if (existsSync(semgrepDir)) dirsToAdd.add(semgrepDir);
  }

  // 2. Common Python + semgrep directories
  const candidates = [
    join(home, "AppData", "Local", "Programs", "Python"),
    join(home, "AppData", "Roaming", "Python"),
    join(home, "AppData", "Local", "Microsoft", "WindowsApps"),
  ];

  for (const base of candidates) {
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base);
      for (const entry of entries) {
        const scriptsDir = join(base, entry, "Scripts");
        if (existsSync(scriptsDir)) {
          dirsToAdd.add(scriptsDir);
          // Also add the Python dir itself (python.exe lives there)
          const pyDir = join(base, entry);
          if (existsSync(join(pyDir, "python.exe"))) dirsToAdd.add(pyDir);
        }
      }
    } catch {}
  }

  // 3. Use `where` to find semgrep.exe and add its directory
  try {
    const out = execSyncCb('where semgrep.exe 2>nul', {
      stdio: "pipe", timeout: 10000, shell: true, encoding: "utf-8",
    });
    const found = out.trim().split(/\r?\n/).filter(Boolean);
    for (const p of found) {
      const d = dirname(p.trim());
      if (existsSync(d)) dirsToAdd.add(d);
    }
  } catch {}

  // 4. Deep search AppData for semgrep.exe
  try {
    const out = execSyncCb('where /R "%USERPROFILE%\\AppData" semgrep.exe 2>nul', {
      stdio: "pipe", timeout: 30000, shell: true, encoding: "utf-8",
    });
    const found = out.trim().split(/\r?\n/).filter(Boolean);
    for (const p of found) {
      const d = dirname(p.trim());
      if (existsSync(d)) dirsToAdd.add(d);
    }
  } catch {}

  // 5. Python from Windows py launcher
  try {
    const out = execSyncCb('py -3 -c "import sys; print(sys.executable)" 2>nul', {
      stdio: "pipe", timeout: 10000, shell: true, encoding: "utf-8",
    });
    const pyPath = out.trim();
    if (pyPath && existsSync(pyPath)) {
      dirsToAdd.add(dirname(pyPath));
      const scriptsDir = join(dirname(pyPath), "Scripts");
      if (existsSync(scriptsDir)) dirsToAdd.add(scriptsDir);
    }
  } catch {}

  if (dirsToAdd.size > 0) {
    const currentPath = process.env.PATH || "";
    const newDirs = [...dirsToAdd].filter(d => !currentPath.toLowerCase().split(/;/).some(p => p.toLowerCase() === d.toLowerCase()));
    if (newDirs.length > 0) {
      process.env.PATH = newDirs.join(";") + ";" + currentPath;
      LOG("Patched PATH — added", newDirs.length, "dirs:", newDirs);
    }
  }
}

// ── Cross-platform file scanning (replaces Unix `find`) ──

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

function detectRulePacks(projectRoot) {
  const packs = [];
  const exts = scanSourceExtensions(projectRoot);
  if (exts.has(".js") || exts.has(".mjs") || exts.has(".cjs") || exts.has(".jsx")) packs.push("p/javascript");
  if (exts.has(".ts") || exts.has(".tsx")) packs.push("p/typescript");
  if (exts.has(".py")) packs.push("p/python");
  if (exts.has(".java")) packs.push("p/java");
  packs.push("p/owasp-top-ten");
  packs.push("p/cwe-top-25");
  return packs;
}

function buildSemgrepCmd(semgrepBin, projectRoot, rulePacks, excludeArgs) {
  const configArgs = rulePacks.map(p => `--config "${p}"`).join(" ");
  return `"${semgrepBin}" --json ${configArgs} ${excludeArgs} --metrics off --quiet "${projectRoot}"`;
}

// ── Semgrep detection — uses fs first, then exec as fallback ──

/**
 * Try to execute a command. Returns { ok, error, stdout }.
 */
function tryExec(cmd) {
  LOG("tryExec:", cmd);
  try {
    const result = execSyncCb(cmd, {
      stdio: "pipe",
      timeout: 60000,
      shell: true,
      env: { ...process.env },
      encoding: "utf-8",
    });
    LOG("tryExec OK:", cmd, "→", (result || "").trim().slice(0, 100));
    return { ok: true, stdout: (result || "").trim() };
  } catch (e) {
    const errMsg = e.message?.split('\n')[0]?.slice(0, 300) || 'failed';
    LOG("tryExec FAIL:", cmd, "→", errMsg);
    return { ok: false, error: errMsg };
  }
}

/**
 * Find semgrep executable using fs.existsSync (no exec needed).
 * Returns absolute path or null.
 */
function findSemgrepExePath() {
  LOG("findSemgrepExePath() — scanning known directories...");

  // 1. SEMGREP_PATH env var
  if (process.env.SEMGREP_PATH && existsSync(process.env.SEMGREP_PATH)) {
    LOG("Found via SEMGREP_PATH:", process.env.SEMGREP_PATH);
    return process.env.SEMGREP_PATH;
  }

  if (!isWin) {
    // macOS/Linux: just check if semgrep is on PATH
    const r = tryExec("which semgrep");
    if (r.ok && r.stdout) {
      const p = r.stdout.trim();
      if (existsSync(p)) { LOG("Found via which:", p); return p; }
    }
    return null;
  }

  // Windows: scan known Python install directories
  const home = process.env.USERPROFILE || homedir();
  const scanDirs = [
    join(home, "AppData", "Local", "Programs", "Python"),
    join(home, "AppData", "Roaming", "Python"),
    join(home, "AppData", "Local", "Packages"),
  ];

  for (const base of scanDirs) {
    if (!existsSync(base)) continue;
    try {
      const entries = readdirSync(base);
      for (const entry of entries) {
        const scriptsDir = join(base, entry, "Scripts");
        if (!existsSync(scriptsDir)) continue;
        try {
          const files = readdirSync(scriptsDir);
          for (const f of files) {
            if (f.toLowerCase() === "semgrep.exe" || f.toLowerCase() === "semgrep") {
              const fullPath = join(scriptsDir, f);
              LOG("Found via fs scan:", fullPath);
              return fullPath;
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Also try where (might find paths we missed)
  try {
    const out = execSyncCb('where semgrep.exe 2>nul', {
      stdio: "pipe", timeout: 10000, shell: true, encoding: "utf-8",
    });
    const found = out.trim().split(/\r?\n/).filter(Boolean);
    if (found.length > 0 && existsSync(found[0].trim())) {
      LOG("Found via where:", found[0].trim());
      return found[0].trim();
    }
  } catch {}

  try {
    const out = execSyncCb('where /R "%USERPROFILE%\\AppData" semgrep.exe 2>nul', {
      stdio: "pipe", timeout: 30000, shell: true, encoding: "utf-8",
    });
    const found = out.trim().split(/\r?\n/).filter(Boolean);
    if (found.length > 0 && existsSync(found[0].trim())) {
      LOG("Found via where /R AppData:", found[0].trim());
      return found[0].trim();
    }
  } catch {}

  LOG("findSemgrepExePath: nothing found");
  return null;
}

export function isSemgrepAvailable() {
  return diagnoseSemgrep().available;
}

/**
 * Full diagnostic check.
 */
export function diagnoseSemgrep() {
  LOG("=== diagnoseSemgrep() START ===");
  LOG("platform:", process.platform, "isWin:", isWin);
  LOG("PATH:", process.env.PATH?.slice(0, 300) || "(empty)");

  // Patch PATH first (Windows)
  patchWindowsPath();

  const tried = [];

  // Method 1: fs-based detection (reliable)
  const exePath = findSemgrepExePath();
  if (exePath) {
    LOG("Found exe at:", exePath);
    // Verify it actually runs
    const r = tryExec(`"${exePath}" --version`);
    tried.push({ cmd: `"${exePath}" --version`, ...r });
    if (r.ok) {
      LOG("=== FOUND via fs+exec:", exePath, "===");
      return { available: true, cmd: exePath, tried };
    }
    // exe exists but won't run — might need Python on PATH
    LOG("exe found but won't run, PATH may need Python dir");
  }

  // Method 2: command-based detection (fallback)
  const cmds = isWin
    ? ["semgrep --version", "semgrep.exe --version", "python -m semgrep --version", "python3 -m semgrep --version", "py -m semgrep --version", "py -3 -m semgrep --version"]
    : ["semgrep --version", "python3 -m semgrep --version", "python -m semgrep --version"];
  for (const cmd of cmds) {
    const r = tryExec(cmd);
    tried.push({ cmd, ...r });
    if (r.ok) {
      LOG("=== FOUND via command:", cmd, "===");
      return { available: true, cmd, tried };
    }
  }

  const envInfo = {
    platform: process.platform,
    PATH: process.env.PATH?.slice(0, 500) || '(empty)',
    USERPROFILE: process.env.USERPROFILE || '(not set)',
    PYTHONHOME: process.env.PYTHONHOME || '(not set)',
    VIRTUAL_ENV: process.env.VIRTUAL_ENV || '(not set)',
    SEMGREP_PATH: process.env.SEMGREP_PATH || '(not set)',
    exePathFound: exePath || '(not found)',
  };

  LOG("=== NOT AVAILABLE ===");
  LOG("envInfo:", JSON.stringify(envInfo, null, 2));
  return { available: false, tried, envInfo };
}

/**
 * Find the command to run semgrep. Returns the string to use as the binary.
 */
function findSemgrepCmd() {
  LOG("findSemgrepCmd() called");

  // Patch PATH first
  patchWindowsPath();

  // 1. Try SEMGREP_PATH env var
  if (process.env.SEMGREP_PATH && existsSync(process.env.SEMGREP_PATH)) {
    LOG("Using SEMGREP_PATH:", process.env.SEMGREP_PATH);
    return process.env.SEMGREP_PATH;
  }

  // 2. fs-based detection
  const exePath = findSemgrepExePath();
  if (exePath) {
    // Verify it runs
    const r = tryExec(`"${exePath}" --version`);
    if (r.ok) {
      LOG("findSemgrepCmd: using", exePath);
      return exePath;
    }
  }

  // 3. command-based fallback
  const cmds = isWin
    ? ["semgrep", "semgrep.exe", "python -m semgrep", "python3 -m semgrep", "py -m semgrep", "py -3 -m semgrep"]
    : ["semgrep", "python3 -m semgrep", "python -m semgrep"];
  for (const cmd of cmds) {
    if (tryExec(`${cmd} --version`).ok) {
      LOG("findSemgrepCmd: found via command:", cmd);
      return cmd;
    }
  }

  LOG("findSemgrepCmd: returning null");
  return null;
}

/**
 * Run Semgrep on a project and return structured results
 */
export async function runSemgrep(projectRoot, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const customPacks = options.rulePacks;

  LOG("runSemgrep() called, projectRoot:", projectRoot, "timeout:", timeoutMs);

  patchWindowsPath();

  const semgrepBin = findSemgrepCmd();
  if (!semgrepBin) {
    LOG("runSemgrep: semgrepBin is null");
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {} },
      error: "Semgrep not found. Install: pip install semgrep, or set SEMGREP_PATH env var.",
    };
  }

  LOG("runSemgrep: using cmd:", semgrepBin);

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

  const fullCmd = buildSemgrepCmd(semgrepBin, projectRoot, rulePacks, excludeArgs);
  LOG("runSemgrep: full command:", fullCmd);

  try {
    const { stdout } = await exec(fullCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
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

/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 * 
 * Acts as PAAW's built-in SAST (like Fortify/SonarQube but lightweight)
 * 
 * ⚠️ Cross-platform: uses Node.js fs for file detection (no Unix `find`),
 *    and shell:true for exec so Windows pip-installed semgrep is found.
 * 
 * ⚠️ Windows: Node.js child_process may not inherit full user PATH.
 *    We use fs.existsSync to locate semgrep.exe and Python dirs,
 *    patch process.env.PATH, then verify with exec.
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

/**
 * Normalize a path for safe use in shell command strings.
 * On Windows, converts backslashes to forward slashes.
 * cmd.exe and PowerShell both accept / in quoted paths.
 */
function safePath(p) {
  if (!isWin || !p) return p;
  return p.replace(/\\/g, "/");
}

// ── Windows PATH patching (pure fs — no exec) ──

let _pathPatched = false;

export function patchWindowsPath() {
  if (!isWin || _pathPatched) return;
  _pathPatched = true;

  // 0. Try to read user PATH from Windows registry (fast, <1s)
  //    This ensures PTY terminal gets the same PATH as a real CMD window.
  try {
    const regResult = execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    // reg output: "    Path    REG_EXPAND_SZ    C:\Users\...;C:\Users\..."
    const lines = regResult.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
      if (m) {
        let userPath = m[1].trim();
        // Expand %USERPROFILE% etc.
        userPath = userPath.replace(/%([^%]+)%/g, (_, v) => process.env[v] || _);
        const currentPath = process.env.PATH || "";
        const currentSet = new Set(currentPath.toLowerCase().split(/;/).filter(Boolean));
        const missingParts = userPath.split(/;/).filter(p =>
          p && !currentSet.has(p.toLowerCase())
        );
        if (missingParts.length > 0) {
          process.env.PATH = missingParts.join(";") + ";" + currentPath;
          LOG("Patched PATH from registry — added", missingParts.length, "dirs:", missingParts);
        }
        break;
      }
    }
  } catch (e) {
    LOG("Could not read registry PATH:", e.message);
  }

  const dirsToAdd = new Set();
  const home = process.env.USERPROFILE || homedir();

  // 1. SEMGREP_PATH env var
  if (process.env.SEMGREP_PATH) {
    const semgrepDir = dirname(process.env.SEMGREP_PATH);
    if (existsSync(semgrepDir)) dirsToAdd.add(semgrepDir);
  }

  // 2. Scan known Python directories (fs only, no exec)
  const scanBases = [
    join(home, "AppData", "Local", "Programs", "Python"),
    join(home, "AppData", "Roaming", "Python"),
  ];

  for (const base of scanBases) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        const subDir = join(base, entry);
        try { if (!statSync(subDir).isDirectory()) continue; } catch { continue; }
        // Add Python dir (python.exe)
        if (existsSync(join(subDir, "python.exe")) || existsSync(join(subDir, "python3.exe"))) {
          dirsToAdd.add(subDir);
        }
        // Add Scripts dir (semgrep.exe)
        const scriptsDir = join(subDir, "Scripts");
        if (existsSync(scriptsDir)) {
          dirsToAdd.add(scriptsDir);
        }
      }
    } catch {}
  }

  // 3. Windows Store Python packages
  const packagesDir = join(home, "AppData", "Local", "Packages");
  if (existsSync(packagesDir)) {
    try {
      for (const entry of readdirSync(packagesDir)) {
        if (!entry.startsWith("PythonSoftwareFoundation")) continue;
        const localPkg = join(packagesDir, entry, "local-packages");
        if (!existsSync(localPkg)) continue;
        try {
          for (const sub of readdirSync(localPkg)) {
            const scriptsDir = join(localPkg, sub, "Scripts");
            if (existsSync(scriptsDir)) dirsToAdd.add(scriptsDir);
          }
        } catch {}
      }
    } catch {}
  }

  if (dirsToAdd.size > 0) {
    const currentPath = process.env.PATH || "";
    const newDirs = [...dirsToAdd].filter(d =>
      !currentPath.toLowerCase().split(/;/).some(p => p.toLowerCase() === d.toLowerCase())
    );
    if (newDirs.length > 0) {
      process.env.PATH = newDirs.join(";") + ";" + currentPath;
      LOG("Patched PATH — added", newDirs.length, "dirs:", newDirs);
    }
  }
}

// ── File scanning ──

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
  const bin = safePath(semgrepBin);
  const root = safePath(projectRoot);
  const configArgs = rulePacks.map(p => `--config "${p}"`).join(" ");
  return `"${bin}" --json ${configArgs} ${excludeArgs} --metrics off --quiet "${root}"`;
}

// ── Semgrep detection ──

/**
 * Execute a command with timeout. Returns { ok, error?, stdout? }.
 */
function tryExec(cmd, timeout = 60000) {
  LOG("tryExec:", cmd, `(${timeout}ms)`);
  try {
    const result = execSyncCb(cmd, {
      stdio: "pipe",
      timeout,
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
 * Find semgrep.exe using ONLY fs.existsSync (zero exec calls).
 * Returns absolute path or null.
 */
function findSemgrepExeFs() {
  LOG("findSemgrepExeFs() — pure fs scan");

  // 1. SEMGREP_PATH env var
  if (process.env.SEMGREP_PATH) {
    if (existsSync(process.env.SEMGREP_PATH)) {
      LOG("Found via SEMGREP_PATH:", process.env.SEMGREP_PATH);
      return process.env.SEMGREP_PATH;
    }
    LOG("SEMGREP_PATH set but file not found:", process.env.SEMGREP_PATH);
  }

  if (!isWin) {
    // macOS/Linux: check common locations
    const paths = ["/opt/homebrew/bin/semgrep", "/usr/local/bin/semgrep", "/usr/bin/semgrep"];
    for (const p of paths) {
      if (existsSync(p)) { LOG("Found:", p); return p; }
    }
    return null;
  }

  // Windows: scan Python install directories
  const home = process.env.USERPROFILE || homedir();
  const scanBases = [
    join(home, "AppData", "Local", "Programs", "Python"),
    join(home, "AppData", "Roaming", "Python"),
  ];

  for (const base of scanBases) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        const scriptsDir = join(base, entry, "Scripts");
        if (!existsSync(scriptsDir)) continue;
        try {
          for (const f of readdirSync(scriptsDir)) {
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

  // Windows Store Python
  const packagesDir = join(home, "AppData", "Local", "Packages");
  if (existsSync(packagesDir)) {
    try {
      for (const pkg of readdirSync(packagesDir)) {
        if (!pkg.startsWith("PythonSoftwareFoundation")) continue;
        const localPkg = join(packagesDir, pkg, "local-packages");
        if (!existsSync(localPkg)) continue;
        try {
          for (const sub of readdirSync(localPkg)) {
            const scriptsDir = join(localPkg, sub, "Scripts");
            if (!existsSync(scriptsDir)) continue;
            try {
              for (const f of readdirSync(scriptsDir)) {
                if (f.toLowerCase() === "semgrep.exe") {
                  const fullPath = join(scriptsDir, f);
                  LOG("Found via Windows Store:", fullPath);
                  return fullPath;
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  LOG("findSemgrepExeFs: nothing found");
  return null;
}

export function isSemgrepAvailable() {
  return diagnoseSemgrep().available;
}

export function diagnoseSemgrep() {
  LOG("=== diagnoseSemgrep() START ===");
  LOG("platform:", process.platform, "isWin:", isWin);

  // Patch PATH first (Windows) — pure fs, no exec
  patchWindowsPath();

  const tried = [];

  // Step 1: Find exe via fs (zero exec)
  const exePath = findSemgrepExeFs();
  if (exePath) {
    LOG("Found exe at:", exePath);
    // Step 2: Verify it runs — this is the ONLY exec call for detection
    const escaped = safePath(exePath);
    const r = tryExec(`"${escaped}" --version`, 60000);
    tried.push({ cmd: `"${escaped}" --version`, ...r });
    if (r.ok) {
      LOG("=== FOUND ===");
      return { available: true, cmd: exePath, tried };
    }
    // exe exists but won't run — PATH still missing Python deps?
    LOG("exe found but won't run — trying python -m semgrep fallback");
  } else {
    LOG("No exe found via fs");
  }

  // Step 3: Fallback — try python -m semgrep (PATH was patched)
  const fallbacks = isWin
    ? ["python -m semgrep --version", "py -m semgrep --version", "py -3 -m semgrep --version", "semgrep --version", "semgrep.exe --version"]
    : ["python3 -m semgrep --version", "python -m semgrep --version", "semgrep --version"];
  for (const cmd of fallbacks) {
    const r = tryExec(cmd, 60000);
    tried.push({ cmd, ...r });
    if (r.ok) {
      LOG("=== FOUND via fallback:", cmd, "===");
      return { available: true, cmd: cmd.replace(" --version", ""), tried };
    }
  }

  const envInfo = {
    platform: process.platform,
    PATH: process.env.PATH?.slice(0, 500) || '(empty)',
    USERPROFILE: process.env.USERPROFILE || '(not set)',
    SEMGREP_PATH: process.env.SEMGREP_PATH || '(not set)',
    exePathFound: exePath || '(not found)',
  };

  LOG("=== NOT AVAILABLE ===");
  return { available: false, tried, envInfo };
}

function findSemgrepCmd() {
  LOG("findSemgrepCmd() called");
  patchWindowsPath();

  // 1. SEMGREP_PATH
  if (process.env.SEMGREP_PATH && existsSync(process.env.SEMGREP_PATH)) {
    LOG("Using SEMGREP_PATH:", process.env.SEMGREP_PATH);
    return process.env.SEMGREP_PATH;
  }

  // 2. fs-based
  const exePath = findSemgrepExeFs();
  if (exePath) {
    const escaped = safePath(exePath);
    const r = tryExec(`"${escaped}" --version`, 60000);
    if (r.ok) {
      LOG("findSemgrepCmd: using", exePath);
      return exePath;
    }
  }

  // 3. Fallback
  const cmds = isWin
    ? ["python -m semgrep", "py -m semgrep", "py -3 -m semgrep", "semgrep", "semgrep.exe"]
    : ["semgrep", "python3 -m semgrep", "python -m semgrep"];
  for (const cmd of cmds) {
    if (tryExec(`${cmd} --version`, 60000).ok) {
      LOG("findSemgrepCmd: found via fallback:", cmd);
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

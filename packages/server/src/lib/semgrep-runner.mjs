/**
 * semgrep-runner.mjs — Run Semgrep static analysis on a project
 *
 * Cross-platform: finds semgrep binary (exe on Windows, binary on Mac/Linux),
 * uses local bundled rules (offline), falls back to registry rules (needs internet).
 *
 * Set SEMGREP_PATH env var to skip detection and use a specific binary directly.
 */

import { exec as execCb, execSync as execSyncCb } from "child_process";
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, resolve, extname, dirname } from "path";
import { promisify } from "util";
import { homedir, tmpdir } from "os";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// packages/server/src/lib → 4 levels up = repo root
const PAAW_ROOT = resolve(__dirname, "..", "..", "..", "..");

const exec = promisify(execCb);
const isWin = process.platform === "win32";

const LOG = (...args) => console.log("[semgrep]", ...args);

/** Normalize path: Windows backslashes → forward slashes */
function safePath(p) {
  if (!isWin || !p) return p;
  return p.replace(/\\/g, "/");
}

// ── Windows PATH patching ──

let _pathPatched = false;

function _patchWindowsPath() {
  if (!isWin || _pathPatched) return;
  _pathPatched = true;

  // Read user PATH from registry
  try {
    const regResult = execSyncCb(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    const lines = regResult.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
      if (m) {
        let userPath = m[1].trim();
        userPath = userPath.replace(/%([^%]+)%/g, (_, v) => process.env[v] || _);
        const currentPath = process.env.PATH || "";
        const currentSet = new Set(currentPath.toLowerCase().split(/;/).filter(Boolean));
        const missingParts = userPath.split(/;/).filter(p => p && !currentSet.has(p.toLowerCase()));
        if (missingParts.length > 0) {
          process.env.PATH = missingParts.join(";") + ";" + currentPath;
        }
        break;
      }
    }
  } catch {}

  // Scan Python Scripts dirs for semgrep.exe (fs only)
  const home = process.env.USERPROFILE || homedir();
  const scanBases = [
    join(home, "AppData", "Local", "Programs", "Python"),
    join(home, "AppData", "Roaming", "Python"),
  ];
  const dirsToAdd = new Set();

  for (const base of scanBases) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        const scriptsDir = join(base, entry, "Scripts");
        if (existsSync(scriptsDir)) dirsToAdd.add(scriptsDir);
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

export function detectRulePacks(projectRoot) {
  const LOCAL_RULES_DIR = resolve(PAAW_ROOT, "data/semgrep-rules/semgrep-rules");
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

function buildSemgrepCmd(semgrepBin, projectRoot, rulePacks, excludeArgs) {
  const bin = safePath(semgrepBin);
  const root = safePath(projectRoot);

  const configArgs = rulePacks.map(p => {
    const sp = safePath(p);
    if (sp.includes(" ")) return `--config "${sp}"`;
    return `--config ${sp}`;
  }).join(" ");

  // Binary: only quote if path has spaces
  const binPart = bin.includes(" ") ? `"${bin}"` : bin;
  const rootPart = root.includes(" ") ? `"${root}"` : root;

  return `${binPart} --metrics off --json ${configArgs} ${excludeArgs} --quiet ${rootPart}`;
}

export function buildFullScanCommand(projectRoot) {
  const semgrepBin = findSemgrepCmd();
  if (!semgrepBin) return null;
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
  return buildSemgrepCmd(semgrepBin, projectRoot, rulePacks, excludeArgs);
}

// ── Semgrep binary detection ──

function tryExec(cmd, timeout = 10000) {
  LOG("tryExec:", cmd, `(${timeout}ms)`);
  try {
    const result = execSyncCb(cmd, {
      stdio: "pipe",
      timeout,
      shell: true,
      env: { ...process.env },
      encoding: "utf-8",
    });
    return { ok: true, stdout: (result || "").trim() };
  } catch (e) {
    const errMsg = e.message?.split('\n')[0]?.slice(0, 200) || 'failed';
    LOG("tryExec FAIL:", cmd, "→", errMsg);
    return { ok: false, error: errMsg };
  }
}

/**
 * Find semgrep binary via fs (zero exec). Returns absolute path or null.
 * Windows: semgrep.exe in Python Scripts dirs
 * Mac/Linux: /opt/homebrew/bin/semgrep, /usr/local/bin/semgrep, etc.
 */
function findSemgrepExeFs() {
  LOG("findSemgrepExeFs() — pure fs scan");

  if (process.env.SEMGREP_PATH) {
    if (existsSync(process.env.SEMGREP_PATH)) {
      LOG("Found via SEMGREP_PATH:", process.env.SEMGREP_PATH);
      return process.env.SEMGREP_PATH;
    }
    LOG("SEMGREP_PATH set but not found:", process.env.SEMGREP_PATH);
  }

  if (!isWin) {
    // macOS/Linux: check common locations
    const paths = ["/opt/homebrew/bin/semgrep", "/usr/local/bin/semgrep", "/usr/bin/semgrep"];
    for (const p of paths) {
      if (existsSync(p)) { LOG("Found:", p); return p; }
    }
    return null;
  }

  // Windows: scan Python Scripts directories for semgrep.exe
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
            if (f.toLowerCase() === "semgrep.exe") {
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

// ── Public API ──

export function patchWindowsPath() { _patchWindowsPath(); }

export function isSemgrepAvailable() {
  return !!findSemgrepCmd();
}

export function diagnoseSemgrep() {
  LOG("=== diagnoseSemgrep() START ===");
  LOG("platform:", process.platform);

  // Fast path: SEMGREP_PATH set → use directly
  if (process.env.SEMGREP_PATH) {
    LOG("SEMGREP_PATH set → using directly:", process.env.SEMGREP_PATH);
    return {
      available: true,
      cmd: process.env.SEMGREP_PATH,
      tried: [{ cmd: "SEMGREP_PATH env", ok: true, stdout: `Using ${process.env.SEMGREP_PATH}` }],
      envOverride: true,
    };
  }

  if (isWin) _patchWindowsPath();

  const tried = [];

  // Step 1: Find binary via fs
  const exePath = findSemgrepExeFs();
  if (exePath) {
    LOG("Found binary at:", exePath);
    const escaped = safePath(exePath);
    const binCheck = escaped.includes(" ") ? `"${escaped}"` : escaped;
    const r = tryExec(`${binCheck} --version`, 10000);
    tried.push({ cmd: `${binCheck} --version`, ...r });
    if (r.ok) {
      return { available: true, cmd: exePath, tried };
    }
    LOG("binary found but won't run — trying PATH fallback");
  } else {
    LOG("No binary found via fs");
  }

  // Step 2: Fallback — try semgrep in PATH
  const fallbacks = isWin
    ? ["semgrep.exe --version", "semgrep --version"]
    : ["semgrep --version"];
  for (const cmd of fallbacks) {
    const r = tryExec(cmd, 10000);
    tried.push({ cmd, ...r });
    if (r.ok) {
      return { available: true, cmd: cmd.replace(" --version", ""), tried };
    }
  }

  return {
    available: false,
    tried,
    envInfo: {
      platform: process.platform,
      PATH: process.env.PATH?.slice(0, 500) || '(empty)',
      SEMGREP_PATH: process.env.SEMGREP_PATH || '(not set)',
      exePathFound: exePath || '(not found)',
    },
  };
}

function findSemgrepCmd() {
  // Fast path: SEMGREP_PATH
  if (process.env.SEMGREP_PATH) {
    LOG("SEMGREP_PATH → using directly:", process.env.SEMGREP_PATH);
    return process.env.SEMGREP_PATH;
  }

  if (isWin) _patchWindowsPath();

  // fs scan
  const exePath = findSemgrepExeFs();
  if (exePath) {
    const escaped = safePath(exePath);
    const binCheck = escaped.includes(" ") ? `"${escaped}"` : escaped;
    if (tryExec(`${binCheck} --version`, 10000).ok) return exePath;
  }

  // PATH fallback
  const cmds = isWin ? ["semgrep.exe", "semgrep"] : ["semgrep"];
  for (const cmd of cmds) {
    if (tryExec(`${cmd} --version`, 10000).ok) return cmd;
  }

  return null;
}

/**
 * Run Semgrep on a project and return structured results
 */
export async function runSemgrep(projectRoot, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const customPacks = options.rulePacks;

  LOG("runSemgrep() called, projectRoot:", projectRoot, "timeout:", timeoutMs);

  const semgrepBin = findSemgrepCmd();
  if (!semgrepBin) {
    return {
      findings: [],
      stats: { total: 0, bySeverity: {}, byCategory: {} },
      error: "Semgrep not found. Install: pip install semgrep, or set SEMGREP_PATH env var.",
    };
  }

  LOG("runSemgrep: using binary:", semgrepBin);

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

  // Write command to a temp script file to avoid Windows cmd.exe line length / newline issues
  const scriptExt = isWin ? ".bat" : ".sh";
  const scriptPath = join(tmpdir(), `semgrep-scan-${randomUUID()}${scriptExt}`);
  const scriptContent = isWin
    ? `@echo off\n${fullCmd}\n`
    : `#!/bin/sh\n${fullCmd}\n`;
  writeFileSync(scriptPath, scriptContent, "utf-8");
  LOG("runSemgrep: script file:", scriptPath);

  const runCmd = isWin ? `cmd /c "${safePath(scriptPath)}"` : `sh "${scriptPath}"`;

  try {
    const { stdout } = await exec(runCmd, {
      cwd: projectRoot,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      shell: true,
      env: { ...process.env },
    });

    // Clean up temp script
    try { require("fs").unlinkSync(scriptPath); } catch {}

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
    // Clean up temp script on error too
    try { require("fs").unlinkSync(scriptPath); } catch {}
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

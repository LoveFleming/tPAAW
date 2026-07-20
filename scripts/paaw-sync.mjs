#!/usr/bin/env node
/**
 * paaw-sync: Clone tPAAW → tPAAW-dev (refresh dev instance after development)
 *
 * Flow:
 *   1. tPAAW-dev runs Coding App (port 4200)
 *   2. Coding App imports tPAAW as the code project → you modify tPAAW directly
 *   3. Test → OK → run paaw-sync → tPAAW-dev becomes a fresh clone of tPAAW
 *   4. Restart tPAAW-dev → new features now in the Coding App too
 *   5. Repeat
 *
 * Usage:
 *   node scripts/paaw-sync.mjs              # tPAAW → tPAAW-dev (the only direction)
 *   node scripts/paaw-sync.mjs git          # via GitHub (needs remote)
 *   node scripts/paaw-sync.mjs status       # show diff
 *
 * Works on macOS + Windows (no rsync dependency)
 */

import { execSync, spawn } from "child_process";
import { existsSync, readdirSync, statSync, copyFileSync, mkdirSync, rmSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, relative, dirname, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";

// ── Paths ──
const HOME = isWin ? process.env.USERPROFILE : process.env.HOME;
const APP_DIR = isWin ? `${HOME}\\App` : `${HOME}/App`;
const TPAAW = resolve(APP_DIR, "tPAAW");
const TPAAW_DEV = resolve(APP_DIR, "tPAAW-dev");

// ── Color helpers (works in most terminals) ──
const c = {
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};
const info = s => console.log(`${c.cyan("[sync]")} ${s}`);
const ok   = s => console.log(`${c.green("[sync]")} ${s}`);
const warn = s => console.log(`${c.yellow("[sync]")} ${s}`);

// ── Parse args ──
const args = process.argv.slice(2);
let mode = "rsync"; // rsync or git

for (const arg of args) {
  if (arg === "git")    mode = "git";
  else if (arg === "dev") { warn("'dev' direction removed — tPAAW is always the source. Just run: paaw-sync"); process.exit(1); }
  else if (arg === "status") { /* handled below */ }
  else { console.log(`Unknown arg: ${arg}`); process.exit(1); }
}

// ── Exclude patterns — runtime state, not source code ──
// These dirs/files are NOT synced between instances
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "data", "backups", "building", "logs", ".paaw", "temp",
]);
const SKIP_FILES = new Set([".DS_Store"]);
const SKIP_PREFIXES = [".env", ".env.dev"]; // port-specific, don't overwrite

function shouldSkip(name, fullPath) {
  if (SKIP_DIRS.has(name)) return true;
  if (SKIP_FILES.has(name)) return true;
  if (SKIP_PREFIXES.some(p => name === p)) return true;
  return false;
}

// ── Recursive directory scan ──
function scanDir(dir, base = "") {
  const entries = [];
  if (!existsSync(dir)) return entries;
  try {
    for (const name of readdirSync(dir)) {
      if (shouldSkip(name)) continue;
      const full = join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) {
        entries.push(...scanDir(full, rel));
      } else {
        entries.push({ rel, full, size: st.size, mtime: st.mtimeMs });
      }
    }
  } catch {}
  return entries;
}

// ── Copy directory tree (like rsync -a --delete) ──
function syncTree(srcDir, dstDir) {
  let copied = 0, deleted = 0, unchanged = 0;

  // Build file maps: relPath → { full, size, mtime }
  const srcFiles = new Map();
  for (const f of scanDir(srcDir)) srcFiles.set(f.rel, f);

  const dstFiles = new Map();
  for (const f of scanDir(dstDir)) dstFiles.set(f.rel, f);

  // 1. Copy new/changed files from src to dst
  for (const [rel, src] of srcFiles) {
    const dst = dstFiles.get(rel);
    const dstPath = join(dstDir, rel);
    const dstDirPath = dirname(dstPath);

    if (!dst || dst.size !== src.size || Math.abs(dst.mtime - src.mtime) > 1000) {
      // File is new or changed
      if (!existsSync(dstDirPath)) mkdirSync(dstDirPath, { recursive: true });
      copyFileSync(src.full, dstPath);
      copied++;
    } else {
      unchanged++;
    }
  }

  // 2. Delete files in dst that don't exist in src (--delete mode)
  for (const [rel] of dstFiles) {
    if (!srcFiles.has(rel)) {
      const dstPath = join(dstDir, rel);
      try { unlinkSync(dstPath); deleted++; } catch {}
    }
  }

  // 3. Clean empty directories in dst
  function cleanEmptyDirs(dir) {
    if (!existsSync(dir)) return;
    try {
      for (const name of readdirSync(dir)) {
        if (shouldSkip(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          cleanEmptyDirs(full);
          // Remove if empty (after cleaning children)
          try {
            if (readdirSync(full).length === 0) rmSync(full, { recursive: true });
          } catch {}
        }
      }
    } catch {}
  }
  cleanEmptyDirs(dstDir);

  return { copied, deleted, unchanged };
}

// ── Git helper ──
function git(cwd, ...cmd) {
  try {
    return execSync(`git ${cmd.join(" ")}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════
//  STATUS MODE
// ══════════════════════════════════════════════════════════
if (args.includes("status")) {
  console.log("");
  console.log(c.cyan("═══ PAAW Sync Status ═══"));
  console.log("");

  if (existsSync(join(TPAAW, ".git"))) {
    const c1 = git(TPAAW, "log", "--oneline", "-1") || "(no git)";
    const c2 = git(TPAAW_DEV, "log", "--oneline", "-1") || "(no git)";
    console.log(`  tPAAW:     ${c1}`);
    console.log(`  tPAAW-dev: ${c2}`);
  }

  // Count different files
  const srcFiles = new Map();
  for (const f of scanDir(TPAAW)) srcFiles.set(f.rel, f);
  const dstFiles = new Map();
  for (const f of scanDir(TPAAW_DEV)) dstFiles.set(f.rel, f);

  let diffCount = 0;
  const diffList = [];
  for (const [rel, src] of srcFiles) {
    const dst = dstFiles.get(rel);
    if (!dst || dst.size !== src.size || Math.abs(dst.mtime - src.mtime) > 1000) {
      diffCount++;
      if (diffList.length < 15) diffList.push(rel);
    }
  }
  // Files only in dst
  for (const [rel] of dstFiles) {
    if (!srcFiles.has(rel)) { diffCount++; if (diffList.length < 15) diffList.push(`[D] ${rel}`); }
  }

  console.log(`  Files different: ${diffCount}`);
  if (diffList.length > 0 && diffCount <= 15) {
    for (const f of diffList) console.log(`    ${f}`);
  } else if (diffList.length > 0) {
    for (const f of diffList) console.log(`    ${f}`);
    console.log(`    ... and ${diffCount - diffList.length} more`);
  }
  console.log("");
  process.exit(0);
}

// ── Direction: always tPAAW → tPAAW-dev ──
const SRC = TPAAW;
const DST = TPAAW_DEV;
const LABEL = "tPAAW → tPAAW-dev";

console.log("");
console.log(c.cyan(`═══ PAAW Sync: ${LABEL} ═══`));
console.log(`  Mode: ${mode}`);
console.log("");

// ══════════════════════════════════════════════════════════
//  RSYNC MODE (default) — 直接複製，不需要 GitHub
// ══════════════════════════════════════════════════════════
if (mode === "rsync") {
  // Safety: auto-commit in destination before overwrite
  if (existsSync(join(DST, ".git"))) {
    const dirty = git(DST, "status", "--short");
    if (dirty) {
      warn("Destination has uncommitted files — auto-committing as safety net...");
      git(DST, "add", "-A");
      git(DST, "commit", "-m", `auto: pre-sync snapshot ${new Date().toISOString().slice(0,16).replace("T","-")}`, "--allow-empty-message");
    }
  }

  info("Syncing source files...");
  const result = syncTree(SRC, DST);

  if (result.copied === 0 && result.deleted === 0) {
    ok("Already in sync — no changes needed.");
  } else {
    ok(`Copied: ${result.copied}, Deleted: ${result.deleted}, Unchanged: ${result.unchanged}`);
  }

  // Auto-commit result in destination
  if (existsSync(join(DST, ".git"))) {
    git(DST, "add", "-A");
    const diff = git(DST, "diff", "--cached", "--stat");
    if (diff) {
      git(DST, "commit", "-m", `sync: ${LABEL} (${new Date().toISOString().slice(0,16).replace("T","-")})`, "--allow-empty-message");
      ok("Destination auto-committed sync result.");
    }
  }

  // npm install if package files changed
  if (existsSync(join(DST, "package.json"))) {
    info("Running npm install in destination...");
    try { execSync("npm install --silent", { cwd: DST, stdio: "pipe" }); } catch {}
  }

  ok(`✅ rsync complete: ${LABEL}`);
  console.log("");
  process.exit(0);
}

// ══════════════════════════════════════════════════════════
//  GIT MODE — 透過 GitHub 同步（需要 GitHub repo）
// ══════════════════════════════════════════════════════════
if (mode === "git") {
  // Auto-commit in source
  const srcDirty = git(SRC, "status", "--short");
  if (srcDirty) {
    warn("Source has uncommitted files — auto-committing...");
    git(SRC, "add", "-A");
    git(SRC, "commit", "-m", `auto: pre-sync snapshot ${new Date().toISOString().slice(0,16).replace("T","-")}`, "--allow-empty-message");
  }

  // Push from source
  info("Pushing from source...");
  git(SRC, "push", "origin", "dev") || git(SRC, "push", "--force-with-lease", "origin", "dev");

  // Pull in destination
  info("Pulling in destination...");
  const dstDirty = git(DST, "status", "--short");
  if (dstDirty) {
    warn("Destination has uncommitted files — stashing...");
    git(DST, "stash", "--include-untracked", "-q");
  }

  git(DST, "fetch", "origin", "dev");
  git(DST, "reset", "--hard", "origin/dev") || git(DST, "pull", "--force", "origin", "dev");

  if (dstDirty) {
    git(DST, "stash", "pop", "-q") || warn("Stash pop had conflicts (check manually)");
  }

  // npm install
  if (existsSync(join(DST, "package.json"))) {
    info("Running npm install...");
    try { execSync("npm install --silent", { cwd: DST, stdio: "pipe" }); } catch {}
  }

  ok(`✅ git sync complete: ${LABEL}`);
  console.log("");
  process.exit(0);
}

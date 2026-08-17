/**
 * PaawSnapshot — Auto-snapshot before AI modifications
 *
 * Creates lightweight file snapshots before AI makes changes,
 * allowing undo of individual files or entire sessions.
 *
 * Snapshots stored in .paaw/snapshots/YYYY-MM-DD-HHmmss-{label}/
 * Each snapshot contains:
 *   - manifest.json (list of files + their hash at snapshot time)
 *   - files/ (copies of the actual files)
 *
 * Snapshots are auto-created by Agent Loop before write_file/edit_file.
 * Manual snapshots can be triggered from UI.
 */

import { readFile, writeFile, readdir, stat, mkdir, copyFile, rm } from "fs/promises";
import { existsSync, readFileSync as readSync } from "fs";
import { resolve, join, dirname } from "path";
import { createHash } from "crypto";
import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "./shell-exec.mjs";
import { safeResolve } from "./coding-security";

async function runShell(command, cwd, timeoutMs = 10_000) {
  try {
    const { stdout, stderr } = await shellExec(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return (stdout || "") + (stderr ? "\n" + stderr : "");
  } catch (e) {
    let output = e.stdout || "";
    if (e.stderr) output += (output ? "\n" : "") + e.stderr;
    return output;
  }
}

export class PaawSnapshot {
  constructor(projectRoot, paawDir) {
    this.root = projectRoot;
    this.paawDir = paawDir;  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
    this.snapDir = join(paawDir, "snapshots");
  }

  // ── Create snapshot ──

  async create(label = "manual", files = null) {
    const ts = new Date();
    const tsStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}`;  // nosemgrep: path-join-resolve-traversal
    const snapName = `${tsStr}-${label}`;  // nosemgrep: path-join-resolve-traversal
    const snapPath = safeResolve(this.snapDir, snapName);
// nosemgrep: path-join-resolve-traversal
    const filesDir = join(snapPath, "files");

    await mkdir(filesDir, { recursive: true });

    // Determine which files to snapshot
    let fileList = files;
    if (!fileList) {
      // Auto-detect tracked files from git
      try {
        const gitFiles = await runShell("git ls-files", this.root, 5000);
        fileList = gitFiles.trim().split("\n").filter(Boolean);
      } catch {
        fileList = [];
      }
    }

    // Copy files and build manifest
    const manifest = {
      label,
      timestamp: ts.toISOString(),
      projectRoot: this.root,
      fileCount: 0,
      files: {}, // { relativePath: { hash, size } }
    };
  // nosemgrep: path-join-resolve-traversal
    for (const relPath of fileList) {
      if (!relPath || relPath.startsWith(".paaw/")) continue;
      const absPath = safeResolve(this.root, relPath);
      if (!existsSync(absPath)) continue;

      try {
        const content = await readFile(absPath);
        const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
        manifest.files[relPath] = { hash, size: content.length };  // nosemgrep: path-join-resolve-traversal

        // Copy to snapshot
        const destPath = safeResolve(filesDir, relPath);
        await mkdir(dirname(destPath), { recursive: true });
        await copyFile(absPath, destPath);
        manifest.fileCount++;
      } catch {}
    }  // nosemgrep: path-join-resolve-traversal

    // Write manifest
// nosemgrep: path-join-resolve-traversal
    await writeFile(join(snapPath, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    return { name: snapName, path: snapPath, fileCount: manifest.fileCount };
  }

  // ── Pre-modification snapshot (lightweight: only changed files) ──

  async createPreEdit(filePath) {
    const relPath = filePath.replace(this.root + "/", "");
    return this.create("pre-edit", [relPath]);
  }

  // ── List snapshots ──

  async list() {
    if (!existsSync(this.snapDir)) return [];
    try {
      const entries = await readdir(this.snapDir);
      const snapshots = [];
      for (const name of entries.sort().reverse()) {
        const manifestPath = safeResolve(this.snapDir, name, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(readSync(manifestPath, "utf-8"));
          snapshots.push({
            name,
            label: manifest.label,
            timestamp: manifest.timestamp,
            fileCount: manifest.fileCount,
          });
        } catch {}
      }
      return snapshots;
    } catch {
      return [];
    }
  }
  // nosemgrep: path-join-resolve-traversal
  // ── Restore a file from snapshot ──  // nosemgrep: path-join-resolve-traversal

  async restoreFile(snapName, relPath) {
    const srcPath = safeResolve(this.snapDir, snapName, "files", relPath);
    const destPath = safeResolve(this.root, relPath);

    if (!existsSync(srcPath)) {
      return { ok: false, error: "File not found in snapshot" };
    }

    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
    return { ok: true, path: destPath };
  }
  // nosemgrep: path-join-resolve-traversal
  // ── Diff a file between snapshot and current ──  // nosemgrep: path-join-resolve-traversal

  async diffFile(snapName, relPath) {
    const snapPath = safeResolve(this.snapDir, snapName, "files", relPath);
    const currPath = safeResolve(this.root, relPath);

    if (!existsSync(snapPath)) return { error: "Snapshot file not found" };

    const snapContent = await readFile(snapPath, "utf-8");
    const currContent = existsSync(currPath) ? await readFile(currPath, "utf-8") : "";

    const snapHash = createHash("sha256").update(snapContent).digest("hex").slice(0, 12);
    const currHash = createHash("sha256").update(currContent).digest("hex").slice(0, 12);

    return {
      changed: snapHash !== currHash,
      snapshot: { hash: snapHash, lines: snapContent.split("\n").length },
      current: { hash: currHash, lines: currContent.split("\n").length },
    };
  }

  // ── Cleanup old snapshots (keep last N) ──

  async cleanup(maxKeep = 50) {
    const snaps = await this.list();
    if (snaps.length <= maxKeep) return { removed: 0 };

    const toRemove = snaps.slice(maxKeep);  // nosemgrep: path-join-resolve-traversal
    let removed = 0;
    for (const snap of toRemove) {
      try {
        await rm(safeResolve(this.snapDir, snap.name), { recursive: true, force: true });
        removed++;
      } catch {}
    }
    return { removed, remaining: snaps.length - removed };
  }
}

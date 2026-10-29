// ── Doc Coverage Tracking ──
// Tracks which commits have been documented by Doc Writer

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read doc-coverage.json for a project
 * @param {string} projectDir - project root directory
 * @returns {{ lastDocumentedCommit: string, documentedCommits: string[] }}
 */
export function readDocCoverage(projectDir) {
  const path = join(projectDir, ".paaw", "doc-coverage.json");
  if (!existsSync(path)) {
    return { lastDocumentedCommit: "", documentedCommits: [] };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { lastDocumentedCommit: "", documentedCommits: [] };
  }
}

/**
 * Write doc-coverage.json for a project
 */
export function writeDocCoverage(projectDir, coverage) {
  const path = join(projectDir, ".paaw", "doc-coverage.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(coverage, null, 2) + "\n");
}

/**
 * Update doc coverage after Doc Writer processes commits
 * @param {string} projectDir
 * @param {string} newLastCommit - the latest commit hash that was documented
 * @param {string[]} documentedCommits - list of commit hashes that got docs
 */
export function updateDocCoverage(projectDir, newLastCommit, documentedCommits = []) {
  const current = readDocCoverage(projectDir);
  const all = new Set([...current.documentedCommits, ...documentedCommits]);
  // If newLastCommit is provided, update the marker
  if (newLastCommit) {
    current.lastDocumentedCommit = newLastCommit;
  }
  current.documentedCommits = [...all].slice(-200); // keep last 200
  current.updatedAt = new Date().toISOString();
  writeDocCoverage(projectDir, current);
  return current;
}

/**
 * Get the list of undocumented commits since last documentation
 * @param {string} projectDir
 * @param {Function} runGit - async function(args, cwd) => { stdout, stderr, ok }
 * @returns {Promise<{ commits: string[], lastDocumented: string, currentHead: string }>}
 */
export async function getUndocumentedCommits(projectDir, runGit) {
  const coverage = readDocCoverage(projectDir);
  const headResult = await runGit(["rev-parse", "HEAD"], projectDir);
  const currentHead = headResult.stdout.trim();

  if (!coverage.lastDocumentedCommit) {
    // First time — just get last 10 commits
    const r = await runGit(["log", "--oneline", "-10"], projectDir);
    const commits = r.stdout.trim().split("\n").filter(Boolean);
    return { commits, lastDocumented: "", currentHead };
  }

  if (coverage.lastDocumentedCommit === currentHead) {
    return { commits: [], lastDocumented: coverage.lastDocumentedCommit, currentHead };
  }

  const r = await runGit(["log", "--oneline", `${coverage.lastDocumentedCommit}..HEAD`], projectDir);
  const commits = r.stdout.trim().split("\n").filter(Boolean);
  return { commits, lastDocumented: coverage.lastDocumentedCommit, currentHead };
}

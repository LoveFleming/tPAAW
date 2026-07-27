/**
 * change-intelligence.mjs — Change Intelligence for AI agents
 *
 * Answers: "What was recently changed, and what might break?"
 *
 * Uses git log + git diff to build:
 * 1. Recent file changes (with commit info)
 * 2. Recently modified features (via file→feature mapping)
 * 3. Recently modified APIs (via file→route mapping)
 * 4. Recently modified functions (via git diff function names)
 * 5. Decision log (from .paaw/DECISIONS.md)
 * 6. Impact analysis: "if I change X, what else is affected?"
 *
 * Output: .paaw/changes/change-intelligence.json
 */

import { exec as execCb } from "child_process";
import { shellExec, IS_WIN } from "./shell-exec.mjs";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";
import { PaawProject } from "./paaw-project.mjs";

const exec = promisify(execCb);

/**
 * Run git command and return stdout
 */
async function git(projectRoot, args) {
  try {
    const { stdout } = await shellExec(`git ${args}`, {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Build Change Intelligence data
 * @param {string} projectRoot
 * @param {object} options - { days: 30, maxCommits: 50 }
 * @returns {Promise<{ summary: object, data: object }>}
 */
export async function buildChangeIntelligence(projectRoot, options = {}) {
  const days = options.days || 30;
  const maxCommits = options.maxCommits || 50;

  // ── 1. Recent commits ──
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const logOutput = await git(projectRoot, `log --pretty='format:%H|%h|%an|%ad|%s' --date=iso --since="${sinceDate}" -${maxCommits} --name-only`);

  const commits = [];
  let currentCommit = null;

  for (const line of logOutput.split("\n")) {
    if (!line) continue;
    if (line.includes("|")) {
      const [hash, short, author, date, subject] = line.split("|");
      currentCommit = {
        hash,
        short,
        author,
        date: new Date(date).toISOString(),
        subject,
        files: [],
      };
      commits.push(currentCommit);
    } else if (currentCommit && line.trim()) {
      currentCommit.files.push(line.trim());
    }
  }

  // ── 2. Recently modified files (aggregated) ──
  const fileChangeCount = {};
  const fileLastChanged = {};
  const fileCommits = {};

  for (const commit of commits) {
    for (const file of commit.files) {
      fileChangeCount[file] = (fileChangeCount[file] || 0) + 1;
      if (!fileLastChanged[file] || new Date(commit.date) > new Date(fileLastChanged[file])) {
        fileLastChanged[file] = commit.date;
      }
      if (!fileCommits[file]) fileCommits[file] = [];
      fileCommits[file].push(commit.short);
    }
  }

  const recentFiles = Object.entries(fileChangeCount)
    .map(([file, count]) => ({
      file,
      changeCount: count,
      lastChanged: fileLastChanged[file],
      commits: fileCommits[file],
    }))
    .sort((a, b) => new Date(b.lastChanged) - new Date(a.lastChanged));

  // ── 3. Recently modified features ──
  const featuresPath = join(projectRoot, ".paaw", "features", "FEATURES.json");
  const fileFeaturesPath = join(projectRoot, ".paaw", "features", "FILE-FEATURES.json");
  const recentFeatures = [];

  if (existsSync(fileFeaturesPath)) {
    try {
      const fileFeatureMap = JSON.parse(readFileSync(fileFeaturesPath, "utf-8"));
      const featureCount = {};

      for (const { file } of recentFiles) {
        const norm = file.replace(/\\/g, "/");
        const features = fileFeatureMap.files?.[norm];
        if (features) {
          for (const feat of features) {
            if (!featureCount[feat.id]) {
              featureCount[feat.id] = { ...feat, changeCount: 0, files: [] };
            }
            featureCount[feat.id].changeCount++;
            featureCount[feat.id].files.push(file);
          }
        }
      }

      recentFeatures.push(...Object.values(featureCount).sort((a, b) => b.changeCount - a.changeCount));
    } catch {}
  }

  // ── 4. Recently modified APIs ──
  const apiMapPath = join(projectRoot, ".paaw", "code-intelligence", "api-function-map.json");
  const recentApis = [];

  if (existsSync(apiMapPath)) {
    try {
      const apiMap = JSON.parse(readFileSync(apiMapPath, "utf-8"));
      for (const route of apiMap.routes || []) {
        const wasModified = recentFiles.some(f => f.file === route.file);
        if (wasModified) {
          recentApis.push({
            method: route.method,
            path: route.path,
            file: route.file,
            handler: route.handler,
          });
        }
      }
    } catch {}
  }

  // ── 5. Decision log ──
  const paaw = new PaawProject(projectRoot);
  const decisionsPath = paaw._resolvePath("DECISIONS.md");
  let decisions = [];
  if (existsSync(decisionsPath)) {
    const content = readFileSync(decisionsPath, "utf-8");
    // Parse ADR-style entries: ## ADR-XXX: Title
    const adrPattern = /^##\s+(ADR-\d+|Decision)\s*:?\s*(.+)$/gm;
    let match;
    while ((match = adrPattern.exec(content)) !== null) {
      decisions.push({
        id: match[1],
        title: match[2].trim(),
      });
    }
  }

  // ── 6. Impact analysis ──
  // Given a recently changed file, what other files depend on it?
  const depGraphPath = join(projectRoot, ".paaw", "code-intelligence", "dependency-graph.json");
  const impactAnalysis = [];

  if (existsSync(depGraphPath)) {
    try {
      const depGraph = JSON.parse(readFileSync(depGraphPath, "utf-8"));
      for (const { file } of recentFiles.slice(0, 20)) {
        const norm = file.replace(/\\/g, "/");
        const dependents = depGraph.files?.[norm]?.importedBy || [];
        if (dependents.length > 0) {
          impactAnalysis.push({
            changedFile: norm,
            affectedFiles: dependents.map(d => d.source),
            impactLevel: dependents.length > 5 ? "high" : dependents.length > 2 ? "medium" : "low",
          });
        }
      }
    } catch {}
  }

  // ── 7. Git diff stats (overall) ──
  const diffStat = await git(projectRoot, `diff --stat HEAD~${Math.min(maxCommits, commits.length)} HEAD 2>/dev/null || echo ""`);

  // ── Build summary ──
  const summary = {
    period: `${days} days`,
    totalCommits: commits.length,
    totalFilesChanged: recentFiles.length,
    totalFeaturesChanged: recentFeatures.length,
    totalApisChanged: recentApis.length,
    totalDecisions: decisions.length,
    highImpactChanges: impactAnalysis.filter(i => i.impactLevel === "high").length,
    topChangedFiles: recentFiles.slice(0, 5).map(f => ({ file: f.file, changes: f.changeCount })),
  };

  const data = {
    generatedAt: new Date().toISOString(),
    period: `${days} days`,
    commits: commits.map(c => ({
      hash: c.short,
      author: c.author,
      date: c.date,
      subject: c.subject,
      fileCount: c.files.length,
      files: c.files.slice(0, 10), // cap per commit
    })),
    recentFiles,
    recentFeatures,
    recentApis,
    decisions,
    impactAnalysis,
    diffStat: diffStat.slice(0, 2000),
    summary,
  };

  // Save
  const changesDir = join(projectRoot, ".paaw", "changes");
  if (!existsSync(changesDir)) mkdirSync(changesDir, { recursive: true });
  writeFileSync(join(changesDir, "change-intelligence.json"), JSON.stringify(data, null, 2), "utf-8");

  return { summary, data };
}

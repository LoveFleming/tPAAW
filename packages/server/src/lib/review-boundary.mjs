/**
 * review-boundary.mjs — Review Boundary for Feature Guardrail (R1)
 *
 * 「AI 改完 → 比對 fileScope vs 實際 diff → 分 expected/unexpected」
 * 人先看 unexpected changes，不用逐行 review。
 *
 * Deterministic only — no LLM.
 *   Scope  = task.spec.fileScope + task.changes（agent 宣告的檔案）
 *   Actual = git diff（已 commit → commit 範圍；未 commit → working tree）
 *   Result = expected / unexpected（附 feature 歸屬，供人判斷）
 */
import { exec as _exec } from "child_process";
import { promisify } from "util";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const execAsync = promisify(_exec);

// ── Path helpers（跨平台紀律：一律 normalize 成 / ）──

export function _normPath(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * file 是否在 scope 內。
 * 支援：完全相同 / scope 是目錄前綴（scope 不帶副檔名時視為目錄）
 * e.g. scope "packages/ui/src" 涵蓋 "packages/ui/src/components/Foo.tsx"
 */
function _inScope(file, scopeSet) {
  const f = _normPath(file);
  if (scopeSet.has(f)) return true;
  for (const s of scopeSet) {
    if (s.endsWith("/") ? f.startsWith(s) : f.startsWith(s + "/")) return true;
  }
  return false;
}

// ── Git actual changed files ──

/**
 * 取得 task 實際變更檔案（git 事實，非 agent 自報）。
 * 已 commit → diff base..head（或單一 commit）
 * 未 commit → working tree status
 * @returns {Promise<Array<{path, status}>>} status: A/M/D/R
 */
async function _actualChangedFiles(projectPath, task) {
  const git = task.git || {};
  const head = git.commitSha || git.committedSha || null;
  const base = git.baseCommit || null;

  try {
    if (head && base) {
      const { stdout } = await execAsync(
        `git diff --name-status ${base}..${head}`,
        { cwd: projectPath, maxBuffer: 4 * 1024 * 1024, timeout: 15000 }
      );
      return _parseNameStatus(stdout);
    }
    if (head) {
      // 單一 commit 範圍（base 未記錄時）：head^..head
      const { stdout } = await execAsync(
        `git diff --name-status ${head}^..${head}`,
        { cwd: projectPath, maxBuffer: 4 * 1024 * 1024, timeout: 15000 }
      );
      return _parseNameStatus(stdout);
    }
    // 未 commit：working tree（-uall：展開 untracked 目錄，否則 git 壓縮成 "?? dir/" 穿過 noise filter）
    const { stdout } = await execAsync("git status --porcelain -uall", {
      cwd: projectPath, maxBuffer: 4 * 1024 * 1024, timeout: 15000,
    });
    return _parsePorcelain(stdout);
  } catch {
    return [];
  }
}

function _parseNameStatus(stdout) {
  // "M\tpath/to/file" / "R100\told\tnew"
  return stdout.trim().split("\n").filter(Boolean).map(line => {
    const cols = line.split(/\t/);
    const st = (cols[0] || "").trim();
    const status = st.startsWith("A") ? "A" : st.startsWith("D") ? "D" : st.startsWith("R") ? "R" : "M";
    const path = status === "R" ? cols[2] : cols[1]; // rename 取新路徑
    return { path: _normPath(path), status };
  }).filter(f => f.path);
}

function _parsePorcelain(stdout) {
  // " M path" / "?? path" / "A  path"（staged 新檔只隔 1 空格 — 不可 slice 固定位）
  return stdout.trim().split("\n").filter(Boolean).map(line => {
    const m = line.match(/^(..?)\s+(.*)$/);
    if (!m) return null;
    const st = m[1].trim();
    const path = _normPath(m[2].split(" -> ").pop()); // rename 顯示 "old -> new"
    const status = (st === "??" || st.includes("A")) ? "A" : st.includes("D") ? "D" : st.includes("R") ? "R" : "M";
    return { path, status };
  }).filter(f => f && f.path);
}

// ── Feature attribution（FILE-FEATURES.json，純查表）──

function _featureFor(path, fileFeatureMap) {
  const hit = fileFeatureMap[_normPath(path)];
  if (Array.isArray(hit) && hit.length > 0) {
    return hit.map(f => f.id || f.name).filter(Boolean);
  }
  return [];
}

function _loadFileFeatureMap(projectPath) {
  const ffFile = join(projectPath, ".paaw", "features", "FILE-FEATURES.json");
  if (!existsSync(ffFile)) return {};
  try {
    const data = JSON.parse(readFileSync(ffFile, "utf-8"));
    return data.files || data;
  } catch {
    return {};
  }
}

// ── 橫切關注點觸及（Change/Review Boundary ⊕ crosscut overlay）──
// 改動碰到「散在多條 feature、無獨立 feature」的橫切符號（如 Budget Control）→ review 警示。
// evidence 是 file:line:symbol，檔案級比對（v1）；line 級留待 diff hunk 分析。
/** 🧪 可信回歸清單：改動 feature → 它有那些測試、哪些真的跑得起來 */
function _loadTestSignals(projectPath) {
  const p = join(projectPath, ".paaw", "features", "TEST-SIGNALS.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function _regressionTests(changedPaths, projectPath, fileFeatureMap, featuresInTask) {
  const sig = _loadTestSignals(projectPath);
  if (!sig) return null;
  const fileMap = fileFeatureMap || _loadFileFeatureMap(projectPath);
  const byF = sig.byFeature || {};
  const byFile = sig.byFile || {};

  // 改動檔 → 涉及 feature id
  const featIds = new Set(featuresInTask || []);
  for (const p of changedPaths) {
    for (const e of fileMap[_normPath(p)] || []) if (e?.id) featIds.add(e.id);
  }
  if (featIds.size === 0) return { features: [], runnable: [], needsKey: [], needsNetwork: [], needsService: [], uncovered: [], totals: { features: 0, tests: 0, runnable: 0 } };

  const out = { features: [...featIds], runnable: [], needsKey: [], needsNetwork: [], needsService: [], uncovered: [], totals: { features: featIds.size, tests: 0, runnable: 0 } };
  for (const fid of featIds) {
    const b = byF[fid];
    if (!b) { out.uncovered.push(fid); continue; }
    const push = (arr, list) => { for (const t of list) arr.push({ feature: fid, file: t, hermeticity: (byFile[t] || {}).hermeticity }); };
    const n = (b.hermetic || []).length + (b["needs-key"] || []).length + (b["needs-network"] || []).length + (b["needs-service"] || []).length + (b.unknown || []).length;
    out.totals.tests += n;
    if (n === 0) { out.uncovered.push(fid); continue; }
    push(out.runnable, b.hermetic || []);
    push(out.needsKey, b["needs-key"] || []);
    push(out.needsNetwork, b["needs-network"] || []);
    push(out.needsService, b["needs-service"] || []);
  }
  out.totals.runnable = out.runnable.length;
  out.note = "hermetic=clone 即可跑（可信回歸）；needs-* 需外部條件，跑不動不代表 code 壞。確定性判定，附 evidence。";
  return out;
}

function _loadCrosscut(projectPath) {  const p = join(projectPath, ".paaw", "features", "CROSSCUT-CONCEPTS.json");
  if (!existsSync(p)) return [];
  try {
    const d = JSON.parse(readFileSync(p, "utf-8"));
    return (d.concepts || []).filter((c) => !c.aiClipped);
  } catch {
    return [];
  }
}

export function _crosscutTouches(changedPaths, concepts) {
  const changed = new Set(changedPaths.map(_normPath));
  const byFile = new Map(); // file → concept[]
  for (const c of concepts) {
    const hitFiles = new Set();
    for (const e of c.evidence || []) {
      const f = _normPath(e.file || "");
      if (f && changed.has(f)) hitFiles.add(f);
    }
    if (hitFiles.size === 0) continue;
    for (const f of hitFiles) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push({
        conceptId: c.id,
        name: c.aiName || c.name,
        crossFeatureCount: c.crossFeatureCount,
        features: c.features || [],
        dominantShare: c.dominantShare ?? null,
      });
    }
  }
  return byFile;
}

// ── Main ──

/**
 * Build Review Boundary for a task.
 * @param {string} projectPath — 專案 root
 * @param {Object} task — TASKS.json 內的 task 物件
 * @returns {Promise<Object>} reviewBoundary 片段（存 task.reviewBoundary / 餵 evidence）
 */
export async function buildReviewBoundary(projectPath, task) {
  const fileScope = (task.spec?.fileScope || []).map(_normPath).filter(Boolean);
  const declared = [
    ...(task.changes?.filesAdded || []),
    ...(task.changes?.filesModified || []),
    ...(task.changes?.filesDeleted || []),
  ].map(_normPath).filter(Boolean);

  const scopeSet = new Set([...fileScope, ...declared]);
  const hasScope = scopeSet.size > 0;

  const actual = await _actualChangedFiles(projectPath, task);

  // 排除 runtime noise（自動變更、非 code review 對象，除非 task 明確宣告）
  const NOISE_RE = /^(\.paaw\/(tmp|coding-memory\/|cu-debug\.log|auto-dispatch\/reports|code-intelligence\/status)|logs\/|node_modules\/|.*\.tsbuildinfo$|.*\.log$)/;
  const reviewable = actual.filter(f => !NOISE_RE.test(f.path) || scopeSet.has(f.path));
  const noise = actual.filter(f => !reviewable.includes(f)).map(f => f.path);

  const fileFeatureMap = _loadFileFeatureMap(projectPath);

  const expectedFiles = [];
  const unexpectedFiles = [];
  for (const f of reviewable) {
    if (!hasScope || _inScope(f.path, scopeSet)) {
      expectedFiles.push(f);
    } else {
      unexpectedFiles.push({ ...f, features: _featureFor(f.path, fileFeatureMap) });
    }
  }

  const git = task.git || {};
  const head = git.commitSha || git.committedSha || null;

  // ③ 橫切關注點觸及：改動檔命中的 overlay 概念（散在多 feature 的能力）
  const concepts = _loadCrosscut(projectPath);
  const ccByFile = _crosscutTouches(reviewable.map((f) => f.path), concepts);
  const attachCc = (f) => ({ ...f, crosscut: ccByFile.get(_normPath(f.path)) || undefined });
  const crosscutTouches = [];
  const seen = new Set();
  for (const [file, cs] of [...ccByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const c of cs) {
      if (seen.has(c.conceptId)) {
        crosscutTouches.find((x) => x.conceptId === c.conceptId).changedFiles.push(file);
        continue;
      }
      seen.add(c.conceptId);
      crosscutTouches.push({ conceptId: c.conceptId, name: c.name, crossFeatureCount: c.crossFeatureCount, features: c.features, dominantShare: c.dominantShare, changedFiles: [file] });
    }
  }
  crosscutTouches.sort((a, b) => b.crossFeatureCount - a.crossFeatureCount || a.name.localeCompare(b.name));
  const crosscutWarnings = crosscutTouches
    .filter((t) => t.crossFeatureCount >= 3)
    .map((t) => `改動碰觸橫切關注點「${t.name}」（散在 ${t.crossFeatureCount} 條 feature：${t.features.slice(0, 6).join("/")}）— 請確認影響面`);

  // 🧪 可信回歸清單（改動 feature → 測試，依自足性分區）
  const regressionTests = _regressionTests(reviewable.map((f) => f.path), projectPath, fileFeatureMap, task?.featureIds);

  return {
    version: 1,
    hasScope,
    scopeCount: scopeSet.size,
    scopeFiles: [...scopeSet],
    commitRange: head ? { base: git.baseCommit || `${head}^`, head } : "working-tree",
    expectedFiles: expectedFiles.map(attachCc),
    unexpectedFiles: unexpectedFiles.map(attachCc),
    noiseFiles: noise,
    crosscutTouches,
    crosscutWarnings,
    regressionTests,
    summary: {
      total: reviewable.length,
      expected: expectedFiles.length,
      unexpected: unexpectedFiles.length,
      hasUnexpected: unexpectedFiles.length > 0,
      crosscutTouches: crosscutTouches.length,
      hasCrosscutTouch: crosscutTouches.length > 0,
      runnableTests: regressionTests?.totals?.runnable ?? null,
    },
    checkedAt: new Date().toISOString(),
  };
}

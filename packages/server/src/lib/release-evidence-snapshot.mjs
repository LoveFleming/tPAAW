/**
 * release-evidence-snapshot — baseline 錨點 Release Evidence 凍結快照（Phase A，2026-10-30 定稿）
 *
 * Fleming 定調：Evidence Matrix 不是隨時保綠的儀表板，是「對著人選 baseline 的出貨檢查表」。
 *   - 人進 Release Manager page 選 baseline commit 按一下 → 生成凍結快照（不可變）
 *   - 範圍 = baseline..HEAD 的 delta（被動 features）— 證據綁 commit 範圍不漂
 *   - 紅格 = 補強清單，點擊開單（EM 派工），補完重新生成新快照（快照不可變，不就地刷新）
 *
 * 證據來源全 deterministic（No answer without evidence）：
 *   Unit     ← .paaw/test-runs/last.json（run id）× feature tests 映射
 *   E2E      ← changed APIs 的 e2e 內容覆蓋（測試檔語料比對）
 *   SG       ← .paaw/security/scan-results.json
 *   AI-RV    ← .paaw/review-board/*.md
 *   QA/Human ← qa-results（.paaw/coding-memory/qa-results.jsonl）
 *
 * 快照存 .paaw/release/evidence/EVD-YYYYMMDD-HHMM-<short>.json
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { shellExec } from "./shell-exec.mjs";
import { readLastTestRun } from "./test-runner.mjs";
import { buildEvidenceMatrix, loadSecurityScan, loadReviewBoard } from "./release-evidence.mjs";
import { resolveBaseline } from "./release-requests.mjs";

const _normPath = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");

function evidenceDir(projectPath) {
  return join(projectPath, ".paaw", "release", "evidence");
}

// ── git（deterministic）──
async function git(projectPath, args) {
  try {
    const { stdout } = await shellExec(`git ${args}`, { cwd: projectPath, timeout: 15000 });
    return stdout;
  } catch { return ""; }
}

async function gitHeadInfo(projectPath) {
  const sha = (await git(projectPath, "rev-parse HEAD")).trim() || null;
  if (!sha) return null;
  const subject = (await git(projectPath, "log -1 --pretty=%s")).trim();
  return { sha, short: sha.slice(0, 8), subject };
}

async function changedFilesSince(projectPath, baselineSha) {
  const out = await git(projectPath, `diff --name-only ${baselineSha}..HEAD`);
  return out.split(/\r?\n/).map(_normPath).filter((f) => f && !f.startsWith(".paaw/"));
}

async function commitsSince(projectPath, baselineSha) {
  const out = await git(projectPath, `log ${baselineSha}..HEAD --pretty=%h%x09%an%x09%s`);
  const lines = out.split(/\r?\n/).filter(Boolean);
  return {
    count: lines.length,
    authors: [...new Set(lines.map((l) => l.split("\t")[1]).filter(Boolean))],
    subjects: lines.slice(0, 30).map((l) => l.split("\t").slice(0, 1).concat(l.split("\t").slice(2)).join(" ")),
  };
}

// ── release-unit model（fresh-or-rebuild；失敗降級合成 — 同 readiness 策略）──
async function loadModel(projectPath) {
  try {
    const { loadReleaseUnitModel } = await import("./release-unit/model.mjs");
    return { model: await loadReleaseUnitModel(projectPath), degraded: false };
  } catch {
    try {
      return { model: JSON.parse(readFileSync(join(projectPath, ".paaw", "release-unit-model.json"), "utf-8")), degraded: false }; // nosemgrep: detect-non-literal-fs-filename, path-join-resolve-traversal — local-first: 使用者自選專案根目錄（localhost 單人工具）
    } catch { /* 走降級合成 */ }
  }
  try {
    const feats = JSON.parse(readFileSync(join(projectPath, ".paaw", "features", "FEATURES.json"), "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const list = Array.isArray(feats) ? feats : feats.features || [];
    return {
      degraded: true,
      model: { headSha: null, features: list.map((f) => ({ id: f.id, name: f.name || f.title || f.id, status: f.status || null, files: (f.codeFiles || f.files || []).map(_normPath), apis: [], tests: [], changes: [] })) },
    };
  } catch {
    return { degraded: true, model: { headSha: null, features: [], apis: [], tests: [], changes: [] } };
  }
}

// ── e2e 內容覆蓋（測試檔語料含 API path 字串 = deterministic 覆蓋證據 — 同 readiness 演算法）──
function buildApiCoverageMatcher(projectPath) {
  let corpus = null;
  const build = () => {
    let buf = "";
    const TEST_DIR = new Set(["tests", "test", "e2e", "__tests__"]);
    const SKIP = new Set(["node_modules", "dist", "build", "coverage", "versions", "raw", "crops", ".paaw"]);
    const isTestFile = (n) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(n) || /^test[-_]/.test(n);
    const walk = (dir, depth) => {
      if (depth > 5) return;
      let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
        const p2 = join(dir, e.name);
        if (e.isDirectory()) walk(p2, depth + 1);
        else if (isTestFile(e.name) || dir.split(/[\\/]/).some((seg) => TEST_DIR.has(seg))) {
          try { const c = readFileSync(p2, "utf-8"); if (c.length < 500000) buf += "\n" + c; } catch { /* skip */ }
        }
      }
    };
    walk(projectPath, 0);
    return buf;
  };
  return (apiPath) => {
    if (!apiPath) return false;
    if (corpus === null) corpus = build();
    const norm = apiPath.replace(/\/<[^/>]+>/g, "/__P__").replace(/\/:[A-Za-z0-9_]+/g, "/__P__");
    const re = new RegExp(norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/__P__/g, "[^/]+")); // nosemgrep: detect-non-literal-regexp
    return re.test(corpus);
  };
}

// ── file→feature 權威對映（FILE-FEATURES.json — CU 維護；2026-10-30 browser 實測抓到：
// FEATURES.json 的 codeFiles 可能過期（F20261023-022 只有 1 檔但對映表知道 learning-practice），
// delta join 以對映表為主、model files 為輔（union）──
function loadFileFeatureMap(projectPath) {
  try {
    const d = JSON.parse(readFileSync(join(projectPath, ".paaw", "features", "FILE-FEATURES.json"), "utf-8")); // nosemgrep: detect-non-literal-fs-filename — local-first: 使用者自選專案根目錄（localhost 單人工具）
    const files = (d && typeof d === "object" && d.files) ? d.files : (d || {});
    const map = new Map(); // norm path -> [{id,name}]
    for (const [fp, feats] of Object.entries(files)) {
      if (!Array.isArray(feats)) continue;
      map.set(_normPath(fp), feats.map((x) => ({ id: x.id, name: x.name || x.id })));
    }
    return map;
  } catch { return new Map(); }
}

// ── lastTestRun 摘要（unit 欄證據來源：run id）──
async function lastTestRunInfo(projectPath) {
  try {
    const rec = readLastTestRun(projectPath);
    if (!rec) return null;
    return {
      runId: rec.id || null,
      finishedAt: rec.finishedAt || null,
      status: rec.status || null,
      summary: rec.summary || { passed: 0, failed: 0, skipped: 0, total: 0 },
      source: ".paaw/test-runs/last.json",
    };
  } catch { return null; }
}

// ── 證據欄補 source 註記（哪個檔案/哪個 run 證的）──
async function annotateSources(projectPath, matrix) {
  const [scan, board, ltr] = await Promise.all([loadSecurityScan(projectPath), loadReviewBoard(projectPath), lastTestRunInfo(projectPath)]);
  const scanSource = scan ? `.paaw/security/scan-results.json @ ${scan.scannedAt || "?"}` : null;
  for (const f of matrix.features || []) {
    const ev = f.evidence || {};
    if (ev.unit) ev.unit.source = ltr?.runId ? `${ltr.source}（${ltr.runId}）` : (f.tests?.length ? `${f.tests.length} 個測試檔（無 run 記錄）` : null);
    if (ev.e2e) ev.e2e.source = ev.e2e.total ? `測試檔內容比對（${ev.e2e.covered ?? 0}/${ev.e2e.total} API）` : null;
    if (ev.sg) ev.sg.source = scanSource;
    if (ev.aiReview) ev.aiReview.source = ev.aiReview.file || (board ? `.paaw/review-board/（最新 ${board.latest.at || "?"}）` : null);
    if (ev.human) ev.human.source = ev.human.id ? `qa-results #${ev.human.id}` : null;
  }
  return matrix;
}

// ── 主入口：生成凍結快照 ──
export async function generateEvidenceSnapshot(projectPath, { baseline = "auto", by = "human" } = {}) {
  const base = await resolveBaseline(projectPath, baseline); // 不存在 → throw .status 400
  const head = await gitHeadInfo(projectPath);
  if (!head) { const e = new Error("git HEAD 讀不到（不是 git repo？）"); e.status = 400; throw e; }
  if (base.sha === head.sha) { const e = new Error(`baseline == HEAD（${head.short}）— 沒有 delta 可檢查`); e.status = 400; throw e; }

  const changed = await changedFilesSince(projectPath, base.sha);
  const changedSet = new Set(changed);
  const commits = await commitsSince(projectPath, base.sha);
  const { model, degraded } = await loadModel(projectPath);
  const apiCovered = buildApiCoverageMatcher(projectPath);

  const changedApis = (model?.apis || [])
    .filter((a) => a.file && changedSet.has(_normPath(a.file)))
    .map((a) => ({ method: a.method, path: a.path, file: _normPath(a.file), featureIds: a.featureIds || [] }));

  const changedFeatures = [];
  // 2026-10-30：以 FILE-FEATURES 權威對映為主做 delta join（model files 可能過期）
  const fileFeatureMap = loadFileFeatureMap(projectPath);
  const hitByMap = new Map(); // featureId -> { id, name, files }
  for (const cf of changed) {
    const n = _normPath(cf);
    for (const feat of fileFeatureMap.get(n) || []) {
      if (!feat.id) continue;
      if (!hitByMap.has(feat.id)) hitByMap.set(feat.id, { id: feat.id, name: feat.name, files: [] });
      hitByMap.get(feat.id).files.push(n);
    }
  }
  for (const f of model?.features || []) {
    const files = (f.files || []).map(_normPath).filter((x) => changedSet.has(x));
    if (!files.length) continue;
    const via = hitByMap.get(f.id);
    if (via) { for (const x of files) if (!via.files.includes(x)) via.files.push(x); continue; }
    hitByMap.set(f.id, { id: f.id, name: f.name || f.id, files });
  }
  for (const [id, hit] of hitByMap) {
    const f = (model?.features || []).find((x) => x.id === id) || {};
    const files = hit.files;
    const fids = new Set([id]);
    const apis = changedApis.filter((a) => a.featureIds?.some((fid) => fids.has(fid)));
    changedFeatures.push({
      id, name: hit.name || f.name || id, status: f.status || null,
      changedFiles: files,
      changeCount: files.length,
      apis: apis.map((a) => `${a.method} ${a.path}`),
      apiImpact: apis.length > 0,
      tests: (f.tests || []).map((tf) => ({ file: tf.file, kind: tf.kind ?? null })),
      hasTests: (f.tests || []).length > 0 || apis.some((a) => apiCovered(a.path)),
      e2eCoveredApis: apis.filter((a) => apiCovered(a.path)).length,
      recentSubjects: commits.subjects.slice(0, 3),
    });
  }

  // 證據 join（reuse 既有 Evidence Matrix 掃描 — severity/sg/qa/aiReview/human 全套）+ source 註記
  const ltr = await lastTestRunInfo(projectPath);
  let matrix = { features: [], summary: null };
  let matrixError = null;
  try {
    matrix = await buildEvidenceMatrix(projectPath, changedFeatures, {
      lastTestRun: ltr ? { summary: ltr.summary, stale: false } : null,
    });
    matrix = await annotateSources(projectPath, matrix);
  } catch (e) { matrixError = e.message; }

  const allGreen = matrix.features.length > 0 && matrix.features.every((f) => (f.gaps?.missing || []).length === 0);
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}`;
  const id = `EVD-${stamp}-${head.short}`;
  const snapshot = {
    id,
    frozen: true, // 快照不可變 — 補強後重新生成新快照，不就地改
    generatedAt: ts.toISOString(),
    generatedBy: by,
    baseline: base, // { sha, short, subject, at, source }
    head,
    range: `${base.sha}..${head.sha}`,
    commits,
    changedFileCount: changed.length,
    modelDegraded: degraded,
    matrixError,
    features: matrix.features || [],
    summary: matrix.summary || null,
    allGreen,
  };

  const dir = evidenceDir(projectPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

// ── 讀取 ──
export async function listEvidenceSnapshots(projectPath) {
  const dir = evidenceDir(projectPath);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => /^EVD-[A-Za-z0-9._-]+\.json$/.test(f)).sort().reverse();
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({
        id: s.id || f.replace(/\.json$/, ""),
        generatedAt: s.generatedAt,
        baseline: s.baseline ? { short: s.baseline.short, subject: s.baseline.subject, source: s.baseline.source } : null,
        head: s.head ? { short: s.head.short } : null,
        features: (s.features || []).length,
        withGaps: (s.features || []).filter((x) => (x.gaps?.missing || []).length > 0).length,
        allGreen: !!s.allGreen,
      });
    } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => (b.generatedAt || "").localeCompare(a.generatedAt || ""));
  return out;
}

export async function readEvidenceSnapshot(projectPath, id) {
  if (!/^EVD-[A-Za-z0-9._-]+$/.test(id || "")) return null; // sanitize 檔名 id
  const file = join(evidenceDir(projectPath), `${id}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return null; }
}

// ── 結構化缺口（Evidence AI tool / 對話用：哪個 feature 缺什麼證據、baseline 範圍）──
export function snapshotGaps(snapshot) {
  const feats = (snapshot?.features || []).map((f) => ({
    featureId: f.id,
    name: f.name,
    severity: f.severity ?? null,
    changedFiles: f.changedFiles || [],
    missing: (f.gaps?.missing || []).map((col) => {
      const cell = f.evidence?.[col] || {};
      return { column: col, reason: cell.reason || cell.note || null };
    }),
    cells: Object.fromEntries(Object.entries(f.evidence || {}).map(([k, v]) => [k, { ok: !!v.ok, source: v.source ?? null, reason: v.reason ?? null }])),
  }));
  return {
    snapshotId: snapshot?.id || null,
    frozen: !!snapshot?.frozen,
    baseline: snapshot?.baseline || null,
    head: snapshot?.head || null,
    range: snapshot?.range || null,
    allGreen: !!snapshot?.allGreen,
    featuresTotal: feats.length,
    featuresWithGaps: feats.filter((f) => f.missing.length > 0).length,
    gaps: feats.filter((f) => f.missing.length > 0),
  };
}

// ── 紅格 → 開補強單（對接 TASKS.json 慣例 — 同 task-retrofit 格式）──
const GAP_GUIDANCE = {
  unit: { label: "Unit 測試", action: "為變更檔案補 unit test 並全綠（▶ 執行測試後 .paaw/test-runs/ 有 run id）" },
  e2e: { label: "E2E 覆蓋", action: "為變更 API 補 e2e 測試（測試檔內容需含 API path，內容比對才算覆蓋）" },
  sg: { label: "安全掃描", action: "跑 semgrep 掃描並清除該 feature 檔案的 CRITICAL findings" },
  qa: { label: "QA 驗收", action: "跑 QA 並用 qa_record_save 記錄 pass（feature 名需與 map 一致）" },
  aiReview: { label: "AI Review", action: "跑 Multi-Model Review 委員會至 approve（審查範圍需涵蓋該 feature 檔案）" },
  human: { label: "人員簽核", action: "人員驗收並記錄（qa_record_save actor=human verdict=pass）" },
};

function gapTaskOpen(tasks, snapshotId, featureId) {
  return tasks.some((t) => t.source?.type === "evidence-gap" && t.source.snapshotId === snapshotId && t.source.featureId === featureId
    && !["resolved", "closed", "close", "released", "rejected"].includes(t.status));
}

export async function openEvidenceGapTask(projectPath, { snapshotId, featureId }) {
  const snapshot = await readEvidenceSnapshot(projectPath, snapshotId);
  if (!snapshot) { const e = new Error(`快照不存在：${snapshotId}`); e.status = 404; throw e; }
  const feature = (snapshot.features || []).find((f) => f.id === featureId);
  if (!feature) { const e = new Error(`快照內找不到 feature：${featureId}`); e.status = 404; throw e; }
  const missing = feature.gaps?.missing || [];
  if (!missing.length) { const e = new Error(`${featureId} 沒有缺口（全綠格不開單）`); e.status = 400; throw e; }

  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  let data = { tasks: [] };
  try { data = JSON.parse(await readFile(tasksFile, "utf-8")); } catch { /* 首張單 */ }
  if (!Array.isArray(data.tasks)) data.tasks = [];
  if (gapTaskOpen(data.tasks, snapshotId, featureId)) {
    return { ok: true, skipped: true, reason: "此 feature 已有未結案的證據補強單" };
  }

  const now = new Date().toISOString();
  const nextNum = Math.max(0, ...data.tasks.map((x) => parseInt((x.id || "").replace(/^TASK-/, ""), 10) || 0)) + 1;
  const id = `TASK-${String(nextNum).padStart(3, "0")}`;
  const guidance = missing.map((m) => `- ${GAP_GUIDANCE[m]?.label || m}：${GAP_GUIDANCE[m]?.action || "補齊該證據欄"}`);
  data.tasks.push({
    id,
    title: `【證據補強】${feature.id} ${feature.name} — 缺 ${missing.join("/")}`,
    type: "test",
    status: "open",
    priority: feature.severity === "S2" ? "critical" : "high",
    parentId: null,
    description: `Release Evidence 快照 ${snapshot.id}（baseline ${snapshot.baseline?.short || "?"}..HEAD ${snapshot.head?.short || "?"}）紅格補強。
Feature：${feature.id} ${feature.name}（severity ${feature.severity || "?"}）
變更檔案：
${(feature.changedFiles || []).map((cf) => "- " + cf).join("\n") || "(無)"}
缺證據欄：${missing.join(", ")}
驗收：補齊下列證據欄後重新生成 Evidence 快照（快照不可變，不就地刷新）：
${guidance.join("\n")}`,
    labels: ["evidence-gap", ...(missing)],
    assignee: null,
    createdAt: now,
    updatedAt: now,
    createdBy: "agent",
    source: { type: "evidence-gap", snapshotId, featureId, missing },
    spec: {
      description: `補 release evidence 證據：${missing.join("/")}`,
      acceptanceCriteria: missing.map((m) => `${GAP_GUIDANCE[m]?.label || m} 補齊 — ${GAP_GUIDANCE[m]?.action || "證據欄轉綠"}`),
      fileScope: feature.changedFiles || [],
      outOfScope: ["重新實作功能", "大幅重構"],
    },
    changes: { filesAdded: [], filesModified: [], filesDeleted: [] },
    git: { baseCommit: snapshot.baseline?.sha || null, branch: null, staged: false, committedSha: null },
    notes: [{ text: `由 Release Evidence 快照 ${snapshot.id} 紅格開單（缺 ${missing.join("/")}）`, at: now, by: "agent" }],
    discussion: [],
  });
  await mkdir(join(projectPath, ".paaw", "tasks"), { recursive: true });
  await writeFile(tasksFile, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true, skipped: false, taskId: id, featureId, missing };
}

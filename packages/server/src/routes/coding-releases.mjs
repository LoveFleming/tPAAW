/**
 * coding-releases.mjs — Release Manager API Routes
 *
 * 「要 release 時打開 Release Manager page 同意上線」
 *
 * 待放行 = full mode pipeline 前六關（spec→implement→review→test→qa→docs）
 * 全部 done、只剩 commit 等 Release Manager 批准的 task。
 * Mini loop 的快速 commit 不進這裡（沒有證據流，不該擋在 release gate）。
 *
 * Routes:
 *   GET  /api/coding-releases/pending?path=...   — 待放行清單（附證據摘要）
 *   GET  /api/coding-releases/list?path=...      — 已放行歷史（.paaw/releases/）
 *   POST /api/coding-releases/approve            — 批准上線（快照證據 → releases/）
 *   POST /api/coding-releases/reject             — 退回（原因回饋 task）
 *   GET  /api/coding-releases/quality-debt?path=... — 品質債現況（feature map × tests/docs × retrofit）
 *   POST /api/coding-releases/retrofit            — 上線前補強（feature map → 批次建 task）
 */

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { gatherTaskEvidence } from "./coding-evidence.mjs";
import { runTaskRetrofit, qualityDebtSummary } from "../lib/task-retrofit.mjs";
import { buildChangeIntelligence } from "../lib/change-intelligence.mjs";
import { checkGates } from "../lib/release-unit/gates.mjs";
import { shellExec } from "../lib/shell-exec.mjs";
import { startTestRun, getRunState, readLastTestRun, detectTestGroups } from "../lib/test-runner.mjs";
import { readFileSync } from "fs";

const PHASES_BEFORE_COMMIT = ["spec", "implement", "review", "test", "qa", "docs"];

// ── TASKS.json 原檔讀寫（保留 top-level 欄位如 loopMode）──

async function readTasksFile(projectPath) {
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return null;
  try {
    return JSON.parse(await readFile(tasksFile, "utf-8"));
  } catch {
    return null;
  }
}

async function writeTasksFile(projectPath, data) {
  const tasksDir = join(projectPath, ".paaw", "tasks");
  if (!existsSync(tasksDir)) await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, "TASKS.json"), JSON.stringify(data, null, 2), "utf-8");
}

function isPendingRelease(task) {
  const pl = task?.pipeline;
  if (!pl) return false; // mini loop task 沒有 pipeline
  for (const ph of PHASES_BEFORE_COMMIT) {
    if (pl[ph]?.status !== "done") return false;
  }
  const commitSt = pl.commit?.status || "pending";
  if (commitSt === "done" || commitSt === "rework") return false;
  if (task.status === "released" || task.status === "rejected") return false;
  return true; // commit pending / awaiting_human / pending-review → 等放行
}

// ── Releases 目錄 ──

function releasesDir(projectPath) {
  return join(projectPath, ".paaw", "releases");
}

async function listReleases(projectPath) {
  const dir = releasesDir(projectPath);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      const rel = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({
        id: rel.id || f.replace(/\.json$/, ""),
        releasedAt: rel.releasedAt,
        taskId: rel.taskId,
        title: rel.title || rel.evidence?.title || "(untitled)",
        trustScore: rel.evidence?.trustScore?.score ?? null,
        riskLevel: rel.evidence?.risk?.level ?? null,
        note: rel.note || null,
        file: f,
      });
    } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
  return out;
}

// ── Route Handler ──

export default async function releaseRoutes(req, res, next) {
  const method = req.method;
  const rawUrl = req.url || "";
  const url = rawUrl.split("?")[0];
  const q = new URL(rawUrl, "http://localhost").searchParams;
  const projectPath = q.get("path");

  if (!url.startsWith("/api/coding-releases")) return next?.() ?? false;

  // GET pending — 待放行清單
  if (url === "/api/coding-releases/pending" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({ error: "path required" });
    }
    const data = await readTasksFile(projectPath);
    if (!data) {
      return res.json({
        initialized: false,
        loopMode: "mini",
        pending: [],
        message: "no-tasks",
      });
    }
    const pending = [];
    for (const task of data.tasks || []) {
      if (!isPendingRelease(task)) continue;
      // 附證據摘要（trust score / risk / diff）
      let evidenceSummary = null;
      try {
        const ev = await gatherTaskEvidence(projectPath, task.id);
        if (ev) {
          evidenceSummary = {
            trustScore: ev.trustScore?.score ?? null,
            risk: ev.risk || null,
            diffStat: ev.changes?.diffStat || null,
            testResult: ev.verification?.testResult || null,
          };
        }
      } catch { /* evidence 失敗不擋列表 */ }
      pending.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        updatedAt: task.updatedAt,
        pipeline: task.pipeline,
        evidenceSummary,
      });
    }
    pending.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return res.json({ initialized: true, loopMode: data.loopMode || "mini", pending });
  }

  // GET list — release 歷史
  if (url === "/api/coding-releases/list" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({ error: "path required" });
    }
    const releases = await listReleases(projectPath);
    return res.json({ initialized: existsSync(join(projectPath, ".paaw")), releases });
  }

  // POST approve / reject
  if ((url === "/api/coding-releases/approve" || url === "/api/coding-releases/reject") && method === "POST") {
    const body = JSON.parse(await readFileStream(req) || "{}");
    const { path, taskId, note, reason } = body;
    if (!path || !taskId) return res.status(400).json({ error: "path and taskId required" });
    const data = await readTasksFile(path);
    if (!data) return res.status(404).json({ error: "TASKS.json not found" });
    const task = (data.tasks || []).find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: `task ${taskId} not found` });
    if (!task.pipeline) return res.status(400).json({ error: "mini loop task — 沒有證據流，不能走 release gate" });

    const at = new Date().toISOString();
    const approving = url.endsWith("/approve");

    if (approving) {
      // 快照完整證據包
      let evidence = null;
      try { evidence = await gatherTaskEvidence(path, taskId); } catch { /* 盡力而為 */ }
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}`;
      const relId = `REL-${stamp}-${taskId}`;
      const dir = releasesDir(path);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${relId}.json`), JSON.stringify({
        id: relId,
        releasedAt: at,
        taskId,
        title: task.title,
        note: note || null,
        decidedBy: "release-manager",
        evidence, // 完整證據包快照 — 之後爭議可回溯
      }, null, 2), "utf-8");

      task.pipeline.commit = { status: "done", by: "release-manager", at, result: "approved for release" };
      task.status = "released";
      task.releaseId = relId;
      task.updatedAt = at;
      task.notes = task.notes || [];
      task.notes.push({ by: "release-manager", at, content: `🚀 Release 批准${note ? `：${note}` : ""}（${relId}）` });
      await writeTasksFile(path, data);
      return res.json({ ok: true, releaseId: relId });
    } else {
      if (!reason) return res.status(400).json({ error: "reason required" });
      task.pipeline.commit = { status: "rework", by: "release-manager", at, result: reason };
      task.status = "in-progress";
      task.updatedAt = at;
      task.notes = task.notes || [];
      task.notes.push({ by: "release-manager", at, content: `❌ Release 退回：${reason}` });
      await writeTasksFile(path, data);
      return res.json({ ok: true });
    }
  }

  // POST test-run — 真實執行測試（背景 job，結果寫 .paaw/test-runs/last.json）
  if (url === "/api/coding-releases/test-run" && method === "POST") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" });
    let body = {};
    let _buf = ""; await new Promise((resolve) => { req.on("data", (c) => { _buf += c; }); req.on("end", resolve); req.on("error", resolve); });
    try { body = JSON.parse(_buf || "{}"); } catch { /* empty body ok */ }
    const r = await startTestRun(projectPath, { includeE2e: !!body.includeE2e });
    return res.json(r);
  }
  // GET test-run — 執行狀態 / 最後結果
  if (url === "/api/coding-releases/test-run" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" });
    const runningState = getRunState(projectPath);
    if (runningState) return res.json({ running: true, ...runningState });
    return res.json({ running: false, last: readLastTestRun(projectPath), detected: detectTestGroups(projectPath, { includeE2e: true }).map(g => ({ kind: g.kind, runner: g.runner })) });
  }

  // GET readiness — 上線就緒報告（基準線 = 上次 release 時間；無 release = 首次發布，基準 = first commit）
  // 程式保證事實（diff/feature/api/gates），AI 只負責推理與報告 — No answer without evidence
  if (url === "/api/coding-releases/readiness" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) {
      return res.status(400).json({ error: "path required" });
    }
    try {
      // ── 基準線 ──
      const releases = await listReleases(projectPath);
      const lastRelease = releases[0] || null;
      let since = lastRelease?.releasedAt || null;
      let firstRelease = !lastRelease;
      if (!since) {
        // 首次發布：基準 = repo 第一個 commit
        try {
          const { stdout } = await shellExec("git log --reverse --pretty=%aI | head -1", { cwd: projectPath, timeout: 10000 });
          since = stdout.trim() || new Date(Date.now() - 30 * 86400e3).toISOString();
        } catch { since = new Date(Date.now() - 30 * 86400e3).toISOString(); }
      }

      // ── 機械變更（deterministic）──
      const { data: ci } = await buildChangeIntelligence(projectPath, { since, maxCommits: 300 });
      const commits = ci?.commits || [];
      const recentFiles = ci?.recentFiles || [];
      const changedSet = new Set(recentFiles.map(f => f.file));

      // ── Feature Map（release-unit-model）──
      let model = null;
      try {
        model = JSON.parse(readFileSync(join(projectPath, ".paaw", "release-unit-model.json"), "utf-8"));
      } catch { /* no model */ }

      const changedApis = (model?.apis || []).filter(a => a.file && changedSet.has(a.file))
        .map(a => ({ method: a.method, path: a.path, file: a.file, featureIds: a.featureIds || [] }));

      const changedFeatures = [];
      for (const f of model?.features || []) {
        const files = (f.files || []).filter(x => changedSet.has(x));
        if (!files.length) continue;
        const fids = new Set([f.id]);
        const apis = changedApis.filter(a => a.featureIds?.some(id => fids.has(id)));
        // 該 feature 的近期 commit 主旨（拿最後 3 條當 Change 描述）
        const subjects = [];
        for (const c of commits.slice().reverse()) {
          if (subjects.length >= 3) break;
          if (c.files.some(x => files.includes(x)) && !subjects.includes(c.subject)) subjects.push(c.subject);
        }
        changedFeatures.push({
          id: f.id, name: f.name, status: f.status,
          changedFiles: files,
          changeCount: files.reduce((s, x) => s + (recentFiles.find(rf => rf.file === x)?.changeCount || 1), 0),
          apis: apis.map(a => `${a.method} ${a.path}`),
          apiImpact: apis.length > 0,
          tests: (f.tests || []).map(tf => ({ file: tf.file, kind: tf.kind })),
          hasTests: (f.tests || []).length > 0,
          knowledgeGaps: f.knowledgeGaps || [],
          recentSubjects: subjects.reverse(),
        });
      }

      // ── Gates ──
      let gates = null;
      try { gates = await checkGates(projectPath); } catch { /* gates 失敗不擋報告 */ }
      const blockedGates = (gates?.gates || []).filter(g => g.status === "blocked" || g.status === "fail");

      // ── Open items（TASKS.json 有 rework/failed 的 task）──
      const tasksData = await readTasksFile(projectPath);
      let openItems = 0;
      for (const task of tasksData?.tasks || []) {
        const pl = task.pipeline || {};
        const bad = Object.values(pl).some((ph) => ph && typeof ph === "object" && (ph.status === "rework" || ph.status === "failed"));
        if (bad || task.status === "rework" || task.status === "failed") openItems++;
      }

      // ── Risk（deterministic heuristic）──
      let riskScore = 0;
      const riskReasons = [];
      if (changedFeatures.some(f => !f.hasTests && f.apiImpact)) { riskScore += 2; riskReasons.push("changed feature with API impact has no tests"); }
      else if (changedFeatures.some(f => !f.hasTests)) { riskScore += 1; riskReasons.push("changed feature without tests"); }
      if (recentFiles.length > 20) { riskScore += 1; riskReasons.push(`${recentFiles.length} changed files`); }
      if (changedApis.length > 10) { riskScore += 1; riskReasons.push(`${changedApis.length} changed APIs`); }
      if (blockedGates.length > 0) { riskScore += 1; riskReasons.push(`${blockedGates.length} blocked gates`); }
      if (openItems > 0) { riskScore += 1; riskReasons.push(`${openItems} open rework/failed items`); }
      const ltr = await lastTestRunSummary(projectPath);
      if (ltr) {
        if (ltr.summary.failed > 0) { riskScore += 1; riskReasons.push(`${ltr.summary.failed} failing tests (last run)`); }
        if (ltr.stale) { riskReasons.push(`test run stale (${ltr.staleCommits} commits since)`); }
      }
      const risk = riskScore >= 3 ? "HIGH" : riskScore >= 1 ? "MEDIUM" : "LOW";
      const ready = blockedGates.length === 0 && risk !== "HIGH";

      const authors = [...new Set(commits.map(c => c.author))];
      return res.json({
        releaseId: new Date().toISOString().slice(0, 10).replace(/-/g, "."),
        generatedAt: new Date().toISOString(),
        since,
        sinceRelease: lastRelease ? { id: lastRelease.id, releasedAt: lastRelease.releasedAt, title: lastRelease.title } : null,
        firstRelease,
        headSha: model?.headSha || null,
        commits: { count: commits.length, authors, subjects: commits.slice(0, 30).map(c => `${c.short} ${c.subject}`) },
        changedFiles: recentFiles,
        changedFeatures,
        changedApis,
        tests: {
          totalTestFiles: model?.summary?.testFiles ?? null,
          changedFeaturesWithTests: changedFeatures.filter(f => f.hasTests).length,
          changedFeaturesTotal: changedFeatures.length,
        },
        lastTestRun: await lastTestRunSummary(projectPath),
        gates,
        openItems,
        risk, riskReasons,
        ready,
      });
    } catch (e) {
      return res.status(500).json({ error: "readiness failed", detail: e.message });
    }
  }

  // GET quality-debt — 品質債現況（bootstrap 衝功能後，上線前看這頁）
  if (url === "/api/coding-releases/quality-debt" && method === "GET") {
    if (!projectPath || !existsSync(projectPath)) return res.status(400).json({ error: "path required" });
    try {
      const summary = await qualityDebtSummary(projectPath);
      if (!summary.ok) {
        // no-features-file 是可回復狀態（前端引導先跑 feature 掃描），回 200 帶 code
        return res.json({ ok: false, code: summary.error, error: summary.error });
      }
      return res.json({ ok: true, ...summary });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST retrofit — 上線前補強：從 feature map 批次建品質 task
  if (url === "/api/coding-releases/retrofit" && method === "POST") {
    let body = {};
    try { body = JSON.parse(await readFileStream(req) || "{}"); } catch { /* empty body ok */ }
    const path = body.path || projectPath;
    if (!path || !existsSync(path)) return res.status(400).json({ error: "path required" });
    try {
      const result = await runTaskRetrofit(path, { priority: body.priority, featureIds: body.featureIds });
      if (!result.ok) return res.json({ ok: false, error: result.error });
      return res.json({ ok: true, scanned: result.scanned, createdCount: result.created.length, created: result.created, skipped: result.skipped, message: result.message });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return next?.() ?? false;
}

// ── helpers ──
function readFileStream(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => { buf += c; });
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(""));
  });
}
// ── lastTestRun 摘要（readiness 用）：真實執行數字 + stale 偵測 ──
async function lastTestRunSummary(projectPath) {
  try {
    const rec = readLastTestRun(projectPath);
    if (!rec) return null;
    let stale = false, staleCommits = 0;
    if (rec.headSha) {
      try {
        const { stdout } = await shellExec(`git rev-list ${rec.headSha}..HEAD --count`, { cwd: projectPath, timeout: 5000 });
        staleCommits = parseInt(stdout.trim(), 10) || 0;
        stale = staleCommits > 0;
      } catch { /* git 不可用時不算 stale */ }
    }
    return {
      finishedAt: rec.finishedAt,
      status: rec.status,
      includeE2e: rec.includeE2e || false,
      durationMs: rec.durationMs,
      summary: rec.summary || { passed: 0, failed: 0, skipped: 0, total: 0 },
      byKind: rec.byKind || {},
      stale, staleCommits,
    };
  } catch { return null; }
}

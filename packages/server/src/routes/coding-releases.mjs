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

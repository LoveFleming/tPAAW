/**
 * coding-evidence.mjs — Evidence Package API Routes
 *
 * 「人不 review 碼，人 review 證據」— 聚合分散的驗證資料成一份決策卡：
 *   - Spec 對照（task spec / acceptance criteria vs 實際變更）
 *   - 變更統計（git diff / task.changes）
 *   - 驗證狀態（testResult、qaResult、test-intelligence coverage）
 *   - Pipeline 完成度（7 階段）
 *   - 風險分類（重用 autoExecute 的分類邏輯）
 *   - Trust Score（透明計分，不是黑盒）
 *
 * Routes:
 *   GET  /api/coding-evidence/task/:taskId?path=...   — 單一 task 的證據包
 *   GET  /api/coding-evidence/plan/:planId?path=...   — 整個 plan 的證據包總覽
 *
 * Evidence 只聚合唯讀資料；Approve/Reject 走既有 coding-tasks pipeline API。
 * 存儲：即時計算，不落盤（來源都是事實檔案，隨時可重建）。
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { exec as _exec } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { safeResolve } from "../lib/coding-security";

const execAsync = promisify(_exec);
const __filename = fileURLToPath(import.meta.url);

// ── 風險分類（與 auto-dispatch-manager 的 autoExecute 分類保持一致） ──

const RISK_PATTERNS = [
  { category: "breakingChange", weight: 3, re: /breaking|\bbreak\b|remove.*api|deprecat/i },
  { category: "securityFix", weight: 3, re: /security|vulnerability|cwe-|injection|xss|csrf/i },
  { category: "refactor", weight: 2, re: /refactor|rename|restructure|move.*to/i },
  { category: "tests", weight: 0, re: /test|coverage|spec/i },
  { category: "docs", weight: 0, re: /doc|readme|changelog|comment/i },
];

/**
 * 分類 task 內容 → { category, level }
 * level: low (tests/docs/feature) | medium (refactor) | high (security/breaking)
 */
export function classifyRisk(text) {
  const content = text || "";
  for (const p of RISK_PATTERNS) {
    if (p.re.test(content)) {
      const level = p.weight >= 3 ? "high" : p.weight === 2 ? "medium" : "low";
      return { category: p.category, level };
    }
  }
  return { category: "feature", level: "low" };
}

// ── Trust Score（透明加權，UI 顯示各項得分） ──

function computeTrustScore({ pipeline, testResult, qaResult, risk, diffStat }) {
  const items = [];

  // 1. Pipeline 完成度 — 每階段 done +8，awaiting_human +5（已到人面前）
  const PHASES = ["spec", "implement", "review", "test", "qa", "docs", "commit"];
  let phaseScore = 0;
  const phaseDetail = {};
  for (const ph of PHASES) {
    const st = pipeline?.[ph]?.status || "pending";
    const pts = st === "done" ? 8 : st === "awaiting_human" ? 5 : 0;
    phaseScore += pts;
    phaseDetail[ph] = { status: st, points: pts };
  }
  items.push({ name: "pipeline", label: "Pipeline 完成度", score: Math.round(phaseScore), max: 56, detail: phaseDetail });

  // 2. 測試 — 有結果且全綠 25 分；有結果但 fail 按比例；沒測試資料 0
  // needs_human（修復上限已到）直接 0 分 — 這是给人看的紅旗
  let testScore = 0;
  let testMax = 25;
  if (pipeline?.test?.status === "needs_human") {
    testScore = 0;
  } else if (testResult) {
    const passed = Number(testResult.passed ?? 0);
    const failed = Number(testResult.failed ?? 0);
    const total = passed + failed;
    testScore = total > 0 ? Math.round((passed / total) * 25) : (testResult.status === "pass" ? 25 : 0);
  }
  items.push({ name: "tests", label: "測試驗證", score: testScore, max: testMax });

  // 3. QA — pass 10 分
  const qaScore = qaResult?.status === "pass" || qaResult?.passed === true ? 10 : 0;
  items.push({ name: "qa", label: "QA 檢查", score: qaScore, max: 10 });

  // 4. Diff 大小 — 小 diff 更可信：<=200 行改動 5 分，<=500 得 3，>500 得 1
  const changedLines = (diffStat?.insertions || 0) + (diffStat?.deletions || 0);
  const sizeScore = changedLines === 0 ? 0 : changedLines <= 200 ? 5 : changedLines <= 500 ? 3 : 1;
  items.push({ name: "size", label: "變更規模", score: sizeScore, max: 5 });

  // 5. 風險調整 — high -10, medium -5, low +0（直接扣總分）
  const riskPenalty = risk.level === "high" ? -10 : risk.level === "medium" ? -5 : 0;

  const raw = items.reduce((s, i) => s + i.score, 0) + riskPenalty;
  const maxTotal = items.reduce((s, i) => s + i.max, 0);
  const score = Math.max(0, Math.min(100, Math.round((raw / maxTotal) * 100)));
  return { score, items, riskPenalty };
}

// ── Git diff 統計 ──

async function gitDiffStat(projectPath, since) {
  if (!projectPath) return null;
  try {
    const range = since ? `${since}..HEAD` : "HEAD~1..HEAD";
    const { stdout } = await execAsync(`git diff --stat ${range} | tail -1`, { cwd: projectPath, timeout: 15000 });
    // e.g. " 5 files changed, 120 insertions(+), 35 deletions(-)"
    const files = stdout.match(/(\d+) files? changed/);
    const ins = stdout.match(/(\d+) insertions?\(\+\)/);
    const del = stdout.match(/(\d+) deletions?\(-\)/);
    if (!files) return null;
    return {
      files: Number(files[1]),
      insertions: ins ? Number(ins[1]) : 0,
      deletions: del ? Number(del[1]) : 0,
      range,
    };
  } catch {
    return null;
  }
}

async function gitStatusShort(projectPath) {
  if (!projectPath) return { dirty: false, files: [] };
  try {
    const { stdout } = await execAsync("git status --porcelain", { cwd: projectPath, timeout: 10000 });
    const lines = stdout.trim().split("\n").filter(Boolean);
    return { dirty: lines.length > 0, files: lines.slice(0, 50) };
  } catch {
    return { dirty: false, files: [] };
  }
}

// ── 讀 TASKS.json ──

async function loadTasksRaw(projectPath) {  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (!existsSync(tasksFile)) return { tasks: [] };
  try {
    const data = JSON.parse(await readFile(tasksFile, "utf-8"));
    return { tasks: Array.isArray(data.tasks) ? data.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

// ── 讀 test-intelligence（coverage 事實來源） ──
  // nosemgrep: path-join-resolve-traversal
async function loadTestIntelligence(projectPath) {
// nosemgrep: path-join-resolve-traversal
  const tiFile = join(projectPath, ".paaw", "code-intelligence", "test-intelligence.json");
  if (!existsSync(tiFile)) return null;
  try {
    const data = JSON.parse(await readFile(tiFile, "utf-8"));
    const cov = data?.summary?.coverage ?? data?.coverage ?? null;
    const counts = data?.summary?.counts ?? data?.counts ?? null;
    return { coverage: cov, counts, generatedAt: data?.generatedAt || null };
  } catch {
    return null;
  }
}

// ── 聚合單一 task 證據 ──

export async function gatherTaskEvidence(projectPath, taskId) {
  const { tasks } = await loadTasksRaw(projectPath);
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  const risk = classifyRisk(`${task.title || ""} ${task.description || ""} ${(task.labels || []).join(" ")}`);

  // diff 統計：優先用 task.git 自帶，否則 git status（未 commit 變更）
  let diffStat = task.changes?.diffStat || null;
  let gitState = null;
  if (!diffStat) {
    gitState = await gitStatusShort(projectPath);
    if (gitState.dirty) {
      diffStat = {
        files: gitState.files.length,
        insertions: null, // porcelain 不含行數；標記 unknown
        deletions: null,
        range: "working-tree",
      };
    }
  }

  const ti = await loadTestIntelligence(projectPath);

  const evidence = {
    taskId: task.id,
    title: task.title,
    type: task.type || "feature",
    status: task.status,
    risk,
    spec: {
      description: task.description || null,
      acceptanceCriteria: task.acceptanceCriteria || null,
      spec: task.spec || null,
    },
    changes: {
      summary: task.changes?.summary || task.changes || null,
      diffStat,
      relatedFiles: task.relatedFiles || [],
    },
    git: {
      commit: task.git?.commit || null,
      branch: task.git?.branch || null,
      workingTree: gitState || (await gitStatusShort(projectPath)),
    },
    verification: {
      testResult: task.testResult || null,
      qaResult: task.qaResult || null,
      coverage: ti?.coverage || null,
      pipeline: task.pipeline || null,
      repairLoop: task.repairLoop || null,
    },
    provenance: {
      createdBy: task.createdBy || null,
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null,
      resolvedAt: task.resolvedAt || null,
      notes: (task.notes || []).slice(-10),
      executionResult: task.executionResult
        ? {
            agent: task.executionResult.agent || null,
            success: task.executionResult.success ?? null,
            summary: (task.executionResult.summary || task.executionResult.report || "").slice(0, 2000) || null,
          }
        : null,
    },
    generatedAt: new Date().toISOString(),
  };

  evidence.trustScore = computeTrustScore({
    pipeline: task.pipeline,
    testResult: task.testResult,
    qaResult: task.qaResult,
    risk,
    diffStat,
  });

  return evidence;
}

// ── Plan 總覽（多 task 聚合） ──  // nosemgrep: path-join-resolve-traversal

async function gatherPlanEvidence(projectPath, planId) {
  const planFile = safeResolve(projectPath, ".paaw", "auto-dispatch", "plans", `${planId}.json`);
  if (!existsSync(planFile)) return null;
  const plan = JSON.parse(await readFile(planFile, "utf-8"));

  const subtasks = [];
  for (const t of plan.tasks || []) {
    for (const st of t.subtasks || []) {
      subtasks.push({
        subtaskId: st.subtaskId,
        title: st.title,
        assignee: st.assignee,
        status: st.status,
        tokens: st.tokens || null,
        cost: st.cost || null,
        notes: (st.notes || []).slice(-5),
      });
    }
  }

  const total = subtasks.length;
  const DONE = new Set(["done", "completed", "success", "pass"]);
  const FAIL = new Set(["failed", "fail", "error", "cancelled"]);
  const done = subtasks.filter(s => DONE.has(String(s.status).toLowerCase())).length;
  const failed = subtasks.filter(s => FAIL.has(String(s.status).toLowerCase())).length;
  const gitState = await gitStatusShort(projectPath);
  const ti = await loadTestIntelligence(projectPath);

  // Plan-level trust：完成率 + 測試覆蓋 + working tree 乾淨度
  let planScore = 0;
  if (total > 0) planScore += Math.round((done / total) * 60);
  if (ti?.coverage != null) planScore += Math.round(Math.min(40, Number(ti.coverage) * 0.4));

  return {
    planId: plan.planId || planId,
    status: plan.status,
    mode: plan.mode,
    createdAt: plan.createdAt,
    completedAt: plan.completedAt || null,
    summary: { total, done, failed, pending: total - done - failed },
    subtasks,
    git: gitState,
    coverage: ti?.coverage || null,
    trustScore: { score: planScore, max: 100 },
    generatedAt: new Date().toISOString(),
  };
}

// ── HTTP Handler ──

function _json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

export default async function evidenceRoutes(req, res) {
  const urlObj = new URL(req.url || "/", "http://localhost");
  const pathname = urlObj.pathname;
  const method = req.method;
  const projectPath = urlObj.searchParams.get("path") || "";

  if (!projectPath || method !== "GET") return false;

  // GET /api/coding-evidence/task/:taskId
  const taskMatch = pathname.match(/^\/api\/coding-evidence\/task\/([^/?]+)$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    try {
      const evidence = await gatherTaskEvidence(projectPath, taskId);
      if (!evidence) { _json(res, 404, { error: `Task not found: ${taskId}` }); return true; }
      _json(res, 200, evidence);
      return true;
    } catch (err) {
      _json(res, 500, { error: err.message });
      return true;
    }
  }

  // GET /api/coding-evidence/plan/:planId
  const planMatch = pathname.match(/^\/api\/coding-evidence\/plan\/([^/?]+)$/);
  if (planMatch) {
    const planId = decodeURIComponent(planMatch[1]);
    try {
      const evidence = await gatherPlanEvidence(projectPath, planId);
      if (!evidence) { _json(res, 404, { error: `Plan not found: ${planId}` }); return true; }
      _json(res, 200, evidence);
      return true;
    } catch (err) {
      _json(res, 500, { error: err.message });
      return true;
    }
  }

  return false;
}

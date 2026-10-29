/**
 * em-task-store.mjs — EM 工頭「單 = 檔案 = 狀態機」儲存層（2026-10-01 柱一）
 *
 * Fleming 2026-09-30 願景：所有自動工作有單可循；EM 長時間自主不爆 context。
 * 鐵律（調研結論）：context 是消耗品，狀態是檔案。
 *   長時間自主 = 多個短 session 共享一份檔案狀態，不是一個巨 session。
 *
 * 本模組提供：
 *   - 任務檔讀寫（TASKS.json）+ 開單 createTicket（open_ticket action / 工作入口共用）
 *   - progress log：每輪派工結果 append 結構化摘要（context 外部化的載體）
 *   - buildTaskDigest：EM 每輪決策只讀 digest，不讀整段對話
 *   - hydrateFromProgress：任何時刻掛掉 → 下輪從檔案恢復（resumable）
 *   - QA 鐵律 / bug 保險絲 / 治本規則的純函數判定（deterministic，可單測）
 *
 * 消費者：em-orchestrator.mjs（柱一+柱二）、em-job-entrypoints.mjs（柱三）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, relative } from "path";

const MAX_PROGRESS_ENTRIES = 80; // 任務檔 progress log 上限（超過保留最新 + 前 10）

// ── 任務檔讀寫 ──

export function tasksFilePath(rootDir) {
  return join(rootDir, ".paaw", "tasks", "TASKS.json");
}

export function loadTasksFile(rootDir) {
  const file = tasksFilePath(rootDir);
  if (!existsSync(file)) return { data: { tasks: [] }, tasks: [], config: {} };
  const data = JSON.parse(readFileSync(file, "utf-8"));
  const tasks = Array.isArray(data) ? data : data.tasks || [];
  return { data, tasks, config: Array.isArray(data) ? {} : (data.config || data.loopMode ? { loopMode: data.loopMode } : {}) };
}

export function saveTasksFile(rootDir, data, tasks) {
  const file = tasksFilePath(rootDir);
  mkdirSync(dirname(file), { recursive: true });
  const now = new Date().toISOString();
  const payload = Array.isArray(data) ? tasks : { ...data, tasks, updatedAt: now };
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
  return true;
}

export function genTaskId(tasks) {
  const nums = tasks
    .map(t => parseInt(String(t.id || "").replace(/^TASK-/, ""), 10))
    .filter(n => !isNaN(n));
  const next = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
  return `TASK-${String(next).padStart(3, "0")}`;
}

// ── Feature 解析（開單需要 featureId — 一切以 feature 為主）──

export function listFeatures(rootDir) {
  try {
    const f = JSON.parse(readFileSync(join(rootDir, ".paaw", "features", "FEATURES.json"), "utf-8"));
    const feats = f.features || (Array.isArray(f) ? f : []);
    return Array.isArray(feats) ? feats : [];
  } catch { return []; }
}

/** 檔案 → featureId（FILE-FEATURES.json 查表；多 feature 命中取第一個） */
export function resolveFeatureForFiles(rootDir, files = []) {
  if (!Array.isArray(files) || files.length === 0) return null;
  try {
    const ff = JSON.parse(readFileSync(join(rootDir, ".paaw", "features", "FILE-FEATURES.json"), "utf-8"));
    const map = ff.files || {};
    const counts = new Map();
    for (const raw of files) {
      const rel = String(raw).startsWith("/") ? relative(rootDir, raw) : String(raw);
      const hits = map[rel] || map[String(raw)];
      if (Array.isArray(hits)) {
        for (const h of hits) {
          if (h?.id) counts.set(h.id, (counts.get(h.id) || 0) + 1);
        }
      }
    }
    if (counts.size === 0) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } catch { return null; }
}

/**
 * 開單（EM open_ticket action 與工作入口 triage 共用）
 * featureId 解析順序：明給（驗證存在）→ 檔案反查 → parent task → 第一個 feature
 * @returns {{ok, task, error?}}
 */
export function createTicket(rootDir, ticket = {}) {
  const { data, tasks } = loadTasksFile(rootDir);
  const title = String(ticket.title || "").trim();
  if (!title) return { ok: false, error: "title 必填" };
  const description = String(ticket.description || "").trim();
  if (!description) return { ok: false, error: "description 必填" };
  const acceptance = String(ticket.acceptance || "").trim() || "（開單未附驗收標準 — EM 補）";

  const features = listFeatures(rootDir);
  const featureIds = new Set(features.map(f => f.id));
  let featureId = ticket.featureId && featureIds.has(ticket.featureId)
    ? ticket.featureId
    : resolveFeatureForFiles(rootDir, ticket.affectedFiles || []);
  if (!featureId && ticket.parentId) {
    const parent = tasks.find(t => String(t.id).toLowerCase() === String(ticket.parentId).toLowerCase());
    if (parent?.featureId && featureIds.has(parent.featureId)) featureId = parent.featureId;
  }
  if (!featureId && features.length > 0) featureId = features[0].id;

  const type = ["dev", "test", "docs"].includes(ticket.type) ? ticket.type : "dev";
  const now = new Date().toISOString();
  const newTask = {
    id: genTaskId(tasks),
    featureId: featureId || null,
    type,
    title: title.slice(0, 200),
    parentId: ticket.parentId || null,
    status: "open",
    priority: ["critical", "high", "medium", "low"].includes(ticket.priority) ? ticket.priority : "medium",
    labels: Array.isArray(ticket.labels) ? ticket.labels : [],
    assignee: ticket.assignee || null,
    description: `## 目標\n${description}\n\n## 驗收標準\n${acceptance}`,
    relatedFiles: Array.isArray(ticket.affectedFiles) ? ticket.affectedFiles.slice(0, 20) : [],
    notes: [{ by: ticket.createdBy || "em", at: now, content: ticket.note || "EM 工頭開單" }],
    progressLog: [],
    result: null,
    git: null,
    timeoutSeconds: 0,
    spec: type === "test" ? { tests: true } : null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    createdBy: ticket.createdBy || "em",
    source: ticket.source || "em-foreman",
  };
  tasks.push(newTask);
  saveTasksFile(rootDir, data, tasks);
  return { ok: true, task: newTask };
}

// ── Progress Log（柱一核心：每輪派工結果 append，context 外部化）──

/**
 * @param {object} entry {round, agent, action, outcome, brief, durationMs, tokens, devRange?}
 */
export function appendProgress(rootDir, taskId, entry) {
  const { data, tasks } = loadTasksFile(rootDir);
  const task = tasks.find(t => String(t.id).toLowerCase() === String(taskId).toLowerCase());
  if (!task) return false;
  task.progressLog = Array.isArray(task.progressLog) ? task.progressLog : [];
  task.progressLog.push({ at: new Date().toISOString(), ...entry });
  if (task.progressLog.length > MAX_PROGRESS_ENTRIES) {
    task.progressLog = [...task.progressLog.slice(0, 10), ...task.progressLog.slice(10 - MAX_PROGRESS_ENTRIES)];
  }
  task.updatedAt = new Date().toISOString();
  saveTasksFile(rootDir, data, tasks);
  return true;
}

export function getProgress(rootDir, taskId) {
  const { tasks } = loadTasksFile(rootDir);
  const task = tasks.find(t => String(t.id).toLowerCase() === String(taskId).toLowerCase());
  return task?.progressLog || [];
}

/**
 * EM 決策 digest：任務事實 + progress log 壓縮行（最新在後）。
 * 每輪決策只讀這個 — 不讀 agent 完整對話（trimMessagesToFit 截斷風險 + context 消耗）。
 */
export function buildTaskDigest(task, opts = {}) {
  const log = Array.isArray(task.progressLog) ? task.progressLog : [];
  const maxLines = opts.maxLines || 40;
  const lines = log.slice(-maxLines).map(e => {
    const flag = e.devRange ? ` [diff ${e.devRange.short}]` : "";
    return `${e.at?.slice(11, 19)} R${e.round ?? "?"} ${e.action} ${e.agent || ""}${flag} → ${String(e.outcome || "").slice(0, 160)}`;
  });
  const bugCount = log.filter(e => e.action === "open_ticket" && e.ticketType === "bug").length;
  const patterns = {};
  for (const e of log) {
    if (e.action === "open_ticket" && e.patternTag) patterns[e.patternTag] = (patterns[e.patternTag] || 0) + 1;
  }
  return {
    id: task.id,
    title: task.title,
    type: task.type,
    status: task.status,
    featureId: task.featureId || null,
    acceptance: (task.description || "").includes("## 驗收標準")
      ? String(task.description).split("## 驗收標準")[1]?.trim().slice(0, 400)
      : null,
    roundsLogged: log.length,
    bugTicketsOpened: bugCount,
    bugPatterns: patterns,
    lastDevRange: [...log].reverse().find(e => e.devRange)?.devRange || null,
    progress: lines,
  };
}

/**
 * Resumable：從 progress log 重建 orchestration 狀態（上一輪掛掉 → 這輪從檔案恢復）。
 * 雙門檻：devNeedsQA（qa 看碼回歸）+ devNeedsTests（tester 補 UT/E2E 鞏固）。
 * @returns {{runs, agents, history, bugCount, patternTags, devNeedsQA, devNeedsTests, lastDevRange}}
 */
export function hydrateFromProgress(task) {
  const log = Array.isArray(task.progressLog) ? task.progressLog : [];
  const runs = {};
  const agents = {};
  const history = [];
  const patternTags = new Map(); // tag → count
  let bugCount = 0;
  let devNeedsQA = false;
  let devNeedsTests = false;
  let lastDevRange = null;

  for (const e of log) {
    if (e.agent && e.action === "dispatch") {
      runs[e.agent] = (runs[e.agent] || 0) + 1;
      agents[e.agent] = e.outcome?.startsWith("✅") ? "done" : (runs[e.agent] >= 2 ? "blocked" : "failed");
      history.push({ round: e.round, agent: e.agent, outcome: String(e.outcome || "").slice(0, 300) });
      if (e.agent === "developer" && e.outcome?.startsWith("✅")) {
        devNeedsQA = true;
        devNeedsTests = true;
        if (e.devRange) lastDevRange = e.devRange;
      }
      if (e.agent === "qa" && e.outcome?.startsWith("✅")) devNeedsQA = false;      // qa 過 → 看碼門檻解除
      if (e.agent === "tester" && e.outcome?.startsWith("✅")) devNeedsTests = false; // tester 過 → 測試鞏固門檻解除
    }
    if (e.action === "open_ticket") {
      if (e.ticketType === "bug") {
        bugCount++;
        if (e.patternTag) patternTags.set(e.patternTag, (patternTags.get(e.patternTag) || 0) + 1);
      }
    }
  }
  return { runs, agents, history, bugCount, patternTags, devNeedsQA, devNeedsTests, lastDevRange };
}

// ── 柱二純函數：驗收雙門檻 / bug 保險絲 / 治本規則（deterministic — 可單測）──

/** 任務是否需要 tester 鞏固（UT/E2E）：dev 型任務或 spec 明定 tests。docs/test 型不重複要求。 */
export function taskNeedsTests(task = {}) {
  if (task.type === "docs") return false;
  if (task.type === "test") return false; // 任務本身就是測試工作，不重複開門檻
  return task.type === "dev" || (task.spec || {}).tests === true;
}

/**
 * 驗收雙門檻：developer 成功後，(1) qa 看碼回歸 (2) dev 型任務 tester 補 UT/E2E 鞏固 —
 * 兩關都過才能 complete（Fleming 2026-10-01：不是只有開發 and qa，tester 用 UT/E2E 把寫好的程式鞏固起來）。
 * @param {{devNeedsQA?: boolean, devNeedsTests?: boolean}} state
 * @param {object} task 任務（判斷要不要 tester 門檻）
 * @returns {{blocked: boolean, needQA: boolean, needTests: boolean, forcedAgent: "qa"|"tester"|null, reason: string}}
 */
export function completionGate(state, task = {}) {
  const needQA = state?.devNeedsQA === true;
  const needTests = taskNeedsTests(task) && state?.devNeedsTests === true;
  if (!needQA && !needTests) return { blocked: false, needQA: false, needTests: false, forcedAgent: null, reason: "" };
  if (needQA) {
    return { blocked: true, needQA: true, needTests, forcedAgent: "qa", reason: "🔒 鐵律：developer 完成後必經 qa 看碼回歸（程式強制）" };
  }
  return { blocked: true, needQA: false, needTests: true, forcedAgent: "tester", reason: "🔒 鐵律：dev 型任務必經 tester 用 UT+E2E 鞏固（程式強制）" };
}

/**
 * QA 鐵律（舊介面保留）：developer 成功後未過驗收門檻，EM 不得 complete。
 * @returns {boolean}
 */
export function shouldForceQA(state, task = {}) {
  return completionGate(state, task).blocked;
}

/**
 * Bug 保險絲：同 task 打回（bug 單）達上限 → EM 停手升級人類。
 * 語意：QA 打回第 maxBugTickets 次（= 即將開第 maxBugTickets 張 bug 單）就燒——
 * 兩次修了還有新問題 = 問題在更深層，不再浪費派工。
 * @returns {{fuse: boolean, reason?: string}}
 */
export function bugFuseVerdict(state, { maxBugTickets = 3 } = {}) {
  const pending = (state?.bugCount || 0) + 1; // 即將開的第 N 張 bug 單 = 第 N 次打回
  if (pending >= maxBugTickets && pending > 1) {
    return {
      fuse: true,
      reason: `同 task 已開 ${state.bugCount} 張 bug 單，這是第 ${pending} 次打回（上限 ${maxBugTickets}）— 通常問題在更深層，修不好不是派工能解決的。升級人類帶完整證據鏈。`,
    };
  }
  return { fuse: false };
}

/**
 * 治本規則：同類 bug（patternTag）第二次出現 → 自動開 parent 單（refactor / 回歸測試）。
 * @returns {{needsParent: boolean, pattern?: string}}
 */
export function rootCauseVerdict(state) {
  for (const [tag, count] of state?.patternTags || new Map()) {
    if (count >= 2) return { needsParent: true, pattern: tag };
  }
  return { needsParent: false };
}

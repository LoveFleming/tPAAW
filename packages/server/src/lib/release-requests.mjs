/**
 * release-requests.mjs — Release Request（RR）儲存與生命週期
 *
 * Fleming 2026-09-17：「現有的 release unit import 進來後可以 by commit 點做基準點。
 * 要準備 release 的時候應該要請求一張 release request 單，baseline 是從第一個或使用者自己選定。
 * 要通過所有證據的審查才可以結案該 release 單。」
 *
 * 單張 = .paaw/release-requests/RR-<stamp>-<rand>.json
 * 狀態機：draft → reviewing → released / cancelled
 *   - draft：可改 title / baseline
 *   - reviewing：baseline 鎖定；checklist 逐項審查（pass / fail / waive，waive 必留 note）
 *   - released：結案（不可逆）— 快照 REL 到 .paaw/releases/ + 批次放行範圍內 pending tasks
 *
 * checklist 四項（2026-09-17 Fleming 定案）：
 *   tests（unit + e2e）/ gates（build・type-check・test 門檻）/ qa-records / risk
 * 程式保證事實（deterministic），人下 verdict — No answer without evidence。
 *
 * gates 語言支援：verify 指令由 adapter 推斷（js-ts 全套 / python pytest+ruff / go 全套）；
 * 其他語言走 generic adapter 無指令 → gates 顯示 not-run（不硬猜）。之後可加 adapter 或
 * .paaw/verify.json override 支援。
 */

import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { rename } from "fs/promises";
import { shellExec } from "./shell-exec.mjs";
import { buildChangeIntelligence } from "./change-intelligence.mjs";
import { checkGates } from "./release-unit/gates.mjs";
import { readLastTestRun } from "./test-runner.mjs";
import { listQaResults } from "./qa-results.mjs";

// ── Checklist 定義（四項，2026-09-17 Fleming 定案）──

const CHECKLIST_DEFS = [
  { id: "tests", label: "測試全過（unit + e2e）" },
  { id: "gates", label: "品質門檻（build / type-check / test）" },
  { id: "qa-records", label: "QA 記錄無未解決 fail" },
  { id: "risk", label: "風險評估（readiness heuristic）" },
];

const PHASES_BEFORE_COMMIT = ["spec", "implement", "review", "test", "qa", "docs"];

// ── git helpers（跨平台：不用 pipe、不用單引號 format）──

async function gitLines(projectPath, args) {
  try {
    const { stdout } = await shellExec(`git ${args}`, { cwd: projectPath, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
    return (stdout || "").split("\n").map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

async function gitOne(projectPath, args) {
  const lines = await gitLines(projectPath, args);
  return lines[0] || null;
}

/** 完整描述一個 commit（不存在回 null） */
async function describeCommit(projectPath, sha, source) {
  // %x09 = tab 分隔，subject 不會被拆壞
  const line = await gitOne(projectPath, `log -1 --pretty=%H%x09%h%x09%aI%x09%an%x09%s ${sha}`);
  if (!line) return null;
  const [full, short, at, author, subject] = line.split("\t");
  return { sha: full, short, at, author, subject, ...(source ? { source } : {}) };
}

// ── 儲存 ──

function rrDir(projectPath) { return join(projectPath, ".paaw", "release-requests"); }

function newRRId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `RR-${stamp}-${randomBytes(2).toString("hex")}`;
}

async function saveRR(projectPath, rr) {
  const dir = rrDir(projectPath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const file = join(dir, `${rr.id}.json`);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(rr, null, 2), "utf-8");
  await rename(tmp, file);
  return rr;
}

export async function listReleaseRequests(projectPath) {
  const dir = rrDir(projectPath);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => /^RR-.*\.json$/.test(f));
  const out = [];
  for (const f of files) {
    try {
      const rr = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({
        id: rr.id, title: rr.title, status: rr.status,
        createdAt: rr.createdAt, closedAt: rr.closedAt || null,
        releaseId: rr.releaseId || null,
        createdBy: rr.createdBy || "human",
        baseline: { short: rr.baseline?.short, subject: rr.baseline?.subject, source: rr.baseline?.source },
        target: { short: rr.target?.short, subject: rr.target?.subject },
        scope: { commits: rr.scope?.commits?.count ?? 0, files: (rr.scope?.files || []).length, features: (rr.scope?.features || []).length, apis: (rr.scope?.apis || []).length, tasks: (rr.scope?.taskIds || []).length },
        checklist: (rr.checklist || []).map(c => ({ id: c.id, verdict: c.verdict, auto: c.auto?.status || "unknown" })),
        // v3（2026-09-18）：RM agent 建議 verdict — 列表帶摘要，人在 UI 一鍵確認
        suggested: rr.suggested && Object.keys(rr.suggested).length
          ? Object.fromEntries(Object.entries(rr.suggested).map(([k, v]) => [k, v.verdict]))
          : null,
      });
    } catch { /* skip corrupt */ }
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out;
}

export async function getReleaseRequest(projectPath, id) {
  const file = join(rrDir(projectPath), `${id}.json`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(await readFile(file, "utf-8")); } catch { return null; }
}

// ── baseline 解析 ──

/** 讀上次 release（.paaw/releases/ 最新一筆）— approve 寫的 REL 沒存 target sha，用日期 fallback */
async function lastReleaseRecord(projectPath) {
  const dir = join(projectPath, ".paaw", "releases");
  if (!existsSync(dir)) return null;
  const files = (await readdir(dir)).filter(f => f.endsWith(".json"));
  let best = null;
  for (const f of files) {
    try {
      const rel = JSON.parse(await readFile(join(dir, f), "utf-8"));
      if (!best || (rel.releasedAt || "") > (best.releasedAt || "")) best = rel;
    } catch { /* skip */ }
  }
  return best;
}

/**
 * 解析 baseline：
 * 1. 使用者指定 SHA（user-selected）
 * 2. auto → 上次 release 的 target sha（新 REL 有存）；舊 REL fallback 用 releasedAt 抓當時 HEAD
 * 3. 沒有 release → repo 第一個 commit（first-commit）
 */
export async function resolveBaseline(projectPath, shaOrAuto = "auto") {
  if (shaOrAuto && shaOrAuto !== "auto") {
    const verified = await gitOne(projectPath, `rev-parse --verify ${shaOrAuto}^{commit}`);
    if (!verified) {
      const e = new Error(`baseline commit 不存在：${shaOrAuto}`);
      e.status = 400;
      throw e;
    }
    const c = await describeCommit(projectPath, verified, "user-selected");
    return c;
  }
  const last = await lastReleaseRecord(projectPath);
  if (last?.target?.sha) {
    const c = await describeCommit(projectPath, last.target.sha, "last-release-head");
    if (c) return c;
  }
  if (last?.releasedAt) {
    // 舊 REL（approve 流程）沒存 sha：releasedAt 當下最新的 commit ≈ 當時 release 的 HEAD
    const sha = await gitOne(projectPath, `log -1 --before="${last.releasedAt}" --pretty=%H`);
    if (sha) {
      const c = await describeCommit(projectPath, sha, "last-release-head");
      if (c) return c;
    }
  }
  const root = await gitOne(projectPath, "rev-list --max-parents=0 HEAD");
  if (root) return describeCommit(projectPath, root, "first-commit");
  const e = new Error("repo 沒有任何 commit，無法決定 baseline");
  e.status = 400;
  throw e;
}

/** 給 UI 挑 baseline 用：auto 建議 + 最近 N 個 commit */
export async function baselineCandidates(projectPath) {
  const auto = await resolveBaseline(projectPath, "auto");
  const lines = await gitLines(projectPath, "log -20 --pretty=%H%x09%h%x09%aI%x09%an%x09%s");
  const commits = lines.map(l => {
    const [sha, short, at, author, subject] = l.split("\t");
    return { sha, short, at, author, subject, isAuto: sha === auto?.sha };
  });
  return { auto, recent: commits };
}

// ── scope 計算（deterministic：git + feature map）──

function pendingReleaseTasks(projectPath) {
  try {
    const data = JSON.parse(readFileSync(join(projectPath, ".paaw", "tasks", "TASKS.json"), "utf-8"));
    return (data.tasks || []).filter(t => {
      const pl = t?.pipeline;
      if (!pl) return false; // mini loop task 沒有證據流
      for (const ph of PHASES_BEFORE_COMMIT) {
        if (pl[ph]?.status !== "done") return false;
      }
      const st = pl.commit?.status || "pending";
      if (st === "done" || st === "rework") return false;
      if (t.status === "released" || t.status === "rejected") return false;
      return true;
    }).map(t => ({ id: t.id, title: t.title }));
  } catch { return []; }
}

export async function computeScope(projectPath, baselineSha, targetSha, opts = {}) {
  // by-SHA 精確範圍（不再靠日期）
  const { data: ci } = await buildChangeIntelligence(projectPath, { fromSha: baselineSha, toSha: targetSha, maxCommits: 300 });
  const commits = ci?.commits || [];
  const recentFiles = ci?.recentFiles || [];
  const changedSet = new Set(recentFiles.map(f => f.file));

  let model = null;
  try { model = JSON.parse(readFileSync(join(projectPath, ".paaw", "release-unit-model.json"), "utf-8")); } catch { /* no model */ }

  const changedApis = (model?.apis || [])
    .filter(a => a.file && changedSet.has(a.file))
    .map(a => ({ method: a.method, path: a.path, file: a.file, featureIds: a.featureIds || [] }));

  const changedFeatures = [];
  for (const f of model?.features || []) {
    const files = (f.files || []).filter(x => changedSet.has(x));
    if (!files.length) continue;
    const fids = new Set([f.id]);
    const apis = changedApis.filter(a => a.featureIds?.some(id => fids.has(id)));
    changedFeatures.push({
      id: f.id, name: f.name, status: f.status,
      changedFiles: files,
      apis: apis.map(a => `${a.method} ${a.path}`),
      apiImpact: apis.length > 0,
      hasTests: (f.tests || []).length > 0,
    });
  }

  let taskIds = pendingReleaseTasks(projectPath); // pending = 未放行，定義上都在 baseline 之後
  // v3（2026-09-18）：per-task approve 自動建 RR 用 — scope 限定單一 task，避免誤放行其他 pending tasks
  if (opts.onlyTaskIds) {
    const want = new Set(opts.onlyTaskIds);
    taskIds = taskIds.filter(x => want.has(x.id));
  }

  return {
    computedAt: new Date().toISOString(),
    commits: {
      count: commits.length,
      authors: [...new Set(commits.map(c => c.author))],
      subjects: commits.slice(0, 30).map(c => `${c.short || (c.hash || "").slice(0, 8)} ${c.subject}`),
    },
    files: recentFiles,
    features: changedFeatures,
    apis: changedApis,
    taskIds, // pending = 未放行，定義上都在 baseline 之後
  };
}

// ── checklist 自動檢查（程式保證事實）──

function scopeRisk(scope, autoSoFar) {
  let score = 0;
  const reasons = [];
  const feats = scope.features || [];
  if (feats.some(f => !f.hasTests && f.apiImpact)) { score += 2; reasons.push("API 變更的 feature 沒有測試"); }
  else if (feats.some(f => !f.hasTests)) { score += 1; reasons.push("有 feature 沒有測試"); }
  if ((scope.files || []).length > 20) { score += 1; reasons.push(`${scope.files.length} 個檔案變更`); }
  if ((scope.apis || []).length > 10) { score += 1; reasons.push(`${scope.apis.length} 個 API 變更`); }
  if (autoSoFar.gates?.status === "fail") { score += 1; reasons.push("gates blocked"); }
  if (autoSoFar.tests?.status === "fail") { score += 1; reasons.push("上次測試有 fail"); }
  const level = score >= 3 ? "HIGH" : score >= 1 ? "MEDIUM" : "LOW";
  return { score, level, reasons };
}

export async function autoCheckAll(projectPath, scope) {
  const at = new Date().toISOString();
  const out = {};

  // tests — 上次 test run 真實數字 + stale 偵測
  try {
    const rec = readLastTestRun(projectPath);
    if (!rec) {
      out.tests = { status: "unknown", detail: "從未執行測試 — 先跑一次 test run", checkedAt: at };
    } else {
      const s = rec.summary || {};
      const k = rec.byKind || {};
      let stale = false, staleCommits = 0;
      if (rec.headSha) {
        const c = await gitOne(projectPath, `rev-list ${rec.headSha}..HEAD --count`);
        staleCommits = parseInt(c, 10) || 0;
        stale = staleCommits > 0;
      }
      const kindPart = (k.unit || k.e2e)
        ? `（unit ${k.unit?.passed ?? 0}✓${k.unit?.failed ?? 0}✗ / e2e ${k.e2e?.passed ?? 0}✓${k.e2e?.failed ?? 0}✗）` : "";
      const stalePart = stale ? `；⚠ 結果落後 ${staleCommits} commits` : "";
      out.tests = {
        status: rec.status === "fail" || (s.failed || 0) > 0 ? "fail" : stale ? "warn" : "pass",
        detail: `${s.passed ?? 0}✓ ${s.failed ?? 0}✗ ${s.skipped ?? 0}⋯${kindPart}${stalePart}；run at ${rec.finishedAt}`,
        checkedAt: at,
        runId: rec.id || null,
      };
    }
  } catch { out.tests = { status: "unknown", detail: "test run 讀取失敗", checkedAt: at }; }

  // gates — checkGates() 對照 verify-last + git 狀態
  try {
    const g = await checkGates(projectPath);
    if (g.overall === "blocked") out.gates = { status: "fail", detail: `blocked：${(g.blocking || []).join(", ")}`, checkedAt: at };
    else if (g.overall === "pass-with-warnings") out.gates = { status: "warn", detail: `warnings：${(g.warnings || []).join(", ")}`, checkedAt: at };
    else out.gates = { status: "pass", detail: `verify at ${g.verifyAt || "n/a"}`, checkedAt: at };
  } catch { out.gates = { status: "unknown", detail: "gates 檢查失敗", checkedAt: at }; }

  // qa-records — 範圍內有沒有 open 的 QA fail（qa-results.jsonl）
  try {
    const opens = listQaResults(projectPath, { verdict: "fail", status: "open", limit: 500 });
    out["qa-records"] = opens.length
      ? { status: "fail", detail: `${opens.length} 筆未解決 fail：${opens.slice(0, 5).map(r => r.id).join(", ")}${opens.length > 5 ? "…" : ""}`, checkedAt: at }
      : { status: "pass", detail: "無未解決 QA fail 記錄", checkedAt: at };
  } catch { out["qa-records"] = { status: "unknown", detail: "QA 記錄讀取失敗", checkedAt: at }; }

  // risk — readiness 同款 heuristic，對 scope 計算
  const { level, reasons } = scopeRisk(scope, out);
  out.risk = {
    status: level === "HIGH" ? "fail" : level === "MEDIUM" ? "warn" : "pass",
    detail: `${level}${reasons.length ? "：" + reasons.join("；") : "（無風險訊號）"}`,
    checkedAt: at,
  };

  return out;
}

function freshChecklist(autoResults) {
  return CHECKLIST_DEFS.map(def => ({
    id: def.id,
    label: def.label,
    auto: autoResults[def.id] || { status: "unknown", detail: "—", checkedAt: new Date().toISOString() },
    verdict: "pending",
    reviewedBy: null,
    reviewedAt: null,
    note: null,
  }));
}

// ── 生命週期 ──

function hist(rr, by, event, note = null) {
  rr.history = rr.history || [];
  rr.history.push({ ts: new Date().toISOString(), by: by || "human", event, note });
}

export async function createReleaseRequest(projectPath, { title, baseline = "auto" } = {}) {
  const base = await resolveBaseline(projectPath, baseline);
  const headSha = await gitOne(projectPath, "rev-parse HEAD");
  if (!headSha) {
    const e = new Error("repo 沒有 HEAD，無法建單");
    e.status = 400;
    throw e;
  }
  const target = await describeCommit(projectPath, headSha);
  const scope = await computeScope(projectPath, base.sha);
  const auto = await autoCheckAll(projectPath, scope);

  const rr = {
    id: newRRId(),
    title: title || `Release ${new Date().toISOString().slice(0, 10)} — ${scope.commits.count} commits`,
    createdAt: new Date().toISOString(),
    createdBy: "human",
    status: "draft",
    baseline: base,
    target,
    scope,
    checklist: freshChecklist(auto),
    releaseId: null,
    closedAt: null,
    history: [],
  };
  hist(rr, "human", "created", `baseline=${base.short}（${base.source}）→ target=${target.short}，${scope.commits.count} commits`);
  await saveRR(projectPath, rr);
  return rr;
}

/** draft 改 title / baseline；reviewing 改 title */
export async function updateReleaseRequest(projectPath, id, { title, baseline } = {}) {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status === "released" || rr.status === "cancelled") {
    const e = new Error(`已 ${rr.status}，不可修改`); e.status = 400; throw e;
  }
  if (baseline && rr.status !== "draft") {
    const e = new Error("baseline 只能在 draft 階段修改（reviewing 已鎖定）"); e.status = 400; throw e;
  }
  if (title) { rr.title = title; hist(rr, "human", "renamed", title); }
  if (baseline) {
    const base = await resolveBaseline(projectPath, baseline);
    rr.baseline = base;
    rr.scope = await computeScope(projectPath, base.sha);
    const auto = await autoCheckAll(projectPath, rr.scope);
    for (const item of rr.checklist) item.auto = auto[item.id] || item.auto;
    hist(rr, "human", "baseline-changed", `${base.short}（${base.source}）`);
  }
  await saveRR(projectPath, rr);
  return rr;
}

/** draft → reviewing（baseline 鎖定，開始逐項審查） */
export async function openReleaseRequest(projectPath, id) {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status !== "draft") { const e = new Error(`狀態是 ${rr.status}，只有 draft 可以 open`); e.status = 400; throw e; }
  rr.status = "reviewing";
  hist(rr, "human", "opened", "baseline 鎖定，開始證據審查");
  await saveRR(projectPath, rr);
  return rr;
}

/** 審查一項：pass / fail / waive（waive 必留 note） */
export async function reviewChecklistItem(projectPath, id, itemId, verdict, note) {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status !== "reviewing") { const e = new Error(`狀態是 ${rr.status}，只有 reviewing 可以審查`); e.status = 400; throw e; }
  const item = rr.checklist.find(c => c.id === itemId);
  if (!item) { const e = new Error(`checklist item 不存在：${itemId}`); e.status = 404; throw e; }
  if (!["pass", "fail", "waived"].includes(verdict)) {
    const e = new Error("verdict 只能是 pass / fail / waived"); e.status = 400; throw e;
  }
  if (verdict === "waived" && !note) {
    const e = new Error("waive 必須留 note（為什麼可以放行）"); e.status = 400; throw e;
  }
  item.verdict = verdict;
  item.reviewedBy = "human";
  item.reviewedAt = new Date().toISOString();
  item.note = note || null;
  hist(rr, "human", `reviewed:${itemId}:${verdict}`, note || null);
  await saveRR(projectPath, rr);
  return rr;
}

/** 刷新（GET 單張時用）：target 前進到 HEAD、scope 重算、auto 重跑；verdict 保留 */
export async function refreshReleaseRequest(projectPath, id) {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) return null;
  if (rr.status === "released" || rr.status === "cancelled") return rr;
  const headSha = await gitOne(projectPath, "rev-parse HEAD");
  if (headSha && headSha !== rr.target?.sha) {
    rr.target = await describeCommit(projectPath, headSha);
    rr.scope = await computeScope(projectPath, rr.baseline.sha);
    hist(rr, "system", "target-advanced", `target 前進到 ${rr.target.short}，scope 重算`);
  }
  const auto = await autoCheckAll(projectPath, rr.scope);
  for (const item of rr.checklist) item.auto = auto[item.id] || item.auto;
  await saveRR(projectPath, rr);
  return rr;
}

/**
 * 結案：
 * 1. 先刷新（target → HEAD、auto 重跑）
 * 2. 全部 verdict ∈ {pass, waived} 才准（fail/pending → 409）
 * 3. auto 變 fail 但人只給 pass（未 waive）→ 409（證據變化要重審）
 * 4. 快照 REL → .paaw/releases/ + 批次放行範圍內 pending tasks
 */
export async function closeReleaseRequest(projectPath, id, { note } = {}) {
  let rr = await refreshReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status !== "reviewing") { const e = new Error(`狀態是 ${rr.status}，只有 reviewing 可以結案`); e.status = 400; throw e; }

  const notDone = rr.checklist.filter(c => !["pass", "waived"].includes(c.verdict));
  if (notDone.length) {
    const e = new Error(`尚有 ${notDone.length} 項未通過審查：${notDone.map(c => `${c.id}(${c.verdict})`).join(", ")}`);
    e.status = 409; e.extra = { pending: notDone.map(c => c.id) };
    throw e;
  }
  const staleFail = rr.checklist.filter(c => c.auto?.status === "fail" && c.verdict !== "waived");
  if (staleFail.length) {
    const e = new Error(`證據狀態已變化（自動檢查 fail 但未 waive）：${staleFail.map(c => `${c.id} — ${c.auto.detail}`).join("；")}`);
    e.status = 409; e.extra = { stale: staleFail.map(c => c.id) };
    throw e;
  }

  // 快照 REL（存 target sha，之後的 RR auto baseline 直接用，不再靠日期 fallback）
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
  const relId = `REL-${stamp}-rr${rr.id.split("-").pop()}`;
  const relDir = join(projectPath, ".paaw", "releases");
  if (!existsSync(relDir)) await mkdir(relDir, { recursive: true });
  await writeFile(join(relDir, `${relId}.json`), JSON.stringify({
    id: relId,
    releasedAt: new Date().toISOString(),
    rrId: rr.id,
    title: rr.title,
    note: note || null,
    decidedBy: "release-request",
    baseline: rr.baseline,
    target: rr.target,   // 之後 baseline auto 直接讀這個
    scope: rr.scope,
    checklist: rr.checklist,
  }, null, 2), "utf-8");

  // 批次放行範圍內 pending tasks（Fleming 2026-09-17 建議採納：結案即放行，note 記 RR id）
  let releasedTasks = 0;
  const tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
  if (existsSync(tasksFile)) {
    try {
      const data = JSON.parse(await readFile(tasksFile, "utf-8"));
      const scopeIds = new Set((rr.scope.taskIds || []).map(t => t.id || t));
      const at = new Date().toISOString();
      for (const task of data.tasks || []) {
        if (!scopeIds.has(task.id)) continue;
        if (task.status === "released" || task.pipeline?.commit?.status === "done") continue;
        task.pipeline.commit = { status: "done", by: "release-request", at, result: `approved via ${rr.id}` };
        task.status = "released";
        task.releaseId = relId;
        task.updatedAt = at;
        task.notes = task.notes || [];
        task.notes.push({ by: "release-request", at, content: `🚀 批次放行（${rr.id} → ${relId}）` });
        releasedTasks++;
      }
      if (releasedTasks > 0) {
        const tmp = `${tasksFile}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
        await rename(tmp, tasksFile);
      }
    } catch { /* TASKS.json 壞檔不擋結案（REL 已快照） */ }
  }

  rr.status = "released";
  rr.releaseId = relId;
  rr.closedAt = new Date().toISOString();
  hist(rr, "human", "closed", `${relId}${releasedTasks ? `，放行 ${releasedTasks} tasks` : ""}${note ? `：${note}` : ""}`);
  await saveRR(projectPath, rr);
  return { ok: true, rr, releaseId: relId, releasedTasks };
}

export async function cancelReleaseRequest(projectPath, id, { reason } = {}) {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status === "released") { const e = new Error("已結案，不可取消"); e.status = 400; throw e; }
  if (rr.status === "cancelled") return rr;
  rr.status = "cancelled";
  hist(rr, "human", "cancelled", reason || null);
  await saveRR(projectPath, rr);
  return rr;
}

// ── v3（2026-09-18）：RM agent 建議 verdict — AI 只建議，人在 UI 一鍵確認 ──

/**
 * 寫入 AI 建議（不動 verdict）：rr.suggested[itemId] = { verdict, reason, by, at }
 * draft / reviewing 都可建議（建議不鎖任何東西）；released/cancelled 拒絕。
 */
export async function suggestVerdicts(projectPath, id, items, by = "rm-agent") {
  const rr = await getReleaseRequest(projectPath, id);
  if (!rr) { const e = new Error("release request not found"); e.status = 404; throw e; }
  if (rr.status === "released" || rr.status === "cancelled") {
    const e = new Error(`已 ${rr.status}，不接受新建議`); e.status = 400; throw e;
  }
  if (!Array.isArray(items) || items.length === 0) {
    const e = new Error("items 必須是 [{ itemId, verdict, reason }]（至少一項）"); e.status = 400; throw e;
  }
  const valid = new Set((rr.checklist || []).map(c => c.id));
  rr.suggested = rr.suggested || {};
  const applied = [];
  for (const it of items) {
    if (!valid.has(it.itemId)) { const e = new Error(`checklist item 不存在：${it.itemId}（有效：${[...valid].join(", ")}）`); e.status = 404; throw e; }
    if (!["pass", "fail", "waived"].includes(it.verdict)) {
      const e = new Error(`verdict 只能是 pass / fail / waived（${it.itemId}）`); e.status = 400; throw e;
    }
    if (!it.reason) { const e = new Error(`${it.itemId} 缺 reason — No answer without evidence`); e.status = 400; throw e; }
    rr.suggested[it.itemId] = { verdict: it.verdict, reason: it.reason, by, at: new Date().toISOString() };
    applied.push(`${it.itemId}:${it.verdict}`);
  }
  hist(rr, by, "ai-suggested", applied.join(", "));
  await saveRR(projectPath, rr);
  return rr;
}

/**
 * v3（2026-09-18）：per-task approve 自動建 RR — 統一審計軌跡。
 *
 * 人在待放行區單獨批准一個 task（快速路徑）時，approve 流程寫完 REL 後叫這個：
 *  - baseline = auto（上次 release head / first commit）、target = 當下 HEAD
 *  - scope.taskIds 限定該 task（不會誤放行其他 pending tasks — 放行由 approve 主流程負責）
 *  - checklist：auto pass → verdict pass；auto fail/warn → waived（note 記快速路徑 + 自動證據）
 *  - 直接 status=released，releaseId 掛 approve 寫的 REL — 歷史可回溯
 */
export async function createAutoRrForTaskApproval(projectPath, { taskId, taskTitle, relId, note } = {}) {
  if (!taskId || !relId) { const e = new Error("taskId and relId required"); e.status = 400; throw e; }
  const base = await resolveBaseline(projectPath, "auto");
  const headSha = await gitOne(projectPath, "rev-parse HEAD");
  if (!headSha) { const e = new Error("repo 沒有 HEAD"); e.status = 400; throw e; }
  const target = await describeCommit(projectPath, headSha);
  const scope = await computeScope(projectPath, base.sha, headSha, { onlyTaskIds: [taskId] });
  const auto = await autoCheckAll(projectPath, scope);

  const checklist = CHECKLIST_DEFS.map(def => {
    const a = auto[def.id] || { status: "unknown", detail: "—" };
    const ok = a.status === "pass";
    return {
      id: def.id,
      label: def.label,
      auto: a,
      verdict: ok ? "pass" : "waived",
      reviewedBy: "human",
      reviewedAt: new Date().toISOString(),
      note: ok ? "per-task approve 快速路徑（人類單獨批准）" : `per-task approve 快速路徑 — waive 自動證據：${a.detail}`,
    };
  });

  const rr = {
    id: newRRId(),
    title: `Auto — ${taskTitle || taskId}`,
    createdAt: new Date().toISOString(),
    createdBy: "auto(per-task-approve)",
    status: "released",
    baseline: base,
    target,
    scope,
    checklist,
    releaseId: relId,
    closedAt: new Date().toISOString(),
    history: [],
  };
  hist(rr, "system", "created", `per-task approve 自動建單（${taskId}）— baseline=${base.short}（${base.source}）`);
  hist(rr, "human", "closed", `${relId}（快速路徑：人在待放行區批准 ${taskId}${note ? `，note：${note}` : ""}）`);
  await saveRR(projectPath, rr);
  return rr;
}

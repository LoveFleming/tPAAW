/**
 * em-job-entrypoints.mjs — EM 工頭工作分類入口（2026-10-01 柱三）
 *
 * Fleming 點名的四類工作（memory/em-foreman-design.md）：
 *   cu-scan      — 跑 CU 掃描 → findings triage → 開補洞單
 *   security-fix — 讀 scan-results.json → 按 severity 分組 → 開修復單
 *   test-gen     — 覆蓋率報告 → 缺口 → 開 test 單
 *   release-prep — release 狀態 → checklist 開單（build/QA/docs/打包）
 *
 * 流程固定（deterministic job types — NL 說得出就觸發得到）：
 *   叫入口拿結構化結果 → LLM 只做 triage（哪些值得開單、優先序）
 *   → 開單（createTicket）→ 之後交給既有派工閉環。原始掃描資料不進決策 context。
 *
 * 鐵律：收集用決定性程式，規劃用 LLM prompt（同 auto-dispatch 設計原則）。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve, relative } from "path";
import { fileURLToPath } from "url";
import { shellExec } from "./shell-exec.mjs";
import { createTicket, loadTasksFile } from "./em-task-store.mjs";

const __filename = fileURLToPath(import.meta.url);
const PAAW_ROOT = resolve(__filename, "..", "..", "..", "..");

export const JOB_TYPES = ["cu-scan", "security-fix", "test-gen", "release-prep"];

export const JOB_TYPE_META = {
  "cu-scan": { label: "CU 掃描（code understanding 補洞）", emoji: "🧠" },
  "security-fix": { label: "Security 修復（semgrep findings）", emoji: "🔒" },
  "test-gen": { label: "測試補洞（覆蓋率缺口）", emoji: "🧪" },
  "release-prep": { label: "Release 準備（checklist 開單）", emoji: "📦" },
};

async function _git(rootDir, args) {
  try {
    const r = await shellExec(`git ${args}`, { cwd: rootDir });
    return `${r.stdout || ""}${r.stderr || ""}`.trim();
  } catch { return ""; }
}

function _readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return null; }
}

function _fileAgeDays(file) {
  try {
    return (Date.now() - statSync(file).mtimeMs) / 86400000;
  } catch { return Infinity; }
}

// ══════════════════════════════════════════
// 入口一：cu-scan — CU 機械層重掃 + feature 補洞
// ══════════════════════════════════════════
async function _entryCuScan(rootDir, opts) {
  const findings = [];
  const meta = {};

  // 1. 機械層重掃（code/test/change intelligence — 免 LLM、秒級）
  if (opts.runRescan !== false) {
    try {
      const { rescanMechanicalLayer } = await import("./cu-mechanical.mjs");
      const r = await rescanMechanicalLayer(rootDir, PAAW_ROOT);
      meta.rescan = r;
    } catch (err) {
      meta.rescanError = err.message;
    }
  }

  // 2. FEATURES.json：active feature 缺 tests / 缺 docs
  const feats = _readJson(join(rootDir, ".paaw", "features", "FEATURES.json"));
  const featureList = feats?.features || [];
  let noTests = 0, noDocs = 0;
  for (const f of featureList) {
    if (f.status !== "active") continue;
    const hasTests = Array.isArray(f.testFiles) && f.testFiles.length > 0;
    const hasDocs = Array.isArray(f.docFiles) && f.docFiles.length > 0 || !!f.docFile;
    if (!hasTests) { noTests++; if (findings.filter(x => x.kind === "feature-no-tests").length < 10) findings.push({ kind: "feature-no-tests", featureId: f.id, name: f.name, codeFiles: (f.codeFiles || []).length }); }
    if (!hasDocs) { noDocs++; if (findings.filter(x => x.kind === "feature-no-docs").length < 8) findings.push({ kind: "feature-no-docs", featureId: f.id, name: f.name }); }
  }
  meta.activeFeatures = featureList.filter(f => f.status === "active").length;
  meta.featuresNoTests = noTests;
  meta.featuresNoDocs = noDocs;

  // 3. CU status 過期步驟
  const cuStatus = _readJson(join(rootDir, ".paaw", "cu-status.json"));
  if (cuStatus?.steps && typeof cuStatus.steps === "object") {
    for (const [step, st] of Object.entries(cuStatus.steps)) {
      const ageDays = st?.updatedAt ? (Date.now() - new Date(st.updatedAt).getTime()) / 86400000 : null;
      if (ageDays !== null && ageDays > 30 && st.status === "done") {
        findings.push({ kind: "cu-step-stale", step, ageDays: Math.round(ageDays) });
      }
    }
  }

  return {
    type: "cu-scan",
    ok: true,
    summary: `CU 掃描：${meta.activeFeatures ?? 0} active features（缺測試 ${noTests}／缺文件 ${noDocs}）${meta.rescanError ? `；機械層重掃失敗：${meta.rescanError}` : ""}`,
    findings,
    meta,
  };
}

// ══════════════════════════════════════════
// 入口二：security-fix — semgrep findings 分組
// ══════════════════════════════════════════
async function _entrySecurityFix(rootDir, opts) {
  const findings = [];
  const secFile = join(rootDir, ".paaw", "security", "scan-results.json");
  const ageDays = _fileAgeDays(secFile);

  if (!existsSync(secFile) || ageDays === Infinity || ageDays > 7) {
    return {
      type: "security-fix",
      ok: true,
      summary: `Security 掃描不存在或過期（${ageDays === Infinity ? "無檔" : `${Math.round(ageDays)} 天前`}）— 需先重掃`,
      findings: [{ kind: "security-scan-stale", ageDays: ageDays === Infinity ? null : Math.round(ageDays) }],
      meta: { needsRescan: true },
    };
  }

  const data = _readJson(secFile);
  const list = Array.isArray(data?.findings) ? data.findings : [];
  const sevRank = { ERROR: 0, WARNING: 1, INFO: 2 };
  const byFile = new Map(); // file → {sev counts, cwes}
  for (const f of list) {
    const sev = sevRank[f.severity] !== undefined ? f.severity : "INFO";
    if (sev === "INFO") continue; // INFO 不開單
    const rel = String(f.file || "").startsWith("/") ? rel2(rootDir, f.file) : String(f.file || "unknown");
    if (!byFile.has(rel)) byFile.set(rel, { ERROR: 0, WARNING: 0, cwes: new Set(), sample: f });
    const g = byFile.get(rel);
    g[sev]++;
    for (const c of f.cwe || []) g.cwes.add(String(c).split(":")[0]);
  }
  const groups = [...byFile.entries()]
    .map(([file, g]) => ({ file, error: g.ERROR, warning: g.WARNING, cwe: [...g.cwes].slice(0, 4), sample: { message: String(g.sample.message || "").slice(0, 200), line: g.sample.line } }))
    .sort((a, b) => (b.error - a.error) || (b.warning - a.warning));
  for (const g of groups.slice(0, 15)) {
    findings.push({ kind: "security-fix-group", ...g });
  }
  return {
    type: "security-fix",
    ok: true,
    summary: `Security：ERROR ${groups.reduce((s, g) => s + g.error, 0)}／WARNING ${groups.reduce((s, g) => s + g.warning, 0)}，分布 ${groups.length} 檔（掃描 ${Math.round(ageDays)} 天前）`,
    findings,
    meta: { scanAgeDays: Math.round(ageDays), totalGroups: groups.length },
  };
}

function rel2(rootDir, abs) {
  try { return relative(rootDir, abs) || abs; } catch { return abs; }
}

// ══════════════════════════════════════════
// 入口三：test-gen — 覆蓋率缺口
// ══════════════════════════════════════════
async function _entryTestGen(rootDir, opts) {
  const findings = [];
  const ti = _readJson(join(rootDir, ".paaw", "code-intelligence", "test-intelligence.json"));
  if (!ti) {
    return { type: "test-gen", ok: true, summary: "無 test-intelligence 資料 — 先跑 cu-scan", findings: [{ kind: "test-intel-missing" }], meta: {} };
  }
  const gaps = Array.isArray(ti.coverageGaps) ? ti.coverageGaps : [];
  // 大檔優先（functionCount 高 = 風險大）
  const top = [...gaps].sort((a, b) => (b.functionCount || 0) - (a.functionCount || 0)).slice(0, 10);
  for (const g of top) {
    findings.push({ kind: "test-gap", file: g.file, functionCount: g.functionCount, exportCount: g.exportCount });
  }
  return {
    type: "test-gen",
    ok: true,
    summary: `測試覆蓋 ${ti.stats?.coverageRate ?? "?"}（${ti.stats?.totalTestFiles ?? 0} test files）；缺口檔 ${ti.stats?.coverageGapFiles ?? gaps.length}，取前 ${top.length} 大檔開單`,
    findings,
    meta: { coverageRate: ti.stats?.coverageRate, gapFiles: ti.stats?.coverageGapFiles },
  };
}

// ══════════════════════════════════════════
// 入口四：release-prep — release 現況 checklist
// ══════════════════════════════════════════
async function _entryReleasePrep(rootDir, opts) {
  const findings = [];
  const meta = {};

  // 1. 進行中 RR
  let activeRR = null;
  try {
    const rrDir = join(rootDir, ".paaw", "release-requests");
    if (existsSync(rrDir)) {
      for (const f of readdirSync(rrDir).filter(f => f.endsWith(".json"))) {
        const rr = _readJson(join(rrDir, f));
        if (rr && (rr.status === "draft" || rr.status === "reviewing")) { activeRR = rr; break; }
      }
    }
  } catch {}
  meta.activeRR = activeRR ? { id: activeRR.id, status: activeRR.status, title: activeRR.title } : null;
  if (!activeRR) findings.push({ kind: "no-active-rr", note: "沒有進行中的 release request — 若近期要 release 需先開 RR（人類決定 baseline）" });

  // 2. 未 push commits
  const unpushed = await _git(rootDir, "log --oneline @{u}..HEAD");
  if (unpushed) {
    const n = unpushed.split("\n").filter(Boolean).length;
    meta.unpushedCommits = n;
    if (n > 0) findings.push({ kind: "unpushed-commits", count: n, sample: unpushed.split("\n").slice(0, 5) });
  }

  // 3. 未文件化 commits
  try {
    const { runGit } = await import("../routes/vibe-fs.mjs");
    const { getUndocumentedCommits } = await import("./doc-coverage.mjs");
    const { commits } = await getUndocumentedCommits(rootDir, runGit);
    meta.undocumentedCommits = commits.length;
    if (commits.length > 0) findings.push({ kind: "undocumented-commits", count: commits.length, sample: commits.slice(0, 5) });
  } catch {}

  // 4. working tree 髒污
  const st = await _git(rootDir, "status --porcelain");
  const dirty = st ? st.split("\n").filter(Boolean).length : 0;
  meta.dirtyFiles = dirty;
  if (dirty > 0) findings.push({ kind: "dirty-tree", count: dirty });

  // 5. open tasks（release 前要收乾）
  const { tasks } = loadTasksFile(rootDir);
  const open = tasks.filter(t => !t.parentId && ["open", "in-progress", "pending"].includes(String(t.status || "").toLowerCase()));
  meta.openTasks = open.length;
  if (open.length > 0) findings.push({ kind: "open-tasks", count: open.length, sample: open.slice(0, 5).map(t => `${t.id} ${t.title}`) });

  return {
    type: "release-prep",
    ok: true,
    summary: `Release 現況：${activeRR ? `RR ${activeRR.id}（${activeRR.status}）` : "無進行中 RR"}｜未 push ${meta.unpushedCommits || 0}｜未文件化 ${meta.undocumentedCommits || 0}｜髒檔 ${dirty}｜open tasks ${open.length}`,
    findings,
    meta,
  };
}

// ── 分發 ──
export async function runJobEntrypoint(rootDir, type, opts = {}) {
  if (!JOB_TYPES.includes(type)) {
    return { type, ok: false, error: `未知 job type：${type}（可用：${JOB_TYPES.join(", ")}）` };
  }
  const t0 = Date.now();
  try {
    const fn = { "cu-scan": _entryCuScan, "security-fix": _entrySecurityFix, "test-gen": _entryTestGen, "release-prep": _entryReleasePrep }[type];
    const result = await fn(rootDir, opts);
    result.durationMs = Date.now() - t0;
    return result;
  } catch (err) {
    return { type, ok: false, error: err.message, durationMs: Date.now() - t0 };
  }
}

// ══════════════════════════════════════════
// LLM triage：結構化 findings → 開單（LLM 只做判斷，程式寫檔）
// ══════════════════════════════════════════

const TRIAGE_PROMPT = `你是 EM 工頭。一個 deterministic 工作入口剛跑完結構化掃描，你只做 triage：哪些 findings 值得開單、開成什麼單、什麼優先序。

## 規則
- 原始掃描資料不進派工 — 只開單；單要自包含（agent 看單就能做）
- 有明確修法的才開單；資訊不足的標記 skip（例如 security-scan-stale → 開「重跑 security 掃描」單即可）
- 單張數量上限：{{maxTickets}}。挑影響最大的。同檔多個 finding 合成一張單
- description 要帶足 context：檔案路徑、問題描述（從 findings 摘）、預期結果
- acceptance 必須可執行可驗收（例如：npm test 全過 / semgrep 重掃該檔 0 ERROR）
- 不要開「改善品質」這種空泛單；不要重複已開過的單（已開清喣會給你）

## 輸出（嚴格 JSON array，沒有值得開的就 []）
\`\`\`json
[{"title":"...","description":"...","acceptance":"...","type":"dev|test|docs","priority":"high|medium|low","featureId":"F-XXX（選填，不確定就空）","dedupeKey":"短關鍵字（如 sec:connection.ts）","reason":"為什麼值得開"}]
\`\`\``;

/**
 * @param {object} p {rootDir, type, result, modelOverride, fallbackModels, sendSSE, maxTickets, dryRun, _llmCall(測試注入)}
 * @returns {{ok, tickets: [], skipped: 0, error?}}
 */
export async function triageToTickets(p = {}) {
  const { rootDir, type, result, modelOverride, fallbackModels = [], sendSSE = (() => {}), maxTickets = 5, dryRun = false, _llmCall } = p;
  if (!result?.ok) return { ok: false, error: result?.error || "entrypoint 失敗" };
  if (!result.findings?.length) {
    sendSSE("info", { message: `${JOB_TYPE_META[type]?.emoji || "job"} ${JOB_TYPE_META[type]?.label || type}：掃描乾淨，無 findings — 不開單` });
    return { ok: true, tickets: [], skipped: 0, summary: result.summary };
  }

  // dedupe：同入口已有 open 單（label entry:<type> + dedupeKey label）不重開
  const { tasks } = loadTasksFile(rootDir);
  const openLabels = new Set(
    tasks.filter(t => String(t.status).toLowerCase() === "open").flatMap(t => t.labels || [])
  );

  // LLM triage（小 context：findings JSON 而已）
  let list = [];
  if (typeof _llmCall === "function") {
    list = await _llmCall({ type, result, openLabels: [...openLabels] });
  } else {
    const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
    const { callLLMWithRetry } = await import("./llm-utils.mjs");
    const llm = resolveLLMConfig(rootDir, modelOverride);
    let _fbm = (fallbackModels || []).filter(Boolean);
    if (_fbm.length === 0) {
      try { _fbm = resolveLLMConfig(rootDir).fallbacks.map(f => `${f.providerId}/${f.model}`); } catch {}
    }
    const fallbackCfgs = _fbm.map(m => resolveLLMConfig(rootDir, m));
    const prompt = TRIAGE_PROMPT.replace("{{maxTickets}}", String(maxTickets))
      + `\n\n## 掃描結果（type: ${type}）\n摘要：${result.summary}\n\n## 已開的 open 單 labels（避免重複）\n${[...openLabels].filter(l => l.startsWith("entry:")).join("\n") || "(無)"}\n\n## findings\n\`\`\`json\n${JSON.stringify(result.findings, null, 1).slice(0, 24000)}\n\`\`\`\n\n你的 triage（JSON array）：`;
    try {
      sendSSE("llm_start", { message: `${JOB_TYPE_META[type]?.emoji || "📡"} ${type} triage 中...` });
      const res = await callLLMWithRetry(llm.apiUrl, llm.headers, {
        model: llm.model || llm.defaultModel,
        messages: [
          { role: "system", content: "你是 EM 工頭的 triage 助手，只輸出 JSON array。" },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      }, { maxRetries: 2, timeoutMs: 300_000, agentId: "em-job-triage", disableThinking: true, fallbacks: fallbackCfgs });
      const m = String(res?.content || "").match(/\[[\s\S]*\]/);
      if (m) list = JSON.parse(m[0]);
    } catch (err) {
      sendSSE("warning", { message: `⚠️ ${type} triage LLM 失敗：${err.message}（不開單，下次再試）` });
      return { ok: false, error: `triage LLM 失敗：${err.message}`, tickets: [], skipped: 0 };
    }
  }

  // 開單（程式寫檔 — deterministic；dryRun 只回建議不寫檔）
  const tickets = [];
  let skipped = 0;
  for (const item of (Array.isArray(list) ? list : []).slice(0, maxTickets)) {
    if (!item?.title || !item?.description) continue;
    const dedupeKey = String(item.dedupeKey || item.title).slice(0, 60);
    const label = `entry:${type}:${dedupeKey}`;
    if (openLabels.has(label)) { skipped++; continue; }
    if (dryRun) {
      tickets.push({ title: item.title, type: item.type || "dev", priority: item.priority || "medium", dedupeKey, reason: item.reason || "" });
      openLabels.add(label);
      continue;
    }
    const created = createTicket(rootDir, {
      title: item.title,
      description: item.description,
      acceptance: item.acceptance || "照 description 驗收",
      type: item.type,
      priority: item.priority,
      featureId: item.featureId || undefined,
      labels: [label, `entry:${type}`],
      createdBy: "em-job",
      source: `em-job:${type}`,
      note: `${JOB_TYPE_META[type]?.label || type} 入口 triage 開單：${String(item.reason || "").slice(0, 200)}`,
    });
    if (created.ok) {
      tickets.push(created.task);
      openLabels.add(label);
    }
  }
  sendSSE("info", { message: `${JOB_TYPE_META[type]?.emoji || "🎫"} ${type}：${dryRun ? "建議開" : "開"} ${tickets.length} 張單${skipped ? `（${skipped} 張重複跳過）` : ""}${tickets.length ? `：${tickets.map(t => t.id || t.title.slice(0, 30)).join(", ")}` : ""}` });
  return { ok: true, tickets, skipped, summary: result.summary };
}

// ── 排程入口讀 config（哪些 job types 在夜間排程啟用）──
export function readJobTypesConfig(rootDir) {
  try {
    const cfg = _readJson(join(rootDir, ".paaw", "auto-dispatch", "config.json"));
    const arr = Array.isArray(cfg?.jobTypes) ? cfg.jobTypes : [];
    return arr.filter(t => JOB_TYPES.includes(t));
  } catch { return []; }
}

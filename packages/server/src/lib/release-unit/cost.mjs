/**
 * release-unit/cost.mjs — Cost 歸集引擎（R3）
 *
 * 回答管理問題：「這個 feature 一個月花多少 AI 成本？」
 *
 * 資料源（全部 deterministic，零 LLM）：
 *   1. data/logs/llm/YYYY-MM-DD.jsonl — 每次 LLM 呼叫的 usage（含 provider cost）
 *      → byDay / byModel / byAgent / totals
 *   2. {projectRoot}/.paaw/tasks/TASKS.json — task.tokenUsage / costUsd
 *      （EM 執行後由 coding-task-cost.mjs 寫回）
 *      → byTask → 經 fileScope ∩ FILE-FEATURES → byFeature
 *
 * Cost 計算優先序：provider 回傳 usage.cost > providers.json 定價估算 > 0
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getModelPricing, calcCostUsd } from "../ru-resolver.mjs";

// ── LLM logs ──

function _readLogDay(llmDir, dateStr) {
  const file = join(llmDir, `${dateStr}.jsonl`);
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf-8").split("\n").filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/** 判定 log day 是否在 days 天視窗內（含今天） */
function _dayInRange(dateStr, days, todayStr) {
  if (days <= 0) return true;
  const d = new Date(dateStr + "T00:00:00Z").getTime();
  const t = new Date(todayStr + "T00:00:00Z").getTime();
  return !Number.isNaN(d) && t - d < days * 86_400_000;
}

function _norm(p) { return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").trim(); }

/**
 * 聚合單日 LLM response entries → calls[]
 * 一個 call = { ts, model, agentId, caller, taskId, prompt, completion, total, costUsd, costSource }
 */
function _extractCalls(entries) {
  const calls = [];
  for (const e of entries) {
    if (e.phase !== "response" || !e.usage) continue;
    const u = e.usage;
    const prompt = u.prompt_tokens ?? u.prompt ?? 0;
    const completion = u.completion_tokens ?? u.completion ?? 0;
    const total = u.total_tokens ?? u.total ?? (prompt + completion);
    let costUsd = typeof u.cost === "number" ? u.cost : null;
    let costSource = "provider";
    if (costUsd === null) {
      const pricing = getModelPricing(e.model);
      if (pricing && (pricing.input || pricing.output)) {
        costUsd = calcCostUsd({ prompt, completion }, pricing);
        costSource = "estimated";
      } else {
        costUsd = 0;
        costSource = "unknown-pricing";
      }
    }
    calls.push({
      ts: e.ts, model: e.model || "?", agentId: e.agentId || null,
      caller: e.caller || null, taskId: e.taskId || null,
      prompt, completion, total, costUsd, costSource,
    });
  }
  return calls;
}

// ── Task / Feature 歸集 ──

function _readJsonSafe(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return fallback; }
}

/** 讀 {root}/.paaw/tasks/TASKS.json → task 陣列（相容 {tasks:[...]} 與 [...] 兩種形狀） */
function _loadCodingTasks(root) {
  const data = _readJsonSafe(join(root, ".paaw", "tasks", "TASKS.json"), null);
  if (!data) return [];
  return Array.isArray(data) ? data : (Array.isArray(data.tasks) ? data.tasks : []);
}

/** file → featureIds 索引（同 model.mjs 邏輯，獨立輕量版） */
function _buildFileFeatureIndex(root) {
  const idx = new Map();
  const ff = _readJsonSafe(join(root, ".paaw", "features", "FILE-FEATURES.json"), null);
  const add = (file, id) => {
    const f = _norm(file);
    if (!f || !id) return;
    if (!idx.has(f)) idx.set(f, new Set());
    idx.get(f).add(id);
  };
  if (ff?.files) {
    for (const [p, feats] of Object.entries(ff.files)) {
      for (const ft of (Array.isArray(feats) ? feats : [])) add(p, ft.id || ft.name);
    }
  }
  const features = _readJsonSafe(join(root, ".paaw", "features", "FEATURES.json"), null);
  const list = features ? (features.features || (Array.isArray(features) ? features : [])) : [];
  for (const feat of list) {
    for (const cf of (feat.codeFiles || feat.files || [])) add(cf, feat.id);
  }
  return idx;
}

/** task fileScope → featureIds（directory prefix 支援，同 review-boundary 語意） */
function _scopeToFeatures(fileScope, idx) {
  const ids = new Set();
  for (const raw of (Array.isArray(fileScope) ? fileScope : [])) {
    const scope = _norm(raw).replace(/\/+$/, "");
    if (!scope) continue;
    for (const [file, fids] of idx) {
      if (file === scope || file.startsWith(scope + "/")) {
        for (const id of fids) ids.add(id);
      }
    }
  }
  return [...ids];
}

// ── Main ──

/**
 * 建 Cost Report。
 * @param {string} paawRoot — PAAW root（llm logs 在 data/logs/llm）
 * @param {object} [opts] — { days=30, projectRoot=null }
 */
export function buildCostReport(paawRoot, opts = {}) {
  const days = opts.days ?? 30;
  const projectRoot = opts.projectRoot || null;

  // 1. LLM logs
  const llmDir = join(paawRoot, "data", "logs", "llm");
  const todayStr = new Date().toISOString().slice(0, 10);
  let logDays = [];
  try { logDays = readdirSync(llmDir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f => f.replace(".jsonl", "")); } catch {}
  logDays = logDays.filter(d => _dayInRange(d, days, todayStr)).sort();

  const calls = [];
  for (const d of logDays) calls.push(..._extractCalls(_readLogDay(llmDir, d)));

  const totals = {
    calls: calls.length,
    tokens: calls.reduce((s, c) => s + c.total, 0),
    promptTokens: calls.reduce((s, c) => s + c.prompt, 0),
    completionTokens: calls.reduce((s, c) => s + c.completion, 0),
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    estimatedShare: 0, // 估算占比（無 provider cost 的 calls）
    unknownCostCalls: calls.filter(c => c.costSource === "unknown-pricing").length, // 無法計價的 calls
  };
  const estCost = calls.filter(c => c.costSource === "estimated").reduce((s, c) => s + c.costUsd, 0);
  totals.estimatedShare = totals.costUsd > 0 ? estCost / totals.costUsd : 0;

  const _grp = (key) => {
    const m = new Map();
    for (const c of calls) {
      const k = key(c) || "(unknown)";
      const g = m.get(k) || { calls: 0, tokens: 0, costUsd: 0 };
      g.calls += 1; g.tokens += c.total; g.costUsd += c.costUsd;
      m.set(k, g);
    }
    return [...m.entries()].map(([k, g]) => ({ key: k, ...g, costUsd: round6(g.costUsd) }))
      .sort((a, b) => b.costUsd - a.costUsd);
  };
  const dayMap = new Map();
  for (const c of calls) {
    const k = String(c.ts || "").slice(0, 10) || "(unknown)";
    const g = dayMap.get(k) || { calls: 0, tokens: 0, costUsd: 0 };
    g.calls += 1; g.tokens += c.total; g.costUsd += c.costUsd;
    dayMap.set(k, g);
  }
  const byDayArr = [...dayMap.entries()].map(([k, g]) => ({ day: k, ...g, costUsd: round6(g.costUsd) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // 2. Task cost（寫回的 tokenUsage/costUsd）→ feature 歸屬
  let byTask = [];
  let byFeature = [];
  if (projectRoot) {
    const tasks = _loadCodingTasks(projectRoot);
    const idx = _buildFileFeatureIndex(projectRoot);
    const featNames = new Map();
    const featuresData = _readJsonSafe(join(projectRoot, ".paaw", "features", "FEATURES.json"), null);
    for (const f of (featuresData?.features || (Array.isArray(featuresData) ? featuresData : []) || [])) {
      featNames.set(f.id, f.name || f.title || f.id);
    }
    const taskRows = [];
    const featAgg = new Map(); // id → {tasks, tokens, costUsd}
    for (const t of tasks) {
      const u = t.tokenUsage;
      const cost = typeof t.costUsd === "number" ? t.costUsd
        : (u ? (calcCostUsd({ prompt: u.prompt || 0, completion: u.completion || 0 }, getModelPricing(t.model)) || 0) : 0);
      if (!u && !cost) continue;
      const fIds = _scopeToFeatures(t.spec?.fileScope, idx);
      taskRows.push({
        taskId: t.id, title: (t.title || t.spec?.title || "").slice(0, 80),
        model: t.model || null, featureIds: fIds,
        tokens: u?.total || 0, costUsd: round6(cost || 0),
        lastRunAt: t.costLog?.length ? t.costLog[t.costLog.length - 1].at : (t.updatedAt || null),
      });
      for (const id of fIds) {
        const g = featAgg.get(id) || { tasks: 0, tokens: 0, costUsd: 0 };
        g.tasks += 1; g.tokens += u?.total || 0; g.costUsd += cost || 0;
        featAgg.set(id, g);
      }
    }
    taskRows.sort((a, b) => b.costUsd - a.costUsd);
    byTask = taskRows;
    byFeature = [...featAgg.entries()].map(([id, g]) => ({
      featureId: id, name: featNames.get(id) || id, ...g, costUsd: round6(g.costUsd),
    })).sort((a, b) => b.costUsd - a.costUsd);
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    logDays: logDays.length,
    totals: {
      ...totals,
      costUsd: round6(totals.costUsd),
      tokens: totals.tokens,
    },
    byDay: byDayArr,
    byModel: _grp(c => c.model),
    byAgent: _grp(c => c.agentId || c.caller),
    byTask,
    byFeature,
  };
}

function round6(n) { return Math.round((n || 0) * 1e6) / 1e6; }

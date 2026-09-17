/**
 * QA Results — QA 記錄共享存儲（2026-09-17 Fleming）
 *
 * 需求：qa agent 留 QA 記錄，其他 agent 也可讀寫（developer 標 resolved、architect 拉證據）
 * 設計文件：OpenClaw workspace memory/qa-results-api-design.md
 *
 * 儲存：<RU>/.paaw/coding-memory/qa-results.jsonl（一行一筆；update = atomic rewrite + history 軌跡）
 * 上限：500 筆（超過剃最舊）
 *
 * 跨平台路徑紀律：不用 new URL(import.meta.url).pathname（TOOLS.md 鐵律）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";

const MAX_RECORDS = 500;
const VERDICTS = new Set(["pass", "fail", "warn", "blocked"]);
const STATUSES = new Set(["open", "resolved", "wontfix"]);
const TYPES = new Set(["browser", "smoke", "api", "review", "e2e", "manual"]);
const SEVERITIES = new Set(["critical", "major", "minor"]);
const ISSUE_STATUSES = new Set(["open", "resolved", "wontfix"]);

function qaFile(cwd) {
  if (!cwd || typeof cwd !== "string") throw new Error("cwd required");
  const dir = join(cwd, ".paaw", "coding-memory");
  return { dir, file: join(dir, "qa-results.jsonl") };
}

/** 讀全部 records（舊→新；壞行跳過） */
function _readAll(cwd) {
  const { file } = qaFile(cwd);
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 壞行跳過 */ }
  }
  return out;
}

/** atomic rewrite（tmp + rename — 同目錄 rename 原子）*/
function _writeAll(cwd, records) {
  const { dir, file } = qaFile(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const trimmed = records.length > MAX_RECORDS ? records.slice(records.length - MAX_RECORDS) : records;
  const tmp = join(dir, `.qa-results-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, trimmed.map(r => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  renameSync(tmp, file);
}

function _id() {
  const now = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `qr-${stamp}-${rand}`;
}

/** normalize issues（LLM 給的形狀不可信 — severity/desc 缺就補、多餘欄位丟掉） */
function _normIssues(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(x => x && typeof x === "object")
    .map(x => ({
      severity: SEVERITIES.has(x.severity) ? x.severity : "minor",
      desc: String(x.desc || x.description || "").slice(0, 500),
      status: ISSUE_STATUSES.has(x.status) ? x.status : "open",
      evidence: x.evidence ? String(x.evidence).slice(0, 300) : null,
      resolvedBy: x.resolvedBy ? String(x.resolvedBy).slice(0, 40) : null,
      resolvedAt: x.resolvedAt || null,
    }))
    .filter(x => x.desc);
}

/** normalize evidence → string[] */
function _normEvidence(v) {
  if (typeof v === "string") return [v].filter(Boolean);
  if (Array.isArray(v)) return v.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 10);
  return [];
}

/** verdict → 預設 record status（pass/warn/block 且無 open issue → resolved，fail → open） */
function _defaultStatus(verdict, issues) {
  if (issues.some(i => i.status === "open")) return "open";
  if (verdict === "fail") return "open";
  return "resolved";
}

/**
 * 建立 QA 記錄
 * @param {string} cwd - RU root
 * @param {Object} rec - {actor,type,target,url,taskId,feature,verdict,summary,issues,evidence,durationMs}
 */
export function saveQaResult(cwd, rec = {}) {
  const verdict = VERDICTS.has(rec.verdict) ? rec.verdict : "warn";
  const type = TYPES.has(rec.type) ? rec.type : "manual";
  const issues = _normIssues(rec.issues);
  const now = new Date().toISOString();
  const record = {
    id: _id(),
    ts: now,
    updatedAt: null,
    actor: String(rec.actor || "human").slice(0, 40),
    type,
    target: String(rec.target || "").slice(0, 200),
    url: rec.url ? String(rec.url).slice(0, 300) : null,
    taskId: rec.taskId ? String(rec.taskId).slice(0, 60) : null,
    feature: rec.feature ? String(rec.feature).slice(0, 120) : null,
    verdict,
    summary: String(rec.summary || "").slice(0, 2000),
    issues,
    evidence: _normEvidence(rec.evidence),
    durationMs: Number.isFinite(Number(rec.durationMs)) ? Math.round(Number(rec.durationMs)) : null,
    status: STATUSES.has(rec.status) ? rec.status : _defaultStatus(verdict, issues),
    history: [],
  };
  if (!record.target && !record.summary) throw new Error("target or summary required");
  const all = _readAll(cwd);
  all.push(record);
  _writeAll(cwd, all);
  return record;
}

/**
 * 列表（新→舊）
 * @param {Object} opts - {verdict,status,actor,type,taskId,feature,q,limit,id}
 */
export function listQaResults(cwd, opts = {}) {
  let list = _readAll(cwd).reverse(); // 新→舊
  if (opts.id) return list.filter(r => r.id === opts.id);
  if (opts.verdict) list = list.filter(r => r.verdict === opts.verdict);
  if (opts.status) list = list.filter(r => r.status === opts.status);
  if (opts.actor) list = list.filter(r => r.actor === opts.actor);
  if (opts.type) list = list.filter(r => r.type === opts.type);
  if (opts.taskId) list = list.filter(r => r.taskId === opts.taskId);
  if (opts.feature) list = list.filter(r => r.feature === opts.feature);
  if (opts.q) {
    const needle = String(opts.q).toLowerCase();
    list = list.filter(r =>
      (r.target || "").toLowerCase().includes(needle) ||
      (r.summary || "").toLowerCase().includes(needle) ||
      (r.issues || []).some(i => (i.desc || "").toLowerCase().includes(needle))
    );
  }
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 500);
  return list.slice(0, limit);
}

export function getQaResult(cwd, id) {
  if (!id || typeof id !== "string") return null;
  return _readAll(cwd).find(r => r.id === id) || null;
}

/**
 * 更新：status / issue 狀態 / 追加 note（全部進 history 軌跡）
 * @param {Object} patch - {status, issueIndex|issueDesc, issueStatus, note, summary, evidence(add)}
 * @param {string} by - 誰改的（agentId / human）
 */
export function updateQaResult(cwd, id, patch = {}, by = "human") {
  const all = _readAll(cwd);
  const idx = all.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const rec = all[idx];
  const from = rec.status;
  const now = new Date().toISOString();
  const events = [];

  // 1) issue 狀態（用 index 或 desc 模糊找）
  if (patch.issueStatus && (patch.issueIndex !== undefined || patch.issueDesc)) {
    let i = Number.isInteger(patch.issueIndex) ? patch.issueIndex
      : (rec.issues || []).findIndex(x => (x.desc || "").includes(String(patch.issueDesc)));
    if (i >= 0 && i < (rec.issues || []).length && ISSUE_STATUSES.has(patch.issueStatus)) {
      rec.issues[i].status = patch.issueStatus;
      if (patch.issueStatus === "resolved") {
        rec.issues[i].resolvedBy = by;
        rec.issues[i].resolvedAt = now;
      } else {
        rec.issues[i].resolvedBy = null;
        rec.issues[i].resolvedAt = null;
      }
      events.push(`${rec.issues[i].desc.slice(0, 60)} → ${patch.issueStatus}`);
    }
  }

  // 2) record status（沒明確給 → 全 resolved 時自動帶）
  if (STATUSES.has(patch.status)) rec.status = patch.status;
  else if ((rec.issues || []).length > 0 && rec.issues.every(x => x.status === "resolved" || x.status === "wontfix")) {
    rec.status = "resolved";
  }

  // 3) 補充 evidence / summary
  if (patch.addEvidence) {
    rec.evidence = [...(rec.evidence || []), ..._normEvidence(patch.addEvidence)].slice(0, 20);
  }
  if (patch.summary) rec.summary = String(patch.summary).slice(0, 2000);

  if (from !== rec.status || events.length > 0 || patch.note) {
    rec.history = [...(rec.history || []), {
      ts: now,
      by: String(by).slice(0, 40),
      from,
      to: rec.status,
      note: patch.note ? String(patch.note).slice(0, 500) : events.join("; ") || null,
    }];
    rec.updatedAt = now;
  }
  all[idx] = rec;
  _writeAll(cwd, all);
  return rec;
}

export function deleteQaResult(cwd, id) {
  const all = _readAll(cwd);
  const next = all.filter(r => r.id !== id);
  if (next.length === all.length) return false;
  _writeAll(cwd, next);
  return true;
}

/** 統計（report 用）：{total, open, failOpen, byVerdict, lastTs} */
export function qaStats(cwd) {
  const list = _readAll(cwd);
  const byVerdict = {};
  for (const r of list) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  return {
    total: list.length,
    open: list.filter(r => r.status === "open").length,
    failOpen: list.filter(r => r.verdict === "fail" && r.status === "open").length,
    byVerdict,
    lastTs: list.length ? list[list.length - 1].ts : null,
  };
}

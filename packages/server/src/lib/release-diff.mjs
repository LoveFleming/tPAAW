/**
 * release-diff.mjs — 📊 與前一版的差異摘要（2026-11-22 Fleming）
 *
 * 當有前一版的 release snapshot（另一個 RR 的 info + matrix）時：
 *   1. 決定性收集差異證據（數字 delta、API 新增/移除、git diff 統計、兩版 changes）— 零 token
 *   2. AI 拿證據做表格條列摘要（失敗 fallback 決定性數字表，標 aiFallback）
 * 產出：.paaw/release-info/{RR-ID}/diff-v{N}.json（跟 info 同版號）
 * 第一版（找不到前版）→ skipped，UI 不顯示區塊。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { listInfoVersions, readInfoVersion, readInfoMatrix } from "./release-info-builder.mjs";

function _infoDir(projectPath, rrId) {
  return join(projectPath, ".paaw", "release-info", rrId);
}

/** 找前一版：其他 RR 裡有 info 快照、release_date 最新的一個（自己不算） */
export function findPreviousRelease(projectPath, currentRrId) {
  let best = null;
  let rrIds = [];
  try { rrIds = readdirSync(join(projectPath, ".paaw", "release-info")); } catch { return null; }
  for (const rrId of rrIds) {
    if (rrId === currentRrId) continue;
    const vs = listInfoVersions(projectPath, rrId);
    if (!vs.length) continue;
    const v = Math.max(...vs);
    const info = readInfoVersion(projectPath, rrId, v);
    if (!info) continue;
    const ms = new Date(info.release_date || info.generatedAt || 0).getTime() || 0;
    if (!best || ms > best.ms) best = { rrId, version: v, info, ms };
  }
  return best;
}

/** 決定性差異證據（零 token） */
function _collectEvidence(projectPath, rrId, curInfo, curV) {
  const ev = { current: { rr: rrId, version: curInfo.version, date: curInfo.release_date }, rows: [], newApis: [], removedApis: [], curChanges: [], prevChanges: [], gitStat: null };
  const prev = findPreviousRelease(projectPath, rrId);
  if (!prev) return { skipped: "first" };
  ev.previous = { rr: prev.rrId, version: prev.info.version, date: prev.info.release_date };

  // 數字 delta（Evidence Matrix 摘要）
  const curM = readInfoMatrix(projectPath, rrId, curV);
  const prevM = readInfoMatrix(projectPath, prev.rrId, prev.version);
  if (curM?.summary && prevM?.summary) {
    const a = prevM.summary, b = curM.summary;
    const num = (x, y) => `${x}→${y}${y === x ? "" : y > x ? " ↑" : " ↓"}`;
    ev.rows.push(
      { area: "API（有變更的）", diff: num(a.changedApis ?? "?", b.changedApis ?? "?") },
      { area: "有 unit test 的 API", diff: num(a.withTests ?? "?", b.withTests ?? "?") },
      { area: "E2E 覆蓋 API", diff: num(a.e2eCovered ?? "?", b.e2eCovered ?? "?") },
      { area: "SG high findings", diff: num(a.sgHigh ?? "?", b.sgHigh ?? "?") },
      { area: "Code Review", diff: num(a.withReview ?? "?", b.withReview ?? "?") },
      { area: "QA 記錄", diff: num(a.withQa ?? "?", b.withQa ?? "?") },
    );
    const cp = a.coverage?.linePct, bp = b.coverage?.linePct;
    if (bp != null || cp != null) ev.rows.push({ area: "行覆蓋率", diff: `${cp ?? "—"}% → ${bp ?? "—"}%` });
    if (b.testRun || a.testRun) ev.rows.push({ area: "實跑測試", diff: `${a.testRun ? `${a.testRun.passed ?? "?"}✓/${a.testRun.failed ?? "?"}✗` : "—"} → ${b.testRun ? `${b.testRun.passed ?? "?"}✓/${b.testRun.failed ?? "?"}✗` : "—"}` });
    // API 新增/移除（entry 集合比對）
    if (Array.isArray(curM.apis) && Array.isArray(prevM.apis)) {
      const key = (x) => `${String(x.entry || "").toLowerCase()}|${String(x.name || "")}`;
      const prevSet = new Set(prevM.apis.map(key));
      const curSet = new Set(curM.apis.map(key));
      ev.newApis = curM.apis.filter((x) => !prevSet.has(key(x))).map((x) => `${x.entry} ${x.name || ""}`.trim());
      ev.removedApis = prevM.apis.filter((x) => !curSet.has(key(x))).map((x) => `${x.entry} ${x.name || ""}`.trim());
    }
  }
  ev.curChanges = Array.isArray(curInfo.changes) ? curInfo.changes.slice(0, 30) : [];
  ev.prevChanges = Array.isArray(prev.info.changes) ? prev.info.changes.slice(0, 30) : [];

  // git diff 統計（兩版 commit 之間）
  const c0 = prev.info.git?.commit, c1 = curInfo.git?.commit;
  if (c0 && c1) {
    try {
      // 同步不可行 — 由呼叫端（async）跑；這裡先記目標
      ev.gitRange = `${c0}..${c1}`;
    } catch {}
  }
  return ev;
}

async function _gitStat(projectPath, range) {
  try {
    const { shellExec } = await import("./shell-exec.mjs");
    const out = (await shellExec(`git diff --stat ${range} | tail -1`, { cwd: projectPath, timeout: 20000 })).stdout.trim();
    return out || null;
  } catch { return null; }
}

const _stripFence = (s) => { let o = String(s || "").trim(); if (o.startsWith("```")) o = o.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, ""); return o.trim(); };

/** AI 摘要：拿決定性證據產 {summary, rows:[{area, diff}]}（2 次嘗試） */
async function _aiSummary(projectPath, ev) {
  const { callProjectLLM, CU_LLM_OPTS } = await import("../routes/coding-helpers.mjs");
  const prompt = `你是 Release Manager。根據以下「前一版 vs 本版」的決定性差異證據，產生差異摘要。

規則：
- 只描述證據支援的事實，不可編造
- 每個 diff 要講「實質意義」（例如 API 增加 = 新能力、SG high 下降 = 安全債改善），不要只貼數字
- 繁體中文

只輸出一個 JSON 物件（不要 code fence、不要其他文字）：
{"summary": "<一兩句話的整體差異摘要>", "rows": [{"area": "<面向，例如 本版變更重點/API 變動/測試與證據/安全/其他>", "diff": "<這個面向的差異說明（條列式，用；分隔或換行）>"}]}
rows 最多 6 行，每行 diff ≤ 200 字。

【證據】
前一版：${ev.previous.rr} v${ev.previous.version}（${ev.previous.date || "?"}）
本版：${ev.current.rr} v${ev.current.version}（${ev.current.date || "?"}）
git diff 統計：${ev.gitStat || ev.gitRange || "（無）"}

Evidence Matrix 數字對照（前→後）：
${(ev.rows || []).map((r) => `- ${r.area}：${r.diff}`).join("\n") || "（無 matrix 資料）"}

新增 API：${ev.newApis.length ? ev.newApis.join("、") : "無"}
移除 API：${ev.removedApis.length ? ev.removedApis.join("、") : "無"}

前一版 changes：
${ev.prevChanges.map((c) => `- [${c.type}] ${c.title}`).join("\n") || "（無）"}

本版 changes：
${ev.curChanges.map((c) => `- [${c.type}] ${c.title}：${String(c.description || "").slice(0, 100)}`).join("\n") || "（無）"}`;

  for (let i = 0; i < 2; i++) {
    try {
      const r = await callProjectLLM({ messages: [{ role: "user", content: i === 0 ? prompt : prompt + "\n\n⚠️ 上次回應無法解析，這次只輸出合法 JSON。" }], temperature: 0, thinking: { type: "disabled" } }, { ...CU_LLM_OPTS, timeoutMs: 300_000 });
      const cleaned = _stripFence(r.content || "");
      const m = cleaned.match(/\{[\s\S]*\}/);
      const p = JSON.parse(m ? m[0] : cleaned);
      if (p && typeof p.summary === "string" && Array.isArray(p.rows)) return { summary: p.summary, rows: p.rows.slice(0, 6) };
    } catch (e) { console.warn(`[release-diff] AI 嘗試 ${i + 1} 失敗:`, e.message); }
  }
  return null;
}

/** 主流程：產出差異摘要（寫 diff-v{N}.json）。第一版回 { skipped: true } */
export async function buildDiffSummary(projectPath, rrId) {
  const vs = listInfoVersions(projectPath, rrId);
  if (!vs.length) return { skipped: true, reason: "尚無 Release Info" };
  const v = Math.max(...vs);
  const curInfo = readInfoVersion(projectPath, rrId, v);
  if (!curInfo) return { skipped: true, reason: "Release Info 讀取失敗" };

  const ev = _collectEvidence(projectPath, rrId, curInfo, v);
  if (ev.skipped) return { skipped: true, reason: "第一版，沒有前一版 release 可比" };
  if (ev.gitRange) ev.gitStat = await _gitStat(projectPath, ev.gitRange);

  const ai = await _aiSummary(projectPath, ev);
  const out = {
    version: v,
    generatedAt: new Date().toISOString(),
    previous: ev.previous,
    current: ev.current,
    gitStat: ev.gitStat || null,
    summary: ai?.summary || `${ev.previous.rr} v${ev.previous.version} → 本版：矩陣數字 ${ev.rows.map((r) => `${r.area} ${r.diff}`).join("；")}`,
    rows: ai?.rows || ev.rows,
    newApis: ev.newApis,
    removedApis: ev.removedApis,
    aiFallback: !ai,
  };
  writeFileSync(join(_infoDir(projectPath, rrId), `diff-v${v}.json`), JSON.stringify(out, null, 2), "utf-8");
  return out;
}

/** 讀最新 diff（UI 顯示用）；無 → null */
export function readDiffSummary(projectPath, rrId) {
  try {
    const vs = listInfoVersions(projectPath, rrId);
    if (!vs.length) return null;
    return JSON.parse(readFileSync(join(_infoDir(projectPath, rrId), `diff-v${Math.max(...vs)}.json`), "utf-8"));
  } catch { return null; }
}

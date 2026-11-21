/**
 * release-info-builder.mjs — Release Information 自動產生器（2026-11-21 Fleming）
 *
 * 情境：匯入人家寫好的 release unit → CU → Release Manager 第一次 release。
 * 建 Release Request 後 AI 自動開工，把這一版的 release information 做好：
 *
 *   1. 實體證據：真實執行 unit + e2e 測試（startTestRun，RUN-*.json 落檔）
 *   2. 證據快照：Evidence Snapshot 凍結（generateEvidenceSnapshot）
 *   3. AI 撰寫：release information markdown — 有版本概念（info-v1.md, v2… 不覆蓋）
 *
 * 儲存位置：.paaw/release-info/{RR-ID}/
 *   - status.json  — build 進度（UI 輪詢用）
 *   - info-v{N}.md — AI 產出的 release information（版本遞增）
 *   - bundle-v{N}.json — 該版對應的證據（test run id / evidence snapshot id / scope 摘要）
 *
 * 原則：No answer without evidence — AI 只拿到程式產生的 deterministic 數據做摘要。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { startTestRun, getRunState, readLastTestRun } from "./test-runner.mjs";
import { generateEvidenceSnapshot } from "./release-evidence-snapshot.mjs";
import { getReleaseRequest, listReleaseRequests } from "./release-requests.mjs";
import { callProjectLLM } from "../routes/coding-helpers.mjs";
import { shellExec } from "./shell-exec.mjs";

const _building = new Set(); // `${projectPath}::${rrId}` 防重入

function infoDir(projectPath, rrId) {
  return join(projectPath, ".paaw", "release-info", rrId);
}

function readStatus(projectPath, rrId) {
  try { return JSON.parse(readFileSync(join(infoDir(projectPath, rrId), "status.json"), "utf-8")); } catch { return null; }
}

function writeStatus(projectPath, rrId, st) {
  mkdirSync(infoDir(projectPath, rrId), { recursive: true });
  writeFileSync(join(infoDir(projectPath, rrId), "status.json"), JSON.stringify(st, null, 2), "utf-8");
}

/** 列出該 RR 的 info 版本（v1..vN） */
export function listInfoVersions(projectPath, rrId) {
  try {
    return readdirSync(infoDir(projectPath, rrId))
      .map(f => /^info-v(\d+)\.md$/.exec(f))
      .filter(Boolean)
      .map(m => parseInt(m[1], 10))
      .sort((a, b) => a - b);
  } catch { return []; }
}

export function readInfoVersion(projectPath, rrId, v) {
  try { return readFileSync(join(infoDir(projectPath, rrId), `info-v${v}.md`), "utf-8"); } catch { return null; }
}

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

/** 等背景 test run 跑完（startTestRun 是 fire-and-forget） */
async function _waitForTestRun(projectPath, timeoutMs = 15 * 60_000) {
  const started = Date.now();
  // 等它出現（啟動非同步）
  for (let i = 0; i < 20 && !getRunState(projectPath); i++) await sleep(500);
  while (getRunState(projectPath)) {
    if (Date.now() - started > timeoutMs) return null; // 超時不放死 — 拿最後結果（可能是舊的）
    await sleep(3000);
  }
  return readLastTestRun(projectPath);
}

function _fmtTestRun(run) {
  if (!run) return "（沒有 test run 紀錄 — 專案可能沒有可偵測的測試）";
  const s = run.summary || {};
  const kinds = Object.entries(run.byKind || {}).map(([k, v]) => `${k}: ${v.passed}P/${v.failed}F/${v.skipped}S`).join(", ") || "—";
  return [
    `- Test Run: ${run.id}（${run.status}，${Math.round((run.durationMs || 0) / 1000)}s，HEAD ${String(run.headSha || "").slice(0, 8)}）`,
    `- 總計: ${s.passed ?? "?"} passed / ${s.failed ?? "?"} failed / ${s.skipped ?? "?"} skipped`,
    `- 分類: ${kinds}`,
  ].join("\n");
}

/**
 * 啟動 build（背景 job，不 await 結果）— 回傳起始狀態。
 * 已在跑 → 回 running；RR 不存在 → throw 404。
 */
export async function startReleaseInfoBuild(projectPath, rrId, { by = "human", includeE2e = true } = {}) {
  const rr = await getReleaseRequest(projectPath, rrId);
  if (!rr) { const e = new Error(`release request not found: ${rrId}`); e.status = 404; throw e; }
  const key = `${projectPath}::${rrId}`;
  if (_building.has(key)) return { alreadyRunning: true, status: readStatus(projectPath, rrId) };
  _building.add(key);

  const st = {
    rrId,
    running: true,
    step: "tests",
    steps: ["tests", "evidence", "ai-write"],
    startedAt: new Date().toISOString(),
    startedBy: by,
    error: null,
    lastVersion: null,
  };
  writeStatus(projectPath, rrId, st);

  (async () => {
    try {
      // ── 1. 實體證據：真跑 unit + e2e ──
      const preRun = readLastTestRun(projectPath);
      await startTestRun(projectPath, { includeE2e });
      const run = await _waitForTestRun(projectPath);
      // 跑完但結果時間戳比啟動早 = 沒有可跑測試（noRunner）→ 誠實記錄
      const testRun = (run && run !== preRun) ? run : (run || null);
      st.testRun = testRun ? { id: testRun.id, status: testRun.status, summary: testRun.summary, at: testRun.finishedAt } : null;
      st.step = "evidence";
      writeStatus(projectPath, rrId, st);

      // ── 2. 證據快照凍結 ──
      let snap = null;
      try { snap = await generateEvidenceSnapshot(projectPath, { baseline: rr.baseline?.sha || "auto", by: `release-info:${rrId}` }); } catch (e) { st.evidenceError = e.message; }
      st.evidenceSnapshot = snap ? { id: snap.id, at: snap.generatedAt || snap.at } : null;
      st.step = "ai-write";
      writeStatus(projectPath, rrId, st);

      // ── 3. AI 撰寫 release information（版本遞增）──
      const gitLog = await shellExec(`git log --oneline ${rr.baseline?.sha || ""}..HEAD`, { cwd: projectPath, timeout: 10000 })
        .then(r => r.stdout.trim()).catch(() => "(git log 不可用)");
      const freshRR = await getReleaseRequest(projectPath, rrId);
      const scope = freshRR?.scope || rr.scope || {};
      const scopeTxt = [
        `commits: ${scope.commits?.count ?? "?"}`,
        `變更檔案: ${(scope.files || []).length}`,
        `features: ${(scope.features || scope.changedFeatures || []).map(f => f.id || f.name).slice(0, 20).join(", ") || "—"}`,
        `tasks: ${(scope.taskIds || []).length}`,
      ].join("\n");

      const prompt = `你是 Release Manager。根據以下「程式產生的 deterministic 證據」寫一份 release information（繁體中文）。
只描述證據支援的事實，不可以編造 — 沒有的就誠實寫「無資料」。

# Release Request
- ${freshRR?.title || rr.title}（${rrId}）
- baseline: ${rr.baseline?.short || "?"}（${rr.baseline?.source || "?"}）→ target: ${freshRR?.target?.short || rr.target?.short || "HEAD"}

# 變更範圍
${scopeTxt}

# Git Log（baseline..HEAD）
${gitLog}

# 測試實跑結果（unit + e2e）
${_fmtTestRun(testRun)}

# Evidence Snapshot
${snap ? `${snap.id} — 詳見 .paaw/release/evidence/` : "（快照生成失敗）"}

# 輸出格式（markdown，直接輸出本文，不要 code fence）
## Release Information — ${rrId}
### 這一版包含什麼
### 測試證據（實跑數字）
### 風險與注意事項
### 上線前檢查`;

      const r = await callProjectLLM({ messages: [{ role: "user", content: prompt }] }, { caller: "release-info", timeoutMs: 180_000, maxRetries: 2 });
      let md = String(r?.content || "").trim();
      if (!md) throw new Error("AI 回應為空");
      if (md.startsWith("```")) md = md.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");

      const versions = listInfoVersions(projectPath, rrId);
      const v = (versions.length ? Math.max(...versions) : 0) + 1;
      const dir = infoDir(projectPath, rrId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `info-v${v}.md`), md, "utf-8");
      writeFileSync(join(dir, `bundle-v${v}.json`), JSON.stringify({
        version: v,
        generatedAt: new Date().toISOString(),
        testRun: st.testRun,
        evidenceSnapshot: st.evidenceSnapshot,
        baseline: rr.baseline,
        target: freshRR?.target || rr.target,
      }, null, 2), "utf-8");
      st.lastVersion = v;
      st.running = false;
      st.step = "done";
      st.finishedAt = new Date().toISOString();
      writeStatus(projectPath, rrId, st);
    } catch (e) {
      st.running = false;
      st.step = "error";
      st.error = e.message;
      st.finishedAt = new Date().toISOString();
      writeStatus(projectPath, rrId, st);
    } finally {
      _building.delete(key);
    }
  })();

  return { started: true, status: st };
}

/** UI 進場卡：最新 RR + 最新版 info + 最新 shipped release */
export async function getLatestReleaseInfo(projectPath) {
  const rrs = await listReleaseRequests(projectPath); // 依 createdAt 降序
  const shipped = rrs.find(r => r.status === "released") || null;
  const latestRR = rrs[0] || null;
  const out = { latestRR: null, shipped };
  if (!latestRR) return out;
  const versions = listInfoVersions(projectPath, latestRR.id);
  const status = readStatus(projectPath, latestRR.id);
  out.latestRR = {
    id: latestRR.id, title: latestRR.title, status: latestRR.status,
    baseline: latestRR.baseline, target: latestRR.target,
    infoVersions: versions,
    latestInfoVersion: versions.length ? Math.max(...versions) : null,
    latestInfoContent: versions.length ? readInfoVersion(projectPath, latestRR.id, Math.max(...versions)) : null,
    buildStatus: status,
  };
  return out;
}

export function getBuildStatus(projectPath, rrId) {
  const st = readStatus(projectPath, rrId);
  return { running: _building.has(`${projectPath}::${rrId}`), status: st, versions: listInfoVersions(projectPath, rrId) };
}

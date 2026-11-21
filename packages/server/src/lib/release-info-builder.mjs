/**
 * release-info-builder.mjs — Release Info 自動產生器（PAAW Release Info Schema v1.0）
 *
 * 情境：匯入別人寫好的 release unit → CU → Release Manager 第一次 release。
 * 建 Release Request 後 AI 自動開工，把這一版的 Release Info 做好：
 *
 *   1. 實體證據：真實執行 unit + e2e 測試（startTestRun，RUN-*.json 落檔）
 *   2. 證據快照：Evidence Snapshot 凍結（generateEvidenceSnapshot）
 *   3. Release Info（Schema v1.0）：AI 只產 summary + changes；
 *      version / release_date / git 全部由系統決定（deterministic，AI 不猜測）
 *
 * Schema v1.0（2026-11-21 Fleming 定案 — 5 頂層欄位，不加 workflow/approval/deployment/metrics）：
 * {
 *   "version": "1.2.0",            // 系統決定：HEAD tag || previous tag patch+1 || release 序號制
 *   "release_date": "2026-11-21",  // 系統記錄實際產生日期（ISO 8601）
 *   "summary": "...",              // AI 產生的版本摘要
 *   "changes": [                   // AI 從 git diff 分類產生
 *     { "type": "feature|improvement|fix|breaking|chore", "title": "...", "description": "..." }
 *   ],
 *   "git": {                       // 系統由 Git 取得，不由 AI 猜測
 *     "commit": "a1b2c3d",         // HEAD SHA
 *     "previous_tag": "v1.1.0",    // 前一版 tag（無 tag 專案 = null）
 *     "tag": "v1.2.0"              // 本次 tag（HEAD 沒 tag = null）
 *   }
 * }
 *
 * 儲存位置：.paaw/release-info/{RR-ID}/
 *   - status.json        — build 進度（UI 輪詢用）
 *   - info-v{N}.json     — Release Info Schema v1.0（版本遞增不覆蓋：AI 修訂 = v2）
 *   - bundle-v{N}.json   — 該版對應證據（test run id / evidence snapshot id / scope 摘要）
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

const SCHEMA_VERSION = "1.0";
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
      .map(f => /^info-v(\d+)\.json$/.exec(f))
      .filter(Boolean)
      .map(m => parseInt(m[1], 10))
      .sort((a, b) => a - b);
  } catch { return []; }
}

export function readInfoVersion(projectPath, rrId, v) {
  try { return JSON.parse(readFileSync(join(infoDir(projectPath, rrId), `info-v${v}.json`), "utf-8")); } catch { return null; }
}

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

/** 等背景 test run 跑完（startTestRun 是 fire-and-forget） */
async function _waitForTestRun(projectPath, timeoutMs = 15 * 60_000) {
  const started = Date.now();
  for (let i = 0; i < 20 && !getRunState(projectPath); i++) await sleep(500);
  while (getRunState(projectPath)) {
    if (Date.now() - started > timeoutMs) return null;
    await sleep(3000);
  }
  return readLastTestRun(projectPath);
}

// ── Deterministic：git 欄位 + version（系統決定，AI 不碰）──

async function _gitOne(projectPath, cmd) {
  try { return (await shellExec(cmd, { cwd: projectPath, timeout: 8000 })).stdout.trim() || null; } catch { return null; }
}

function _bumpPatch(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag || ""));
  if (!m) return null;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** git 三欄 + version — 全部由 git/history 推導（不用 shell operator — 公司 Windows cmd.exe 相容）*/
async function _deterministicGitBlock(projectPath) {
  const commit = await _gitOne(projectPath, "git rev-parse HEAD");
  const headTag = await _gitOne(projectPath, "git tag --points-at HEAD");
  // 全部 tag 依時間新→舊，拿回來在 JS 算 previous_tag（跨平台）
  const tagList = ((await _gitOne(projectPath, "git tag --sort=-creatordate")) || "").split("\n").map(s => s.trim()).filter(Boolean);
  const tag = headTag ? headTag.split("\n")[0].trim() : null;
  const previousTag = tag
    ? (tagList.find(t => t !== tag) || null) // HEAD 有 tag → 前一個不同的 tag
    : (tagList[0] || null);                    // 沒 tag → 最近的 tag
  // version：HEAD tag 優先 → previous tag patch+1 → 無 tag 專案用 release 序號制（N+1.0.0，N = 已 release 次數）
  let version = tag || _bumpPatch(previousTag);
  if (!version) {
    let shipped = 0;
    try { shipped = readdirSync(join(projectPath, ".paaw", "releases")).filter(f => /^REL-.*\.json$/.test(f)).length; } catch {}
    version = `${shipped + 1}.0.0`;
  }
  return {
    git: {
      commit: commit ? commit.slice(0, 8) : null,
      previous_tag: previousTag || null,
      tag: tag || null,
    },
    version: String(version).replace(/^v/, ""),
  };
}

// ── AI：只產 summary + changes ──

function _stripFence(s) {
  let out = String(s || "").trim();
  if (out.startsWith("```")) out = out.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
  return out.trim();
}

/** AI 失敗/解析失敗時的 deterministic fallback：changes 直接由 git log subjects 組成（type=chore） */
function _fallbackChanges(gitLog) {
  return gitLog.split("\n").filter(Boolean).slice(0, 30).map(line => {
    const m = /^([0-9a-f]+) (.+)$/.exec(line);
    return { type: "chore", title: (m ? m[2] : line).slice(0, 80), description: m ? `commit ${m[1]}` : "" };
  });
}

async function _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle }) {
  const prompt = `你是 Release Manager。根據以下 deterministic 證據（git log 為主），產生 Release Info 的 summary 與 changes。

【輸出格式 — 嚴格遵守，每次一致】
只輸出一個 JSON 物件，不要 code fence、不要 markdown、不要說明文字。結構必須完全是：
{"summary": "<一兩句話摘要>", "changes": [{"type": "<type>", "title": "<標題>", "description": "<說明>"}]}
- summary：字串，一兩句話的版本摘要（繁體中文）
- changes：陣列，把 git log 的 commits 歸納成變更項目（相近 commits 合併一項）
- 若 git log 為空（首次 release 無差異）：changes 必須是空陣列 []，summary 說明本版無程式碼變更
- 每個 change 必須恰好三個 key：type / title / description，不可多不可少
- type 只能是這五個之一：feature | improvement | fix | breaking | chore
- title：短標題（兰 80 字）；description：具體說明（兰 300 字）
- 只描述證據支援的事實，不可編造

# Release：${rrTitle}
# 變更範圍
${scopeTxt}
# Git Log
${gitLog}
# 測試實跑（輔助判斷 fix/improvement）
${testRunTxt}`;
  const r = await callProjectLLM({ messages: [{ role: "user", content: prompt }] }, { caller: "release-info", timeoutMs: 180_000, maxRetries: 2 });
  const raw = _stripFence(r?.content);
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error("AI 回應不是 JSON");
  const parsed = JSON.parse(m[0]);
  return _validateAiPart(parsed, { hasCommits: gitLog.split("\n").filter(Boolean).length > 0 }); // 不符 schema 直接 throw → 上層重試/fallback
}

/** 嚴格驗證 AI 產的 summary/changes（Schema v1.0）— 格式每次一致，不合規就拒收 */
const VALID_TYPES = new Set(["feature", "improvement", "fix", "breaking", "chore"]);
function _validateAiPart(parsed, { hasCommits = true } = {}) {
  if (!parsed || typeof parsed !== "object") throw new Error("AI 輸出不是物件");
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("summary 缺失或非字串");
  if (!Array.isArray(parsed.changes)) throw new Error("changes 缺失或非陣列");
  // 2026-11-21 fix：0 commits 的 RR（baseline=HEAD）AI 誠實回空陣列是「正確」— 只有真的有 commits 但 AI 回空才算失敗
  if (hasCommits && parsed.changes.length === 0) throw new Error("有 commits 但 changes 是空的");
  const changes = [];
  for (const c of parsed.changes) {
    if (!c || typeof c !== "object") throw new Error("change 不是物件");
    const title = typeof c.title === "string" ? c.title.trim() : "";
    const description = typeof c.description === "string" ? c.description.trim() : "";
    if (!title) throw new Error("change.title 缺失");
    changes.push({
      type: VALID_TYPES.has(c.type) ? c.type : "chore", // type 不在五類 → 降 chore（不拒收整份，但記得可預期）
      title: title.slice(0, 120),
      description: description.slice(0, 500),
    });
  }
  return { summary: summary.slice(0, 600), changes };
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

      // ── 3. Release Info（Schema v1.0）──
      const freshRR = await getReleaseRequest(projectPath, rrId);
      const scope = freshRR?.scope || rr.scope || {};
      const scopeTxt = [
        `commits: ${scope.commits?.count ?? "?"}`,
        `變更檔案: ${(scope.files || []).length}`,
        `features: ${(scope.features || scope.changedFeatures || []).map(f => f.id || f.name).slice(0, 20).join(", ") || "—"}`,
        `tasks: ${(scope.taskIds || []).length}`,
      ].join("\n");
      const gitLog = await shellExec(`git log --oneline ${rr.baseline?.sha || ""}..HEAD`, { cwd: projectPath, timeout: 10000 })
        .then(r => r.stdout.trim()).catch(() => "");
      const s = testRun?.summary || {};
      const testRunTxt = testRun ? `${testRun.id} ${testRun.status}：${s.passed ?? "?"}P/${s.failed ?? "?"}F/${s.skipped ?? "?"}S` : "（無 test run 紀錄）";

      // deterministic 欄位（系統決定）：git + version + release_date
      const det = await _deterministicGitBlock(projectPath);
      // AI 欄位：summary + changes（驗 schema 不合規重試一次 → 仍失敗 fallback 由 git log 組成）
      let ai;
      try {
        try { ai = await _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle: freshRR?.title || rr.title }); }
        catch (first) {
          st.aiRetry = first.message;
          writeStatus(projectPath, rrId, st);
          ai = await _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle: freshRR?.title || rr.title });
        }
      }
      catch (e) {
        st.aiFallback = true;
        st.aiFallbackReason = e.message;
        ai = { summary: `本版含 ${scope.commits?.count ?? gitLog.split("\n").filter(Boolean).length} 個 commits（AI 摘要失敗，由系統列出 commit 清單）`, changes: _fallbackChanges(gitLog) };
      }

      const info = {
        schema: SCHEMA_VERSION,
        version: det.version,
        release_date: new Date().toISOString().slice(0, 10),
        summary: ai.summary,
        changes: ai.changes,
        git: det.git,
      };

      const versions = listInfoVersions(projectPath, rrId);
      const v = (versions.length ? Math.max(...versions) : 0) + 1;
      const dir = infoDir(projectPath, rrId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `info-v${v}.json`), JSON.stringify(info, null, 2), "utf-8");
      writeFileSync(join(dir, `bundle-v${v}.json`), JSON.stringify({
        version: v,
        generatedAt: new Date().toISOString(),
        testRun: st.testRun,
        evidenceSnapshot: st.evidenceSnapshot,
        baseline: rr.baseline,
        target: freshRR?.target || rr.target,
        aiFallback: !!st.aiFallback,
      }, null, 2), "utf-8");
      st.lastVersion = v;
      st.lastReleaseInfo = { version: info.version, changes: info.changes.length };
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

/** 所有 Release Info 清單（API 用）：每張 RR 一列 + 最新版 schema 摘要 */
export async function listAllReleaseInfo(projectPath) {
  const rrs = await listReleaseRequests(projectPath);
  const out = [];
  for (const rr of rrs) {
    const versions = listInfoVersions(projectPath, rr.id);
    if (!versions.length) continue;
    const latest = readInfoVersion(projectPath, rr.id, Math.max(...versions));
    if (!latest) continue;
    out.push({
      rrId: rr.id,
      rrStatus: rr.status,
      releaseId: rr.releaseId || null,
      infoVersions: versions,
      schema: latest.schema,
      version: latest.version,
      release_date: latest.release_date,
      summary: latest.summary,
      changesCount: (latest.changes || []).length,
      git: latest.git,
    });
  }
  return out;
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
  const latestV = versions.length ? Math.max(...versions) : null;
  out.latestRR = {
    id: latestRR.id, title: latestRR.title, status: latestRR.status,
    baseline: latestRR.baseline, target: latestRR.target,
    infoVersions: versions,
    latestInfoVersion: latestV,
    releaseInfo: latestV ? readInfoVersion(projectPath, latestRR.id, latestV) : null,
    buildStatus: status,
  };
  return out;
}

export function getBuildStatus(projectPath, rrId) {
  const st = readStatus(projectPath, rrId);
  return { running: _building.has(`${projectPath}::${rrId}`), status: st, versions: listInfoVersions(projectPath, rrId) };
}

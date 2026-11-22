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

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { startTestRun, getRunState, readLastTestRun } from "./test-runner.mjs";
import { generateEvidenceSnapshot } from "./release-evidence-snapshot.mjs";
import { getReleaseRequest, listReleaseRequests } from "./release-requests.mjs";
import { callProjectLLM } from "../routes/coding-helpers.mjs";
import { shellExec } from "./shell-exec.mjs";
import { buildEvidenceByApi } from "./evidence-by-api.mjs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const PAAW_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // tPAAW repo root
const SCHEMA_VERSION = "1.1";
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

/** 讀某一版的 Evidence Matrix（matrix-vN.json — 跟 info 同版號凍結） */
export function readInfoMatrix(projectPath, rrId, v) {
  try { return JSON.parse(readFileSync(join(infoDir(projectPath, rrId), `matrix-v${v}.json`), "utf-8")); } catch { return null; }
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

/** Schema 1.1（2026-11-21 Fleming）：CU 觸發 + 蒐集 — 機械層同步重掃（零 token 秒級）、
 * 智慧層背景自呼 cu-status 增量重跑（不阻塞），再讀 ru_info/Feature Map/API Map 組 AI 上下文。
 * 摘要不是改寫 git comment — 是拿 CU 對程式碼的理解去講變更的實質功能影響。 */
async function _cuContext(projectPath, changedFiles = []) {
  const result = { txt: "", affected: [] };
  const norm = (f) => String(f || "").replace(/\\/g, "/");
  const changed = new Set((changedFiles || []).map(norm));
  const hit = (files = []) => (files || []).some((f) => changed.has(norm(f)));
  try {
    try {
      const { rescanMechanicalLayer } = await import("./cu-mechanical.mjs");
      await rescanMechanicalLayer(projectPath, PAAW_ROOT);
      const { importCodingDb } = await import("./coding-db/import.mjs");
      importCodingDb(projectPath);
    } catch {}
    // 智慧層：背景自呼 cu-status（route 偵測 stale 會自動跑 AI CU），fire-and-forget 不阻塞
    try {
      const { PORT } = await import("../routes/shared.mjs");
      fetch(`http://127.0.0.1:${PORT}/api/coding-project/cu-status?path=${encodeURIComponent(projectPath)}`).catch(() => {});
    } catch {}
    let feats = [], apis = [], ruInfo = null;
    try { ruInfo = (await import("./coding-db/ru-info.repo.mjs")).readRuInfo(projectPath); } catch {}
    try { feats = (await import("./coding-db/reads.mjs")).readFeatures(projectPath) || []; } catch {}
    try { apis = (await import("./coding-db/reads.mjs")).readApiFeatures(projectPath).slice(0, 40); } catch {}
    result.affected = feats.filter((f) => hit(f.codeFiles)).slice(0, 15)
      .map((f) => ({ id: f.id, name: f.name, impact: "（系統比對變更檔案命中）" }));
    const lines = [];
    if (ruInfo?.ai_overview) lines.push(`## 專案概述\n${String(ruInfo.ai_overview).slice(0, 800)}`);
    if (ruInfo?.ai_architecture) lines.push(`## 架構\n${String(ruInfo.ai_architecture).slice(0, 800)}`);
    if (feats.length) lines.push(`## Feature Map（${feats.length} 個 feature）\n` + feats.slice(0, 25).map((f) => `- ${f.id} ${f.name}：${String(f.description || "").slice(0, 120)}${hit(f.codeFiles) ? " ← 本版變更命中" : ""}`).join("\n"));
    if (apis.length) lines.push(`## API Map（前 ${Math.min(apis.length, 25)}）\n` + apis.slice(0, 25).map((a) => `- ${a.id} [${a.category || ""}] ${a.name}（entry: ${a.entry || "—"}）：${String(a.description || a.bizLogic || "").slice(0, 120)}`).join("\n"));
    // 2026-11-21 Fleming：也參考 task / ADR / changelog / 人的備註
    try {
      const { docEvidenceBlock } = await import("./doc-evidence.mjs");
      const ev = docEvidenceBlock(projectPath);
      if (ev.trim()) lines.push(`## 專案脈絡（TASKS / ADR / CHANGELOG / 人的備註）\n${ev}`);
    } catch {}
    result.txt = lines.join("\n\n") || "（無 CU 資料 — 尚未跑過 Code Understanding）";
  } catch (e) { result.txt = `（CU 蒐集失敗：${e.message}）`; }
  return result;
}

/** AI 失敗/解析失敗時的 deterministic fallback：changes 直接由 git log subjects 組成（type=chore） */
function _fallbackChanges(gitLog) {
  return gitLog.split("\n").filter(Boolean).slice(0, 30).map(line => {
    const m = /^([0-9a-f]+) (.+)$/.exec(line);
    return { type: "chore", title: (m ? m[2] : line).slice(0, 80), description: m ? `commit ${m[1]}` : "" };
  });
}

async function _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle, previousTag, unitLog = "", cuTxt = "", baseGroups = [] }) {
  const initial = !previousTag; // 無前版 tag = 首次 release（含 import 別人的 release unit 起手）
  const modeTxt = initial
    ? `這是首次 release（Initial Release${gitLog || unitLog ? "，匯入他人的 release unit 起手" : "，程式剛匯入、尚無後續變更"}）。
summary 必須以「首次匯入 Initial Release」角度寫：這個 release unit 是什麼、核心功能/主要內容、測試狀態，目的是讓接手開發者從 release/DFO 角度快速理解全貌、準備第一次 release。用語用「首次匯入」，不要寫「本版無程式碼變更」。${gitLog ? "changes 把整段歷史歸納成主要能力/變更項目。" : "changes 必須是空陣列 []（本版無新增差異）；summary 依「完整歷史」摘要整個 release unit 的內容。"}
features 即使在 0 commits 的 initial release 也【不可】空陣列：必須逐一輸出「程式歸納的功能群組」全部項目。`
    : `這是接續前版（${previousTag}）的一般 release，summary 摘要本版變更重點。`;
  const prompt = `你是 Release Manager。根據以下 deterministic 證據產生 Release Info 的 summary / changes / features。

【核心理念 — 2026-11-21 Fleming】
不要只改寫 git comment。git comment 只是線索；你要拿 Code Understanding（專案概述/Feature Map/API Map）
對程式碼的理解，去講這次變更的實質功能意義：改了什麼能力、影響哪些 feature/API、對使用者/接手開發者的意義。
還要參考專案脈絡裡的 TASKS（實際做了哪些工作、為什麼）、ADR/技術決策（已定調的架構取捨）、CHANGELOG/KNOWN ISSUES（近期變動與坑）：
這些能解釋「為什麼改」，避免只從 code 猜。人的備註優先於一切。
第二次 release 起，重點是「從上次 release 到現在了哪些內容、影響的 feature 是什麼」。

【輸出格式 — 嚴格遵守，每次一致】
只輸出一個 JSON 物件，不要 code fence、不要 markdown、不要說明文字。結構必須完全是：
{"summary": "<一兩句話摘要>", "changes": [{"type": "<type>", "title": "<標題>", "description": "<說明>"}], "features": [{"id": "<feature id>", "name": "<feature 名>", "impact": "<本版對它的影響>"}]}
- summary：字串，一兩句話的版本摘要（繁體中文）
- changes：陣列，把變更歸納成變更項目（相近 commits 合併；description 講實質功能影響，不是貼 commit message）
- 每個 change 必須恰好三個 key：type / title / description，不可多不可少
- type 只能是這五個之一：feature | improvement | fix | breaking | chore
- title：短標題（兰 80 字）；description：具體說明（兰 300 字）
- 只描述證據支援的事實，不可編造
- features：把這個 release「摘要成主要功能」（給人看的功能盤點，不是貼 Feature Map 原文）
  - 數量與分組已由程式依 API Map 決定（下方「程式歸納的功能群組」共 ${baseGroups.length} 組）：
    你【必須】輸出恰好 ${baseGroups.length} 項、id 與順序完全照抄，不可增加、不可刪除、不可合併、不可自行決定幾個。
    你的工作是「解讀」每一組：給人話功能名、寫一句話說明（不是決定數量）。
  - id：直接照抄該組的 id
  - name：人話功能名，從該組 API 的 name/description 歸納。
    嚴格要求：name 不可與 id 相同、不可直接照抄分類名、不可只寫兩個字的分類。
    對照範例：id「對話補全」→ name「Chat Completions 代理」；id「向量化」→「Embeddings 向量端點」；id「批次任務」→「批次任務管理」；id「管理介面」→「管理 API 與日誌查詢」。
  - impact：一到兩句（約 30–60 字）白話說明這個功能「做什麼、對使用者有什麼用」（initial = 全貌盤點；一般 release = 本版對它的影響）。
    不可只寫「N 支 API：…」這種數量描述 — 要講功能本身；不要堆術語，讓沒碰過這個 repo 的人一看就懂。
  - initial release：分組 = 整個 release unit 的全部能力域
  - 一般 release：分組 = 本版變更影響到的功能；真的無分組 = 空陣列 []

# 程式歸納的功能群組（共 ${baseGroups.length} 組 — features 必須恰好 ${baseGroups.length} 項、id 照抄）
${baseGroups.length ? baseGroups.map(g => `- ${g.id}｜${(g.apis || [g.name || g.id]).join("、")}${g.hint ? `｜${g.hint}` : ""}`).join("\n") : "（無）"}

# 情境
${modeTxt}

# Release：${rrTitle}
# 變更範圍
${scopeTxt}
# Code Understanding（專案概述 / Feature Map / API Map — 摘要的主要依據）
${cuTxt}
# Git Log
${gitLog}
# 完整歷史（僅供 initial 摘要 release unit 全貌，不列入 changes）
${unitLog || "—"}
# 測試實跑（輔助判斷 fix/improvement）
${testRunTxt}`;
  const r = await callProjectLLM({ messages: [{ role: "user", content: prompt }] }, { caller: "release-info", timeoutMs: 180_000, maxRetries: 2 });
  const raw = _stripFence(r?.content);
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error("AI 回應不是 JSON");
  const parsed = JSON.parse(m[0]);
  return _validateAiPart(parsed, { hasCommits: gitLog.split("\n").filter(Boolean).length > 0 }); // 不符 schema 直接 throw → 上層重試/fallback
}

/** 嚴格驗證 AI 產的 summary/changes/features（Schema 1.1）— 格式每次一致，不合規就拒收 */
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
  // Schema 1.1：features — 影響到的 feature（id/name 照 Feature Map 原文，impact 一句話）
  if (!Array.isArray(parsed.features)) throw new Error("features 缺失或非陣列（沒有影響 = 空陣列）");
  const features = [];
  for (const f of parsed.features) {
    if (!f || typeof f !== "object") throw new Error("feature 不是物件");
    const id = typeof f.id === "string" ? f.id.trim() : "";
    const name = typeof f.name === "string" ? f.name.trim() : "";
    const impact = typeof f.impact === "string" ? f.impact.trim() : "";
    if (!id || !name) throw new Error("feature.id/name 缺失");
    features.push({ id: id.slice(0, 80), name: name.slice(0, 120), impact: impact.slice(0, 300) });
  }
  return { summary: summary.slice(0, 600), changes, features: features.slice(0, 50) };
}

/**
 * 啟動 build（背景 job，不 await 結果）— 回傳起始狀態。
 * 已在跑 → 回 running；RR 不存在 → throw 404。
 */
/** features deterministic 來源：變更命中 feature map → 沒有（initial release）就 feature map 全量 */
async function _deterministicFeatures(projectPath, cu) {
  if (cu?.affected?.length) return cu.affected;
  // fallback：API Map 依 category 分組 → 摘要成功能域（比 auto-named feature map 可讀）
  try {
    const { readApiFeatures } = await import("./coding-db/reads.mjs");
    const apis = readApiFeatures(projectPath) || [];
    const byCat = new Map();
    for (const a of apis) {
      const c = String(a.category || "core").trim() || "core";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(a);
    }
    return [...byCat.entries()].map(([c, list]) => ({
      id: c,
      name: c,
      impact: `${list.length} 支 API：${list.slice(0, 3).map(a => a.name || a.entry).join("、")}${list.length > 3 ? " 等" : ""}`,
      apis: list.map(a => `${a.entry || a.name}${a.name && a.entry ? `（${a.name}）` : ""}`),
    }));
  } catch { return []; }
}

/** AI 主回覆沒給 features 時，單獨再問一次（只問命名，不讓它決定數量） */
async function _aiFeaturesOnly(baseGroups) {
  if (!baseGroups?.length) return [];
  const list = baseGroups.map(g => `- ${g.id}｜${(g.apis || [g.name || g.id]).join("、")}`).join("\n");
  const prompt = `你在寫 Release Info 的 features。以下功能群組由程式依 API Map 歸納，數量固定 ${baseGroups.length} 組。
只輸出 JSON 陣列（不要 code fence、不要說明）：每個元素 {"id":"<照抄>","name":"<人話功能名>","impact":"<一句話說明功能意義>"}。
規則：
1. id 必須與下面完全一致、順序一致、數量恰好 ${baseGroups.length} 項。
2. name 必須是功能導向的人話名稱，不可等於 id、不可只寫分類名。例：對話補全 → Chat Completions 代理；向量化 → Embeddings 向量端點。
3. impact 用一到兩句白話（約 30–60 字）講這個功能做什麼、對使用者有什麼用；不可只寫「N 支 API」、不可堆術語。

${list}`;
  const r = await callProjectLLM({ messages: [{ role: "user", content: prompt }] }, { caller: "release-info-features", timeoutMs: 120_000, maxRetries: 1 });
  const raw = _stripFence(r?.content);
  const m = /\[[\s\S]*\]/.exec(raw);
  if (!m) return [];
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) return [];
  return arr.filter(f => f && typeof f.id === "string" && typeof f.name === "string").map(f => ({
    id: f.id.trim().slice(0, 80), name: f.name.trim().slice(0, 120), impact: String(f.impact || "").trim().slice(0, 300),
  }));
}

/** 只讓 AI 解讀（命名/影響），數量與順序由程式決定：以 base 為準，AI 依 id 或順序補 name/impact */
function _mergeFeatures(base, ai) {
  if (!base?.length) return (ai || []).slice(0, 50);
  const used = new Set();
  const pick = (g, i) => {
    const byId = (ai || []).find(f => f?.id === g.id && !used.has(f));
    const byIdx = !byId ? (ai || [])[i] : null;
    const f = byId || byIdx;
    if (f) used.add(f);
    return {
      id: g.id,
      name: (f?.name && String(f.name).trim()) || g.name || g.id,
      impact: (f?.impact && String(f.impact).trim()) || g.impact || "",
    };
  };
  return base.map(pick);
}

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
    steps: ["tests", "evidence", "matrix", "cu", "ai-write"],
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
      // ── 2b. Evidence Matrix（2026-11-21 Fleming：Release Info 的一部分，同版號凍結 matrix-vN.json）──
      st.step = "matrix";
      writeStatus(projectPath, rrId, st);
      let matrix = null;
      try {
        matrix = await buildEvidenceByApi(projectPath, { sinceSha: rr.baseline?.sha || null });
        // baseline = HEAD（initial release / 0 commits）→ 窗口空，矩陣改看全部 API（不然 initial release 會是空表）
        if (!matrix.apis.length) matrix = await buildEvidenceByApi(projectPath, { sinceSha: null });
      } catch (e) { st.matrixError = e.message; }
      st.matrix = matrix ? { apis: matrix.apis.length, summary: matrix.summary } : null;
      st.step = "cu"; // 2026-11-21 Fleming：做 release unit 時觸發 CU（機械層同步重掃 + 智慧層背景增量）
      writeStatus(projectPath, rrId, st);

      // ── 3. CU 蒐集（Schema 1.1：AI 拿 Feature Map/API Map 理解程式碼，不是只看 git comment）──
      const scope0 = rr.scope || {};
      const cu = await _cuContext(projectPath, scope0.files || []);
      if (matrix?.summary) {
        const m = matrix.summary;
        cu.txt += `\n\n[Evidence Matrix by API] APIs ${m.changedApis} / 有測試 ${m.withTests} / e2e 覆蓋 ${m.e2eCovered} / SG high ${m.sgHigh} / 有 review ${m.withReview} / 有 QA ${m.withQa}`;
      }
      st.cu = { affectedFeatures: cu.affected.map((f) => f.id) };
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
      // 2026-11-21：import 別人 RU 的 initial release — baseline=HEAD 導致 gitLog 空，但完整歷史仍要餵給 AI 摘要 release unit 全貌（接手開發用）
      const unitLog = !gitLog
        ? await shellExec("git log --oneline -n 50", { cwd: projectPath, timeout: 10000 }).then(r => r.stdout.trim()).catch(() => "")
        : "";
      const s = testRun?.summary || {};
      const testRunTxt = testRun ? `${testRun.id} ${testRun.status}：${s.passed ?? "?"}P/${s.failed ?? "?"}F/${s.skipped ?? "?"}S` : "（無 test run 紀錄）";

      // deterministic 欄位（系統決定）：git + version + release_date
      const det = await _deterministicGitBlock(projectPath);
      // AI 欄位：summary + changes（驗 schema 不合規重試一次 → 仍失敗 fallback 由 git log 組成）
      let ai;
      try {
        try { ai = await _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle: freshRR?.title || rr.title, previousTag: det.previous_tag, unitLog, cuTxt: cu.txt }); }
        catch (first) {
          st.aiRetry = first.message;
          writeStatus(projectPath, rrId, st);
          const baseGroups = await _deterministicFeatures(projectPath, cu);
      ai = await _aiSummaryAndChanges({ gitLog, scopeTxt, testRunTxt, rrTitle: freshRR?.title || rr.title, previousTag: det.previous_tag, unitLog, cuTxt: cu.txt, baseGroups });
        }
      }
      catch (e) {
        st.aiFallback = true;
        st.aiFallbackReason = e.message;
        ai = {
          summary: !gitLog
            ? `首次匯入 initial release（AI 摘要失敗，自動 fallback：本版匯入基準 ${det.commit?.slice(0, 8) || "HEAD"}，無後續變更）`
            : `本版含 ${scope.commits?.count ?? gitLog.split("\n").filter(Boolean).length} 個 commits（AI 摘要失敗，由系統列出 commit 清單）`,
          changes: _fallbackChanges(gitLog),
          features: await _deterministicFeatures(projectPath, cu),
        };
      }

      let aiFeatures = ai.features || [];
      const _baseGroups = await _deterministicFeatures(projectPath, cu);
      if (_baseGroups.length && aiFeatures.length !== _baseGroups.length) {
        try {
          const extra = await _aiFeaturesOnly(_baseGroups);
          if (extra.length === _baseGroups.length) aiFeatures = extra;
        } catch { /* 保留 deterministic 命名 */ }
      }
      // 2026-11-22 Fleming：RR 未 close 前不是 release — info 明確標 draft；
      // version 字段是「預估下一版」（shipped+1），標 draft 免得 AI/人誤讀成真的 release 過 N 次
      let rrStatusForDraft = null;
      try { rrStatusForDraft = (await getReleaseRequest(projectPath, rrId))?.status || null; } catch {}
      const info = {
        schema: SCHEMA_VERSION,
        status: rrStatusForDraft === "released" ? "released" : "draft",
        version: det.version,
        release_date: new Date().toISOString().slice(0, 10),
        summary: ai.summary,
        changes: ai.changes,
        // 2026-11-21 Fleming：數量由程式決定（API Map 分組），AI 只負責解讀命名 — 不讓 AI 決定幾個
        features: _mergeFeatures(_baseGroups, aiFeatures),
        git: det.git,
      };

      const versions = listInfoVersions(projectPath, rrId);
      const v = (versions.length ? Math.max(...versions) : 0) + 1;
      const dir = infoDir(projectPath, rrId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `info-v${v}.json`), JSON.stringify(info, null, 2), "utf-8");
      if (matrix) writeFileSync(join(dir, `matrix-v${v}.json`), JSON.stringify(matrix, null, 2), "utf-8");
      // 2026-11-21 Fleming：release 資訊也要進 sqlite（coding.db release_infos，UNIQUE(rr_id, version)）
      try {
        const { writeReleaseInfo } = await import("./coding-db/release-info.repo.mjs");
        writeReleaseInfo(projectPath, {
          rrId, v, schema: info.schema, appVersion: info.version, releaseDate: info.release_date,
          summary: info.summary, changes: info.changes, features: info.features, git: info.git,
          matrixSummary: matrix?.summary || null,
          aiSource: st.aiFallback ? "fallback" : "ai", testRunId: st.testRun?.id || null,
        });
      } catch (e) { st.dbError = e.message; }
      writeFileSync(join(dir, `bundle-v${v}.json`), JSON.stringify({
        version: v,
        generatedAt: new Date().toISOString(),
        testRun: st.testRun,
        evidenceSnapshot: st.evidenceSnapshot,
        evidenceMatrix: matrix ? { file: `matrix-v${v}.json`, anchor: matrix.anchor, summary: matrix.summary } : null,
        baseline: rr.baseline,
        target: freshRR?.target || rr.target,
        aiFallback: !!st.aiFallback,
      }, null, 2), "utf-8");
      // 2026-11-22 Fleming：只留最新一版 — 舊的 info/matrix/bundle 快照直接刪（不留歷史、無版本下拉；
      // 內容該有的 git/commit 都在 DB 與最新檔裡，AI 查得到，人不需要看到）
      try {
        for (const f of readdirSync(dir)) {
          const m = /^(info|matrix|bundle)-v(\d+)\.json$/.exec(f);
          if (m && Number(m[2]) !== v) { try { unlinkSync(join(dir, f)); } catch {} }
        }
      } catch {}
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

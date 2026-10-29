/**
 * release-evidence — Release Evidence Matrix 證據收集（2026-10-10 Fleming 拍板）
 *
 * 老闆 review 的重點要有證據 — 全部限 PAAW coding app 內部 deterministic 來源，
 * 每次重掃結果不變（idempotent）：
 *   Sev      ← .paaw/features/FEATURES.json — 生效值三層（2026-10-10 18:08 Fleming：
 *              預設信任 AI 判定直接生效，人發現問題再覆寫）：
 *              1. severityDecisions 最新人判定（append-only 並存 — 18:18 Fleming）
 *              2. severitySuggested（AI 分析 / 規則掃描落地）
 *              3. 即時 scanFeatureRisk（deterministic 構成面、零 token、不寫檔）
 *   Unit     ← feature.tests + lastTestRun 綠燈（測試檔數）
 *   E2E      ← changed APIs 的 e2e 內容覆蓋（readiness apiCoveredByTests）
 *   SG       ← .paaw/security/scan-results.json（semgrep findings × feature files）
 *   QA       ← qa-results（listQaResults by feature — 最新 verdict/actor）
 *   AI-RV    ← .paaw/review-board/*.md（Multi-Model Review 委員會 — 哪些 model、findings）
 *   Human 註 ← qa-results actor=human 最新一筆
 *
 * 分級要求（gaps 計算 — 2026-10-10 與 Fleming 對焦）：
 *   S2🔴 unit+e2e+sg+qa+aiReview+human 全要
 *   S1🟡 unit+e2e+sg + (qa 或 aiReview 擇一)
 *   S0🟢 unit + qa
 *   未確認 severity → 標 ? 導引確認（不算 gaps，但 readiness 提示）
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listQaResults } from "./qa-results.mjs";
import { scanFeatureRisk } from "./feature-risk-scan.mjs";

// ── severity（FEATURES.json by feature id/name）──
export async function loadSeverityMap(projectPath) {
  const map = new Map(); // key: feature id, value: { severity, source, raw }
  try {
    const raw = JSON.parse(await readFile(join(projectPath, ".paaw", "features", "FEATURES.json"), "utf-8"));
    const features = Array.isArray(raw) ? raw : (raw.features || []);
    for (const f of features) {
      if (!f?.id) continue;
      const decisions = Array.isArray(f.severityDecisions) ? f.severityDecisions : [];
      if (decisions.length) {
        const latest = decisions[decisions.length - 1]; // 最新人判定生效（並存保留全部）
        map.set(String(f.id), { severity: latest.severity, source: "human", decisions, raw: f });
      } else if (f.severity) {
        map.set(String(f.id), { severity: f.severity, source: "human", decisions, raw: f }); // 舊欄位相容
      } else if (f.severitySuggested) {
        map.set(String(f.id), { severity: f.severitySuggested, source: f.severitySuggestedBy === "ai" ? "ai" : "scan", decisions, raw: f }); // AI 判定預設生效
      } else {
        map.set(String(f.id), { severity: null, source: "none", decisions, raw: f }); // 現場即時掃描 fallback
      }
    }
  } catch { /* 無 FEATURES.json */ }
  return map;
}

// ── semgrep findings × feature files ──
const _normEvPath = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");

export async function loadSecurityScan(projectPath) {
  try {
    const data = JSON.parse(await readFile(join(projectPath, ".paaw", "security", "scan-results.json"), "utf-8"));
    const findings = Array.isArray(data.findings) ? data.findings : [];
    const root = _normEvPath(projectPath).replace(/\/$/, "");
    return {
      scannedAt: data.scannedAt || data.meta?.scannedAt || null,
      findings: findings.map(f => ({
        // 2026-10-21 修假綠燈：semgrep-runner 存的是「絕對路徑」，feature 的 files 是相對路徑 →
        // 舊版不比對根目錄，永遺命中永远 0 → 有 CRITICAL 也當没掃到（false green）。統一相對化。
        file: _relToRoot(f.file || f.path, root),
        severity: String(f.severity || "").toUpperCase(), // CRITICAL/WARNING/INFO（semgrep-runner 映射後值域 — 見 sgForFeature）
        rule: String(f.id || f.rule || "").slice(0, 120),
      })),
    };
  } catch { return null; }
}

function _relToRoot(p, root) {
  const s = _normEvPath(p);
  if (root && s.startsWith(root + "/")) return s.slice(root.length + 1);
  return s;
}

export function sgForFeature(scan, featureFiles) {
  if (!scan) return { ok: false, reason: "未掃描" };
  const set = new Set(featureFiles.map(_normEvPath));
  const hits = scan.findings.filter(f => set.has(_normEvPath(f.file)));
  // 2026-10-21：修假綠燈 — semgrep-runner 存的值域是 CRITICAL/WARNING/INFO（ERROR 早已被映射掉），
  // 舊版比 "ERROR" 永遠比不到 → high 恒 0 → 有 CRITICAL finding 照樣 ✓（本機 scan-results 實測 9 筆全 WARNING 驗證）
  const high = hits.filter(f => f.severity === "CRITICAL" || f.severity === "ERROR").length;
  return { ok: high === 0, high, total: hits.length, scannedAt: scan.scannedAt };
}

// ── review-board（Multi-Model 委員會）──
// 報告 md 格式（coding-review-runner buildReport）：
//   - Reviewers：`model1`、`model2`
//   - 結論：**approve**（critical 0 / major N …）
//   - ### 🔴 file:line …（findings 檔案）
export async function loadReviewBoard(projectPath) {
  const dir = join(projectPath, ".paaw", "review-board");
  if (!existsSync(dir)) return null;
  let files = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith(".md")).sort(); } catch { return null; }
  if (!files.length) return null;
  const reports = [];
  for (const f of files.slice(-10)) { // 最近 10 份
    try {
      const md = await readFile(join(dir, f), "utf-8");
      const reviewers = [...md.matchAll(/- Reviewers：(.+)/g)].flatMap(m =>
        [...(m[1].matchAll(/`([^`]+)`/g))].map(x => x[1]));
      const decision = (md.match(/- 結論：\*\*(\w[\w-]*)\*\*/) || [])[1] || null;
      const findingFiles = [...md.matchAll(/^### .+?(\S+):\d+/gm)].map(m => m[1].replace(/^\.\//, ""));
      // 2026-10-21：審查範圍清單（新報告）— 乾攆 approve 沒 findings headings，
      // touched 只靠 findings = 全綠審查永遠 join 不上 feature（越乾淨越沒證據的謬誤）
      const scopeStart = md.indexOf("## 審查範圍");
      let scopeFiles = [];
      if (scopeStart !== -1) {
        const rest = md.slice(scopeStart);
        const nextSec = rest.indexOf("\n## ", 1);
        const section = nextSec === -1 ? rest : rest.slice(0, nextSec);
        scopeFiles = [...section.matchAll(/- `([^`]+)`/g)].map(m => m[1].replace(/\\/g, "/").replace(/^\.\//, ""));
      }
      const at = (md.match(/- 時間：(\S+)/) || [])[1] || null;
      if (reviewers.length) reports.push({ file: f, at, decision, reviewers, findingFiles, scopeFiles });
    } catch { /* skip bad md */ }
  }
  return reports.length ? { latest: reports[reports.length - 1], reports } : null;
}

export function aiReviewForFeature(board, featureFiles) {
  if (!board) return { ok: false, reason: "未跑（.paaw/review-board/ 空）" };
  const set = new Set(featureFiles.map(p => String(p).replace(/\\/g, "/").replace(/^\.\//, "")));
  // touched 判定：優先審查範圍清單（2026-10-21 — 乾攆 approve 也要算審過）；
  // 舊報告無範圍清單 → fallback findings headings（審到出事的地方也算觸及）
  let touched = null;
  for (const r of board.reports.slice().reverse()) {
    const scope = (r.scopeFiles && r.scopeFiles.length) ? r.scopeFiles : r.findingFiles;
    if (scope.some(f => set.has(f))) { touched = r; break; }
  }
  if (touched) {
    // 2026-10-20：touched 但非 approve 時要给 reason — 否則 RM 證據矩陣把「已審未過」誤顯示成「未跑」（Fleming 誤導事件）
    return { ok: touched.decision === "approve", models: touched.reviewers, at: touched.at, decision: touched.decision, touched: true,
      reason: touched.decision === "approve" ? undefined : `已審（${touched.decision}）未達 approve` };
  }
  // 2026-10-21：untouched 獨立標記 — 有跑但沒審到這個 feature ≠ 未跑（UI 分三態，不再誤導）
  return { ok: false, untouched: true, reason: `委員會未觸及此 feature（共 ${board.reports.length} 份報告，最新 ${board.latest.at ? String(board.latest.at).slice(0, 10) : "?"} 審查）`, models: board.latest.reviewers, at: board.latest.at };
}

// ── QA（qa-results by feature）──
// 2026-10-21 Fleming：QA 欄打叉誤導事件 — 聊天講「閘門全過」但矩陣打叉，根因有二：
//   (a) QA 說了沒記錄（或 feature 名跟 FEATURES.json name 差一字 → 精確比對視同無記錄）
//   (b) 最新一筆非 pass 時沒給 reason → tooltip 一律 "missing" 又一次誤導
// 對策：比對放寬 trim + case-insensitive；reason 分級（無記錄 / 名稱對不上 / 最新一筆非 pass）
const _normFeatureKey = (s) => String(s || "").trim().toLowerCase();

export function qaForFeature(projectPath, featureKey) {
  try {
    // 1) 精確比對（快徑 — qa_record_save feature = name 原文時直接命中）
    let items = listQaResults(projectPath, { feature: featureKey, limit: 5 });
    // 2) 放寬：trim + case-insensitive（前後空格 / 大小寫差異不該讓證據消失）
    if (!items.length && String(featureKey || "").trim()) {
      const nk = _normFeatureKey(featureKey);
      items = listQaResults(projectPath, { limit: 500 })
        .filter(r => _normFeatureKey(r.feature) === nk)
        .slice(0, 5);
    }
    if (!items.length) {
      // reason 分級：專案內有記錄但沒一筆標到這個 feature → 名稱對不上的診斷線索（不是籠統的「無記錄」）
      const any = listQaResults(projectPath, { limit: 1 });
      return { ok: false, reason: any.length ? `有 QA 記錄但 feature 名對不上（記錄 feature 需=「${String(featureKey).slice(0, 40)}」原文 — 用 qa_record_save 補記）` : "無 QA 記錄" };
    }
    const latest = items[0];
    // 2026-10-21：human 從全部比對到的記錄找（不限最新 5 筆）— 舊版 human 簽核被後續 agent 記錄沖掉 → 誤報「無人員記錄」
    const human = (items.length >= 5
      ? listQaResults(projectPath, { limit: 500 }).filter(r => _normFeatureKey(r.feature) === _normFeatureKey(featureKey))
      : items).find(r => r.actor === "human") || null;
    return {
      ok: latest.verdict === "pass",
      verdict: latest.verdict, actor: latest.actor, at: latest.ts,
      summary: String(latest.summary || "").slice(0, 120),
      human: human ? { verdict: human.verdict, at: human.ts, summary: String(human.summary || "").slice(0, 160) } : null,
      count: items.length,
      reason: latest.verdict === "pass" ? undefined : `最新一筆 ${latest.verdict}：${String(latest.summary || "").slice(0, 60)}`,
    };
  } catch { return { ok: false, reason: "無 QA 記錄" }; }
}

// 2026-10-28 Fleming 定調：「unit test / e2e 應該是每次都看整體的現況，跟 commit line 無關」
// 現況導向三態：
//   從未跑過 / 上次有失敗 → 紅（誠實：沒有綠燈事實）
//   綠但落後 N commits       → 綠 + note（結果較舊，自動重跑中 — readiness 自癒機制會補新）
//   綠且新鮮                 → 綠
// （10-21 從嚴設計的假綠燈防護保留：never-run / failed 仍然紅；stale 降級為提示不是證據消失）
function _unitGate(opts) {
  if (opts.lastTestRun !== undefined) {
    const ltr = opts.lastTestRun;
    if (!ltr) return { green: false, why: "測試從未跑過（先跑 ▶ 測試建立基準）" };
    if ((ltr.summary?.failed || 0) > 0) return { green: false, why: `上次測試失敗 ${ltr.summary.failed} 條` };
    if (ltr.stale) return { green: true, why: null, note: `上次全綠（${ltr.staleCommits} commits 前）— 自動重跑中，稍後自動更新` };
    return { green: true, why: null };
  }
  // legacy 相容（未傳 lastTestRun 維持舊行為）
  return { green: opts.lastTestRunGreen !== false, why: null };
}

// ── 分級要求 + gaps ──
const REQUIREMENTS = {
  S2: ["unit", "e2e", "sg", "qa", "aiReview", "human"],
  S1: ["unit", "e2e", "sg", "either:qa|aiReview"],
  S0: ["unit", "qa"],
};

export function evidenceGaps(sev, ev) {
  const req = REQUIREMENTS[sev || "S1"] || []; // 無值防禦從嚴 S1
  const missing = [];
  for (const r of req) {
    if (r.startsWith("either:")) {
      const opts = r.slice("either:".length).split("|");
      if (!opts.some(o => ev[o]?.ok)) missing.push(`擇一缺：${opts.join("/")}`);
    } else if (!ev[r]?.ok) {
      missing.push(r);
    }
  }
  return { missing };
}

// ── 主入口：changedFeatures × 證據 join ──
export async function buildEvidenceMatrix(projectPath, changedFeatures, opts = {}) {
  const [sevMap, scan, board] = await Promise.all([loadSeverityMap(projectPath), loadSecurityScan(projectPath), loadReviewBoard(projectPath)]);
  const unitGate = _unitGate(opts); // 2026-10-21：no-run/stale/failed 從嚴 — 假綠燈修復

  const features = [];
  for (const f of changedFeatures) {
    let sevInfo = sevMap.get(String(f.id)) || { severity: null, source: "none", raw: null };
    // 第三層 fallback：即時 deterministic 構成面掃描（零 token、idempotent、不寫檔）
    if (!sevInfo.severity) {
      try {
        const scan = await scanFeatureRisk(projectPath, sevInfo.raw || f);
        if (scan?.computedSeverity) sevInfo = { severity: scan.computedSeverity, source: "auto", decisions: sevInfo.decisions || [], raw: sevInfo.raw };
      } catch { /* 掃描失敗從嚴 S1（evidenceGaps 防禦） */ }
    }
    const sev = sevInfo.severity;
    const ev = {
      unit: f.hasTests
        ? { ok: unitGate.green, tests: f.tests?.length || 0, ...(unitGate.why ? { reason: unitGate.why } : {}), ...(unitGate.note ? { note: unitGate.note } : {}) }
        : { ok: false, reason: "無測試檔" },
      e2e: f.apiImpact
        ? { ok: f.e2eCoveredApis > 0, covered: f.e2eCoveredApis, total: f.apis?.length || 0 }
        : { ok: true, reason: "無 API 變更（不適用）" },
      sg: sgForFeature(scan, f.changedFiles),
      qa: qaForFeature(projectPath, f.name),
      aiReview: aiReviewForFeature(board, f.changedFiles),
    };
    ev.human = ev.qa.human ? { ok: ev.qa.human.verdict === "pass", ...ev.qa.human } : { ok: false, reason: "無人員記錄" };
    const gaps = evidenceGaps(sev, ev);
    features.push({
      ...f,
      severity: sev,
      severitySource: sevInfo.source, // human（最新人判定）| ai | scan | auto（即時掃描）
      severityDecisions: sevInfo.decisions || [], // 並存：全部人員判定歷史（永不覆蓋）
      evidence: ev,
      gaps,
    });
  }

  const summary = {
    features: features.length,
    bySeverity: {
      S2: features.filter(x => x.severity === "S2").length,
      S1: features.filter(x => x.severity === "S1").length,
      S0: features.filter(x => x.severity === "S0").length,
      humanOverride: features.filter(x => x.severitySource === "human").length, // 人覆寫
      aiDefault: features.filter(x => x.severitySource !== "human").length,     // AI 判定直接生效
    },
    withGaps: features.filter(x => x.gaps.missing.length > 0).length,
    sgScan: scan ? { scannedAt: scan.scannedAt, total: scan.findings.length, high: scan.findings.filter(x => x.severity === "CRITICAL" || x.severity === "ERROR").length } : null,
    reviewBoard: board ? { latest: { at: board.latest.at, decision: board.latest.decision, models: board.latest.reviewers }, total: board.reports.length } : null,
  };
  return { features, summary };
}

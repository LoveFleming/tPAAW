/**
 * release-evidence — Release Evidence Matrix 證據收集（2026-10-10 Fleming 拍板）
 *
 * 老闆 review 的重點要有證據 — 全部限 PAAW coding app 內部 deterministic 來源，
 * 每次重掃結果不變（idempotent）：
 *   Sev      ← .paaw/features/FEATURES.json — 生效值三層（2026-10-10 18:08 Fleming：
 *              預設信任 AI 判定直接生效，人發現問題再覆寫）：
 *              1. severity（人覆寫 — PUT /severity）
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
      if (f.severity) {
        map.set(String(f.id), { severity: f.severity, source: "human", raw: f }); // 人覆寫（最高權威）
      } else if (f.severitySuggested) {
        map.set(String(f.id), { severity: f.severitySuggested, source: f.severitySuggestedBy === "ai" ? "ai" : "scan", raw: f }); // AI 判定預設生效
      } else {
        map.set(String(f.id), { severity: null, source: "none", raw: f }); // 現場即時掃描 fallback
      }
    }
  } catch { /* 無 FEATURES.json */ }
  return map;
}

// ── semgrep findings × feature files ──
export async function loadSecurityScan(projectPath) {
  try {
    const data = JSON.parse(await readFile(join(projectPath, ".paaw", "security", "scan-results.json"), "utf-8"));
    const findings = Array.isArray(data.findings) ? data.findings : [];
    return {
      scannedAt: data.scannedAt || data.meta?.scannedAt || null,
      findings: findings.map(f => ({
        file: String(f.file || f.path || "").replace(/^\.\//, ""),
        severity: String(f.severity || "").toUpperCase(), // ERROR/WARNING/INFO
        rule: String(f.id || f.rule || "").slice(0, 120),
      })),
    };
  } catch { return null; }
}

export function sgForFeature(scan, featureFiles) {
  if (!scan) return { ok: false, reason: "未掃描" };
  const set = new Set(featureFiles);
  const hits = scan.findings.filter(f => set.has(f.file));
  const high = hits.filter(f => f.severity === "ERROR").length;
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
      const at = (md.match(/- 時間：(\S+)/) || [])[1] || null;
      if (reviewers.length) reports.push({ file: f, at, decision, reviewers, findingFiles });
    } catch { /* skip bad md */ }
  }
  return reports.length ? { latest: reports[reports.length - 1], reports } : null;
}

export function aiReviewForFeature(board, featureFiles) {
  if (!board) return { ok: false, reason: "未跑（.paaw/review-board/ 空）" };
  const set = new Set(featureFiles);
  // 有 findings 提及該 feature 檔案的報告（= 委員會實際審到這裡）
  let touched = null;
  for (const r of board.reports.slice().reverse()) {
    if (r.findingFiles.some(f => set.has(f))) { touched = r; break; }
  }
  if (touched) return { ok: touched.decision === "approve", models: touched.reviewers, at: touched.at, decision: touched.decision, touched: true };
  return { ok: false, reason: "委員會未觸及此 feature", models: board.latest.reviewers, at: board.latest.at };
}

// ── QA（qa-results by feature）──
export function qaForFeature(projectPath, featureKey) {
  try {
    const list = listQaResults(projectPath, { feature: featureKey, limit: 5 });
    const items = Array.isArray(list) ? list : (list.items || []);
    if (!items.length) return { ok: false, reason: "無 QA 記錄" };
    const latest = items[0];
    const human = items.find(r => r.actor === "human") || null;
    return {
      ok: latest.verdict === "pass",
      verdict: latest.verdict, actor: latest.actor, at: latest.ts,
      summary: String(latest.summary || "").slice(0, 120),
      human: human ? { verdict: human.verdict, at: human.ts, summary: String(human.summary || "").slice(0, 160) } : null,
      count: items.length,
    };
  } catch { return { ok: false, reason: "無 QA 記錄" }; }
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
  const unitGreen = opts.lastTestRunGreen !== false; // 全套綠 → unit 證據成立

  const features = [];
  for (const f of changedFeatures) {
    let sevInfo = sevMap.get(String(f.id)) || { severity: null, source: "none", raw: null };
    // 第三層 fallback：即時 deterministic 構成面掃描（零 token、idempotent、不寫檔）
    if (!sevInfo.severity) {
      try {
        const scan = await scanFeatureRisk(projectPath, sevInfo.raw || f);
        if (scan?.computedSeverity) sevInfo = { severity: scan.computedSeverity, source: "auto", raw: sevInfo.raw };
      } catch { /* 掃描失敗從嚴 S1（evidenceGaps 防禦） */ }
    }
    const sev = sevInfo.severity;
    const ev = {
      unit: f.hasTests
        ? { ok: unitGreen, tests: f.tests?.length || 0 }
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
      severitySource: sevInfo.source, // human（人覆寫）| ai | scan | auto（即時掃描）
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
    sgScan: scan ? { scannedAt: scan.scannedAt, total: scan.findings.length, high: scan.findings.filter(x => x.severity === "ERROR").length } : null,
    reviewBoard: board ? { latest: { at: board.latest.at, decision: board.latest.decision, models: board.latest.reviewers }, total: board.reports.length } : null,
  };
  return { features, summary };
}

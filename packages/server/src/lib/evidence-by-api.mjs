/**
 * evidence-by-api.mjs — API-first Evidence Matrix（deterministic 證據彙整）
 *
 * 2026-11-07 Fleming v3：審 API 不審 feature；窗口 = baseline commit 之後的變更（無 since = 全部 API）
 * 2026-11-21 Fleming：Evidence Matrix 是 Release Info 的一部分 → 抽成 lib，Release Info 產生時一起快照版控
 *   （matrix-v{N}.json 跟 info-v{N}.json / bundle-v{N}.json 同版號）
 */

import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { buildChangeIntelligence } from "./change-intelligence.mjs";
import { isTestFileName as isTestFileNameM } from "./cu-source-scan.mjs";

export function apiE2eCoverageChecker(root) {
  let corpus = null;
  const build = () => {
    let buf = "";
    const TEST_DIR = new Set(["tests", "test", "e2e", "__tests__"]);
    const SKIP = new Set(["node_modules", "dist", "build", "coverage", "versions", "raw", "crops", ".paaw"]);
    const isTestFile = (n) => { try { return isTestFileNameM(n); } catch { return /\.(test|spec)\.[cm]?[jt]sx?$/.test(n) || /^test[-_]/.test(n); } };
    const walk = (dir, depth) => {
      if (depth > 5) return;
      let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
        const p2 = join(dir, e.name);
        if (e.isDirectory()) walk(p2, depth + 1);
        else if (isTestFile(e.name) || dir.split(/[\\/]/).some((seg2) => TEST_DIR.has(seg2))) {
          try { const c = readFileSync(p2, "utf-8"); if (c.length < 500000) buf += "\n" + c; } catch {}
        }
      }
    };
    walk(root, 0);
    return buf;
  };
  return (apiPath) => {
    if (!apiPath) return false;
    if (corpus === null) corpus = build();
    const segs = apiPath.replace(/\/+$/, "").split("/").filter(Boolean);
    // 路徑參數段：支援三種寫法 — :id（Express）、<id>（Flask）、{id}（Java MockMvc/JAX-RS 字面 placeholder）
    // 2026-11-07 修：corpus 裡的 {ownerId} 字面 placeholder 也算命中（[^/]+ 匹配不到大括號字面值，petclinic E2E 全滅的根因）
    const segPattern = (seg) => {
      if (seg.startsWith(":") || /^\{[^}/]+\}$/.test(seg) || /^<[^/>]+>$/.test(seg)) return "(?:[^/\"'`{}]|\\{[^}/]+\\})+"; // 實值 或 字面 {param}
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    };
    const tryMatch = (k) => {
      const suffix = segs.slice(-k);
      if (suffix.some((s) => s.startsWith(":") || /^\{[^}/]+\}$/.test(s) || /^<[^/>]+>$/.test(s))) return false; // 含參數段的後綴不做降級比對（[^/]+ 太寬會誤中）
      const re = new RegExp("(?:^|[\\/\"'`\\s({])" + suffix.map(segPattern).join("/") + "(?:/|\\b)"); // nosemgrep: detect-non-literal-regexp
      return re.test(corpus);
    };
    // 1) 全路徑比對（參數段接受實值或字面 placeholder）
    const fullRe = new RegExp("^/?" + segs.map(segPattern).join("/") + "/?$"); // nosemgrep: detect-non-literal-regexp
    // 全路徑需在 corpus 中以片段出現（非行首），改用無錨點版本
    const fullRe2 = new RegExp("(?:^|[\\/\"'`\\s({])" + segs.map(segPattern).join("/") + "/?(?:$|[\\s\"'`})]|\\b)"); // nosemgrep: detect-non-literal-regexp
    if (fullRe2.test(corpus) || fullRe.test(corpus)) return true;
    // 2) 2026-11-07 修：變數組路徑（FastAPI f"{settings.API_V1_STR}/items/"）— 字面前綴不在 corpus，
    //    降級用「後綴」比對（最長 2+ 段、全字面），例如 /items/、users/me
    for (let k = segs.length - 1; k >= 2; k--) if (tryMatch(k)) return true;
    return false;
  };
}

/** 產生 Evidence Matrix（by API）。回傳物件與舊 route 回應相同（ok/anchor/summary/apis…） */
export async function buildEvidenceByApi(projectPath, { sinceSha = null } = {}) {
  const root = resolve(projectPath);
const { readApiFeatures } = await import("./coding-db/reads.mjs");
const { loadSecurityScan, sgForFeature, loadReviewBoard } = await import("./release-evidence.mjs");
const apis = readApiFeatures(root);
const { data: ci } = await buildChangeIntelligence(projectPath, sinceSha ? { fromSha: sinceSha, maxCommits: 300 } : { maxCommits: 300 });
const commits = ci?.commits || []; // 新 → 舊，含 files（注意：此處 commit 只有完整 hash，short 自切）
const fileCommits = new Map(); // file → [short...]（新→舊）
for (const c of commits) {
  const short = String(c.hash || "").slice(0, 7);
  for (const f of c.files || []) {
    const norm = String(f).replace(/\\/g, "/");
    if (!fileCommits.has(norm)) fileCommits.set(norm, []);
    fileCommits.get(norm).push(short);
  }
}
// SG（file-level — 與 feature 版同掃描源）
let scan = null; try { scan = await loadSecurityScan(projectPath); } catch { /* 未掃 → null 如實回 */ }
// Code Review 委員會紀錄（2026-11-07 Fleming：by API — 掃過該 API 檔案的會議次數 + 最新一次時間/結論）
let board = null; try { board = await loadReviewBoard(projectPath); } catch { /* 無紀錄 → null */ }
// QA 記錄（2026-11-07 Fleming：by API — apis[] 明標優先，fallback target/url/summary 文字含 API path）
let qaAll = []; try { const { listQaResults } = await import("./qa-results.mjs"); qaAll = listQaResults(projectPath, { limit: 500 }); } catch { /* 無 → 空 */ }
const _pathOf = (entry) => String(entry).trim().split(/\s+/).pop() || String(entry).trim();
const _normLower = (s) => String(s).replace(/\\/g, "/").toLowerCase();
// e2e 內容覆蓋（共用 helper）
const apiCovered = apiE2eCoverageChecker(root);
// 2026-11-22 Fleming：Unit Test 證據要有 pass/total + coverage rate（不只 ✓N 檔案數）
let testRun = null, coverage = null;
try { const { readLastTestRun } = await import("./test-runner.mjs"); const rec = readLastTestRun(root); if (rec) testRun = { id: rec.id || null, status: rec.status || null, at: rec.finishedAt || null, passed: rec.summary?.passed ?? null, failed: rec.summary?.failed ?? null, skipped: rec.summary?.skipped ?? null, total: rec.summary?.total ?? null }; } catch { /* 無紀錄 → null 如實回 */ }
try { const { testReportSummary } = await import("./test-report-reader.mjs"); const tr = testReportSummary(root); const cov = tr.mergedCoverage || tr.coverage?.[0] || null; coverage = { linePct: cov?.totalLinePct ?? null, measured: cov?.totalLinePct != null, at: cov?.at ?? cov?.sources?.[0]?.at ?? null, merged: !!cov?.merged, sources: cov?.sources ?? [] }; } catch { /* 無 report → 未量測如實回 */ }
const rows = [];
for (const a of apis) {
  const files = (a.codeFiles || []).map((f) => String(f).replace(/\\/g, "/"));
  const touched = [...new Set(files.flatMap((f) => fileCommits.get(f) || []))];
  if (sinceSha && !touched.length) continue; // 只有選 baseline commit 才過濾；HEAD = 全部 API 不 by 時間
  const sg = sgForFeature(scan, files);
  const reviews = (board?.reports || []).filter((r) => {
    const scope = (r.scopeFiles?.length ? r.scopeFiles : r.findingFiles || []).map((f) => String(f).replace(/\\/g, "/").replace(/^\.\//, ""));
    return scope.some((f) => files.includes(f));
  }).map((r) => ({ at: r.at, decision: r.decision }));
  // QA 記錄 by API（新→舊，取前 5 筆明細；count 為全部）
  const apiPathLower = _normLower(_pathOf(a.entry));
  const qaHits = qaAll.filter((r) => {
    if ((r.apis || []).some((x) => _normLower(x) === _normLower(a.entry) || _normLower(_pathOf(x)) === apiPathLower)) return true;
    if (apiPathLower.length < 3) return false; // 太短（如 "/"）不做文字比對，免全match
    const hay = `${r.target || ""} ${r.url || ""} ${r.summary || ""} ${(r.evidence || []).join(" ")}`.toLowerCase();
    return hay.includes(apiPathLower);
  });
  const qaLatest = qaHits[0] || null;
  rows.push({
    entry: a.entry, name: a.name, category: a.category, files,
    commits: touched, commitCount: touched.length,
    reviews, reviewCount: reviews.length, latestReviewAt: reviews.filter((r) => r.at).map((r) => r.at).sort().pop() || null,
    qa: {
count: qaHits.length,
latestAt: qaLatest?.ts || null,
latestVerdict: qaLatest?.verdict || null,
latestActor: qaLatest?.actor || null,
items: qaHits.slice(0, 5).map((r) => ({ at: r.ts, verdict: r.verdict, actor: r.actor, summary: String(r.summary || "").slice(0, 80), id: r.id })),
    },
    tests: (a.tests || []).map((x) => (typeof x === "string" ? x : x?.file)).filter(Boolean),
    e2eCovered: apiCovered(a.entry),
    sg: { ok: sg.ok, high: sg.high ?? 0, total: sg.total ?? 0, reason: sg.reason || null },
  });
}
  return {
    ok: true, sinceSha: sinceSha || null, anchor: sinceSha ? `${sinceSha.slice(0, 7)}..HEAD` : "all",
    commitsInWindow: commits.length,
    summary: {
      changedApis: rows.length,
      withTests: rows.filter((r) => r.tests.length > 0).length,
      e2eCovered: rows.filter((r) => r.e2eCovered).length,
      sgHigh: rows.filter((r) => !r.sg.ok).length,
      withReview: rows.filter((r) => r.reviewCount > 0).length,
      withQa: rows.filter((r) => r.qa.count > 0).length,
      qaLatestFail: rows.filter((r) => r.qa.latestVerdict && r.qa.latestVerdict !== "pass").length,
      sgScannedAt: scan?.scannedAt || null,
      testRun, coverage,
    },
    apis: rows, generatedAt: new Date().toISOString(),
  };
}

/**
 * release-unit/analyze.mjs — 深度分析（Code Health 2.0）
 *
 * 組合五種靜態訊號 → health score（0-100）+ 風險清單（附建議）：
 *   1. .paaw 知識庫完整度（5 大文件）
 *   2. metrics（複雜度熱點 / 巨型檔 / 測試比）
 *   3. 依賴圖（樞紐檔集中度 / 孤兒檔）
 *   4. verify-last（上次驗證結果 + 新鮮度）
 *   5. git（dirty 檔數 / 最後 commit 年齡）
 *
 * 零 LLM 成本 — 全部靜態規則（總計畫 §9）。
 */

import { existsSync } from "fs";
import { join } from "path";
import { readFile } from "fs/promises";
import { computeMetrics } from "./metrics.mjs";
import { buildDependencyGraph } from "./dependencies.mjs";
import { readLastVerify } from "./verify.mjs";
import { shellExec } from "../shell-exec.mjs";
import { safeResolve } from "../coding-security";

const PAAW_DOCS = ["PROJECT.md", "ARCHITECTURE.md", "CODING-STANDARDS.md", "DECISIONS.md", "CHANGELOG.md"];

async function gitInfo(root) {
  const out = { branch: null, dirtyFiles: null, lastCommitAt: null, lastCommitMsg: null };
  const run = async (cmd) => {
    try {
      const { stdout } = await shellExec(cmd, { cwd: root, timeout: 10_000, maxBuffer: 1e6 });
      return (stdout || "").trim();
    } catch { return null; }
  };
  out.branch = await run("git rev-parse --abbrev-ref HEAD");
  const st = await run("git status --porcelain");
  if (st !== null) out.dirtyFiles = st ? st.split("\n").filter(Boolean).length : 0;
  const log = await run('git log -1 --format="%aI|||%s"');
  if (log) {
    const [date, ...msg] = log.split("|||");
    out.lastCommitAt = date;
    out.lastCommitMsg = msg.join("|||").slice(0, 120);
  }
  return out;
}

/**
 * 深度分析
 * @returns { score, grade, risks: [{id, severity, title, detail, suggestion}], signals: {...} }
 */
export async function analyzeUnit(root, opts = {}) {
  const risks = [];

  // ── 1. .paaw 完整度 ──  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
  const paawDir = join(root, ".paaw");
  const missingDocs = [];  // nosemgrep: path-join-resolve-traversal
  for (const doc of PAAW_DOCS) {  // nosemgrep: path-join-resolve-traversal
    const found = existsSync(safeResolve(paawDir, doc))
      || (doc === "CODING-STANDARDS.md" && existsSync(safeResolve(paawDir, "project", doc)));
    if (!found) missingDocs.push(doc);
  }
  if (!existsSync(paawDir)) {
    risks.push({ id: "paaw-missing", severity: "high", title: "沒有 .paaw 知識庫",
      detail: "AI 派工前缺 context（架構/規範/決策），改壞風險高",
      suggestion: "先跑 Code Understanding 初始化 .paaw/" });
  } else if (missingDocs.length >= 3) {
    risks.push({ id: "paaw-incomplete", severity: "medium", title: `.paaw 缺 ${missingDocs.length} 份核心文件`,
      detail: `缺：${missingDocs.join(", ")}`,
      suggestion: "補齊核心文件（PROJECT / ARCHITECTURE / CODING-STANDARDS / DECISIONS / CHANGELOG）" });
  }

  // ── 2+3. metrics + graph（並行） ──
  const [metrics, graph, git] = await Promise.all([
    computeMetrics(root, opts),
    buildDependencyGraph(root, opts),
    gitInfo(root),
  ]);

  if (metrics.totalFiles > 0 && metrics.testRatio < 0.03) {
    risks.push({ id: "low-test-ratio", severity: metrics.testRatio === 0 ? "high" : "medium",
      title: `測試比偏低（${(metrics.testRatio * 100).toFixed(1)}%）`,
      detail: `${metrics.testFiles} 個測試檔 / ${metrics.totalFiles} 個原始碼檔`,
      suggestion: "核心模組先補測試（目標 ≥5%），verify 才有意義" });
  }
  const worstComplex = metrics.complex?.[0];
  if (worstComplex && worstComplex.complexity > 400) {
    risks.push({ id: "complexity-hotspot", severity: "medium", title: `複雜度熱點：${worstComplex.file}`,
      detail: `complexity ${worstComplex.complexity}（${worstComplex.loc} 行，密度 ${worstComplex.perLoc}）`,
      suggestion: "拆分此檔案 — 高複雜度檔是回歸熱區" });
  }
  if (metrics.longFiles >= 5) {
    risks.push({ id: "long-files", severity: "low", title: `${metrics.longFiles} 個檔案超過 500 行`,
      detail: "最大：" + (metrics.largest?.[0]?.file || "?"),
      suggestion: "巨型檔逐步拆模組" });
  }

  const hubEntries = Object.entries(graph.rdeps || {})
    .map(([f, d]) => ({ file: f, dependents: d.length }))
    .sort((a, b) => b.dependents - a.dependents);
  if (hubEntries[0]?.dependents > 40) {
    risks.push({ id: "hub-concentration", severity: "medium", title: `樞紐檔被過度依賴：${hubEntries[0].file}`,
      detail: `${hubEntries[0].dependents} 個檔案依賴它 — 一動全專案震動`,
      suggestion: "評估拆介面 / 分層，降低單點耦合" });
  }

  // ── 4. verify-last ──
  const lastVerify = await readLastVerify(root);
  let verifyAgeHours = null;
  if (lastVerify?.generatedAt) {
    verifyAgeHours = +((Date.now() - new Date(lastVerify.generatedAt).getTime()) / 3600_000).toFixed(1);
  }
  if (!lastVerify) {
    risks.push({ id: "never-verified", severity: "low", title: "還沒跑過 verify",
      detail: "沒有 build/test 基準線", suggestion: "POST /api/ru/verify 建立基準" });
  } else if (lastVerify.overall === "fail") {
    risks.push({ id: "verify-fail", severity: "high", title: "上次 verify 失敗",
      detail: `失敗關卡：${(lastVerify.checks || []).filter(c => !c.ok).map(c => c.check).join(", ")}`,
      suggestion: "先修紅燈再開新工" });
  } else if (verifyAgeHours > 72) {
    risks.push({ id: "verify-stale", severity: "low", title: `verify 結果過期（${verifyAgeHours}h 前）`,
      suggestion: "重跑 verify 保持基準新鮮" });
  }

  // ── 5. git ──
  if (git.dirtyFiles > 20) {
    risks.push({ id: "dirty-tree", severity: "medium", title: `${git.dirtyFiles} 個未 commit 檔案`,
      detail: "local fix 沒 push = 別人跑舊碼",
      suggestion: "小步 commit + push（同步紀律）" });
  }

  // ── 計分 ──
  const W = { high: 18, medium: 8, low: 3 };
  const score = Math.max(0, 100 - risks.reduce((s, r) => s + (W[r.severity] || 5), 0));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";

  return {
    root: String(root),
    generatedAt: new Date().toISOString(),
    score,
    grade,
    risks: risks.sort((a, b) => (W[b.severity] - W[a.severity])),
    signals: {
      paaw: { initialized: existsSync(paawDir), missingDocs },
      metrics: {
        totalFiles: metrics.totalFiles, totalLoc: metrics.totalLoc,
        testRatio: metrics.testRatio, longFiles: metrics.longFiles,
      },
      graph: { fileCount: graph.fileCount, topHub: hubEntries[0] || null },
      verify: lastVerify ? { overall: lastVerify.overall, ran: lastVerify.ran, ageHours: verifyAgeHours } : null,
      git,
    },
    meta: { fromCache: { metrics: metrics.fromCache || false, graph: graph.fromCache || false } },
  };
}

/**
 * CU 機械層重掃 — Code Understanding 的免 token 部分
 *
 * 機械層 = 不用 LLM、秒級、輸出是 code 的純函數（delete-and-insert 全量覆蓋）：
 *   - code-intelligence  (tree-sitter: call graph / dependency graph / symbol index)
 *   - test-intelligence  (靜態測試對應分析)
 *   - change-intelligence(git log 統計)
 *
 * 觸發點：
 *   1. POST /api/coding-project/cu-rescan-mechanical — 手動（EM Dashboard「⚡ 重掃機械層」）
 *   2. coding-tasks :id/git/commit 成功後 — 自動（fire-and-forget）
 *
 * 智能層（architecture / api-spec / feature-map…）是 LLM 生成，永遠不在此自動重跑。
 */

import { join } from "path";
import { createPaawProject } from "./paaw-project.mjs";
import { buildCodeIntelligence } from "./code-intelligence.mjs";
import { buildTestIntelligence } from "./test-intelligence.mjs";
import { buildChangeIntelligence } from "./change-intelligence.mjs";

// In-flight lock — 同一專案不並發重掃（commit hook 高頻觸發時 dedupe）
const inFlight = new Map();

export async function rescanMechanicalLayer(projectRoot, paawRoot) {
  const root = projectRoot;
  if (inFlight.get(root)) return { skipped: true, reason: "already running" };
  inFlight.set(root, true);
  const t0 = Date.now();
  const results = {};
  try {
    const paaw = createPaawProject(root);

    // 1. Code Intelligence
    try {
      const { summary } = await buildCodeIntelligence(root, paawRoot);
      results["code-intelligence"] = {
        ok: true,
        summary: `${summary.callGraph?.totalFunctions ?? 0} functions, ${summary.dependencyGraph?.totalEdges ?? 0} deps`,
      };
      await paaw.setCuStepStatus("code-intelligence", "done", { summary: `${summary.callGraph?.totalFunctions ?? 0} functions` });
    } catch (e) {
      results["code-intelligence"] = { ok: false, error: e.message };
    }

    // 2. Test Intelligence
    try {
      const { summary } = await buildTestIntelligence(root, paawRoot);
      results["test-intelligence"] = {
        ok: true,
        summary: `${summary.totalTestFiles ?? 0} test files, ${summary.coverageRate ?? "N/A"} coverage`,
      };
      await paaw.setCuStepStatus("test-intelligence", "done", { summary: `${summary.totalTestFiles ?? 0} tests` });
    } catch (e) {
      results["test-intelligence"] = { ok: false, error: e.message };
    }

    // 3. Change Intelligence（git based — 無 git 的專案自動 skip）
    try {
      const { summary } = await buildChangeIntelligence(root, { days: 30, maxCommits: 50 });
      results["change-intelligence"] = {
        ok: true,
        summary: `${summary?.totalCommits ?? 0} commits (30d)`,
      };
      await paaw.setCuStepStatus("change-intelligence", "done", { summary: `${summary?.totalCommits ?? 0} commits` });
    } catch (e) {
      results["change-intelligence"] = { ok: false, error: e.message };
    }

    return { ok: true, durationMs: Date.now() - t0, results };
  } finally {
    inFlight.delete(root);
  }
}

/**
 * coding-evidence.test.mjs — Evidence Package 單元測試
 *
 * 測 classifyRisk 風險分類 + Trust Score 計分（純函數）。
 * gatherTaskEvidence / gatherPlanEvidence 涉及 fs/git，用 tPAAW 自身的
 * .paaw 真實資料做整合驗證（repo 內一定有 TASKS.json）。
 */
import { describe, it, expect } from "vitest";
import { classifyRisk, gatherTaskEvidence, computeTrustScore, TRUST_MAX } from "../../packages/server/src/routes/coding-evidence.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

describe("classifyRisk", () => {
  it("security 關鍵字 → high", () => {
    expect(classifyRisk("fix security vulnerability XSS injection")).toEqual({ category: "securityFix", level: "high" });
  });
  it("breaking 關鍵字 → high", () => {
    expect(classifyRisk("remove api / breaking change")).toEqual({ category: "breakingChange", level: "high" });
  });
  it("refactor → medium", () => {
    expect(classifyRisk("refactor rename utils folder")).toEqual({ category: "refactor", level: "medium" });
  });
  it("tests/docs → low", () => {
    expect(classifyRisk("add unit test for parser").category).toBe("tests");
    expect(classifyRisk("update readme docs").category).toBe("docs");
    expect(classifyRisk("add unit test for parser").level).toBe("low");
  });
  it("一般功能 → feature/low", () => {
    expect(classifyRisk("增加 Task 管理功能列表")).toEqual({ category: "feature", level: "low" });
  });
  it("空字串安全", () => {
    expect(classifyRisk("")).toEqual({ category: "feature", level: "low" });
    expect(classifyRisk(null)).toEqual({ category: "feature", level: "low" });
  });
});

describe("gatherTaskEvidence（整合,讀 repo 真實 TASKS.json）", () => {
  it("task 存在 → 完整 evidence 結構", async () => {
    const tasksFile = join(ROOT, ".paaw", "tasks", "TASKS.json");
    if (!existsSync(tasksFile)) return; // CI 環境沒有 .paaw 就 skip
    const { readFile } = await import("node:fs/promises");
    const data = JSON.parse(await readFile(tasksFile, "utf-8"));
    const first = data.tasks?.[0];
    if (!first) return;
    const ev = await gatherTaskEvidence(ROOT, first.id);
    expect(ev.taskId).toBe(first.id);
    expect(ev.risk).toHaveProperty("level");
    // QA C2：不硬綁 items 數量（違反行為測試）。改驗證每項都有滿分定義 + 分數在範圍內。
    expect(ev.trustScore.score).toBeGreaterThanOrEqual(0);
    expect(ev.trustScore.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(ev.trustScore.items)).toBe(true);
    for (const it of ev.trustScore.items) {
      expect(it.max).toBeGreaterThan(0);
      expect(it.score).toBeGreaterThanOrEqual(0);
      expect(it.score).toBeLessThanOrEqual(it.max);
    }
    expect(ev.trustScore.items.map(i => i.name)).toContain("pipeline");
    expect(ev.generatedAt).toBeTruthy();
  });

  it("task 不存在 → null（不丟例外）", async () => {
    const ev = await gatherTaskEvidence(ROOT, "TASK-NOT-EXIST-999");
    expect(ev).toBeNull();
  });
});


describe("computeTrustScore（純函數 — QA C1/C2）", () => {
  const emptyRisk = { category: "feature", level: "low" };

  it("C1：分母固定 — scope 有無不改變滿分總和 105", () => {
    const noScope = computeTrustScore({ pipeline: null, testResult: null, qaResult: null, risk: emptyRisk, diffStat: null, reviewBoundary: null });
    const withScope = computeTrustScore({
      pipeline: null, testResult: null, qaResult: null, risk: emptyRisk, diffStat: null,
      reviewBoundary: { hasScope: true, summary: { unexpected: 0 } },
    });
    expect(noScope.maxTotal).toBe(105);
    expect(withScope.maxTotal).toBe(105);
    expect(noScope.items.reduce((s, i) => s + i.max, 0)).toBe(105);
    expect(withScope.items.reduce((s, i) => s + i.max, 0)).toBe(105);
  });

  it("C1：多加一項合格證據不會讓分數下降（越有證據越高分）", () => {
    const base = { pipeline: null, testResult: null, qaResult: null, risk: emptyRisk, diffStat: null };
    const before = computeTrustScore({ ...base, reviewBoundary: null }); // scope 缺 → 0 分
    const after = computeTrustScore({ ...base, reviewBoundary: { hasScope: true, summary: { unexpected: 0 } } }); // scope 合格 → +9
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("全綠滿分 → 100", () => {
    const pipeline = {};
    for (const ph of ["spec", "implement", "review", "test", "qa", "docs", "commit"]) pipeline[ph] = { status: "done" };
    const r = computeTrustScore({
      pipeline,
      testResult: { passed: 10, failed: 0 },
      qaResult: { status: "pass" },
      risk: emptyRisk,
      diffStat: { insertions: 50, deletions: 30 },
      reviewBoundary: { hasScope: true, summary: { unexpected: 0 } },
    });
    expect(r.score).toBe(100);
  });

  it("風險 high 降分；分數不低於 0", () => {
    const r = computeTrustScore({
      pipeline: null, testResult: null, qaResult: null,
      risk: { category: "securityFix", level: "high" },
      diffStat: null, reviewBoundary: null,
    });
    expect(r.score).toBe(0); // raw = -10 → clamp 0
    expect(r.riskPenalty).toBe(-10);
  });

  it("TRUST_MAX 常數總和 = 105", () => {
    expect(Object.values(TRUST_MAX).reduce((a, b) => a + b, 0)).toBe(105);
  });
});

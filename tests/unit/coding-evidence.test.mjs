/**
 * coding-evidence.test.mjs — Evidence Package 單元測試
 *
 * 測 classifyRisk 風險分類 + Trust Score 計分（純函數）。
 * gatherTaskEvidence / gatherPlanEvidence 涉及 fs/git，用 tPAAW 自身的
 * .paaw 真實資料做整合驗證（repo 內一定有 TASKS.json）。
 */
import { describe, it, expect } from "vitest";
import { classifyRisk, gatherTaskEvidence } from "../../packages/server/src/routes/coding-evidence.mjs";
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
    expect(ev.trustScore.score).toBeGreaterThanOrEqual(0);
    expect(ev.trustScore.score).toBeLessThanOrEqual(100);
    expect(ev.trustScore.items.length).toBe(4);
    expect(ev.generatedAt).toBeTruthy();
  });

  it("task 不存在 → null（不丟例外）", async () => {
    const ev = await gatherTaskEvidence(ROOT, "TASK-NOT-EXIST-999");
    expect(ev).toBeNull();
  });
});

/**
 * repair-loop.test.mjs — 方案 C 有界修復迴圈單元測試
 *
 * 核心：applyRepairLoopRule 純函數（advance API 內嵌的 server-side 規則）
 *   TEST fail → 自動退回 implement（repairTriggered）→ 3 輪後 needs_human
 * HTTP 層的 repair-loop/run 端點由 dev server 手動驗證（見 commit message）。
 */
import { describe, it, expect } from "vitest";
import { applyRepairLoopRule } from "../../packages/server/src/routes/coding-tasks.mjs";

function seedTask(extra = {}) {
  return {
    id: "TASK-RL001",
    title: "repair loop test task",
    type: "feature",
    status: "in-progress",
    pipeline: {
      spec: { status: "done" },
      implement: { status: "done" },
      review: { status: "done" },
      test: { status: "in_progress" },
      qa: { status: "pending" },
      docs: { status: "pending" },
      commit: { status: "pending" },
    },
    testResult: { passed: 8, failed: 2, testsWritten: [] },
    notes: [],
    ...extra,
  };
}

describe("方案 C：applyRepairLoopRule（bounded repair loop）", () => {
  it("TEST fail → 觸發修復第 1 輪，退回 implement", () => {
    const task = seedTask();
    const v = applyRepairLoopRule(task);
    expect(v.repairTriggered).toBe(true);
    expect(v.repairLoop.count).toBe(1);
    expect(v.repairLoop.max).toBe(3);
    expect(task.pipeline.test.status).toBe("rework");
    expect(task.pipeline.implement.status).toBe("in_progress");
    expect(task.notes.some(n => n.by === "repair-loop" && n.content.includes("1/3"))).toBe(true);
  });

  it("連續 3 輪都在上限內觸發修復", () => {
    const task = seedTask();
    for (let i = 1; i <= 3; i++) {
      const v = applyRepairLoopRule(task);
      expect(v.repairTriggered).toBe(true);
      expect(v.repairLoop.count).toBe(i);
    }
  });

  it("第 4 次（超過上限）→ needsHuman、test=needs_human", () => {
    const task = seedTask();
    for (let i = 0; i < 3; i++) applyRepairLoopRule(task);
    const v4 = applyRepairLoopRule(task);
    expect(v4.needsHuman).toBe(true);
    expect(v4.repairTriggered).toBeUndefined();
    expect(task.pipeline.test.status).toBe("needs_human");
    expect(task.notes.some(n => n.content.includes("exhausted"))).toBe(true);
  });

  it("TEST 全綠 → 放行（null），repairLoop 計數清零 + 記 note", () => {
    const task = seedTask({
      repairLoop: { count: 2, max: 3, history: [{ round: 1, passed: 8, failed: 2 }] },
      testResult: { passed: 10, failed: 0, testsWritten: [] },
    });
    const v = applyRepairLoopRule(task);
    expect(v).toBeNull();
    expect(task.repairLoop.count).toBe(0);
    expect(task.notes.some(n => n.content.includes("resolved after 2 round"))).toBe(true);
  });

  it("testResult 沒資料 → 放行（沒證據不擋）", () => {
    const task = seedTask({ testResult: null });
    expect(applyRepairLoopRule(task)).toBeNull();
  });

  it("failed=0 → 放行", () => {
    const task = seedTask({ testResult: { passed: 5, failed: 0, testsWritten: [] } });
    expect(applyRepairLoopRule(task)).toBeNull();
  });

  it("自訂 max 上限被尊重", () => {
    const task = seedTask({ repairLoop: { count: 0, max: 1, history: [] } });
    const v1 = applyRepairLoopRule(task);
    expect(v1.repairTriggered).toBe(true);
    const v2 = applyRepairLoopRule(task);
    expect(v2.needsHuman).toBe(true);
  });

  it("needs_human 後 downstream phase 重置 pending、qa/docs/commit 清乾淨", () => {
    const task = seedTask({
      repairLoop: { count: 3, max: 3, history: [] },
      pipeline: {
        spec: { status: "done" }, implement: { status: "done" }, review: { status: "done" },
        test: { status: "in_progress" }, qa: { status: "pending" }, docs: { status: "done" }, commit: { status: "done" },
      },
    });
    // count 已達上限 → 直接 escalate
    const v = applyRepairLoopRule(task);
    expect(v.needsHuman).toBe(true);
    // escalate 路徑不重置 downstream（needs_human 保持現場）— 但 rework 路徑會
    // 這裡驗 rework 路徑的 downstream 重置
    const t2 = seedTask({ pipeline: { spec: { status: "done" }, implement: { status: "done" }, review: { status: "done" }, test: { status: "in_progress" }, qa: { status: "done" }, docs: { status: "done" }, commit: { status: "done" } } });
    applyRepairLoopRule(t2);
    expect(t2.pipeline.qa.status).toBe("pending");
    expect(t2.pipeline.docs.status).toBe("pending");
    expect(t2.pipeline.commit.status).toBe("pending");
  });
});

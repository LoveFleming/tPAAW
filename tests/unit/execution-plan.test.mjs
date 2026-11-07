/**
 * Unit tests — Execution Plan
 *
 * Tests createPlan, getPlan, updateSubTask, getPlanSummary, getNextPendingSubTask,
 * markPlanStarted, markPlanCompleted, listPlans, deletePlan from execution-plan.mjs.
 *
 * Each test uses a fresh temp directory to avoid cross-test contamination.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPlan,
  getPlan,
  updateSubTask,
  getPlanSummary,
  getNextPendingSubTask,
  markPlanStarted,
  markPlanCompleted,
  listPlans,
  deletePlan,
} from "../../packages/server/src/lib/execution-plan.mjs";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpRoot;

function makeTmpRoot() {
  return mkdtempSync(join(tmpdir(), "paaw-plan-test-"));
}

const sampleItems = [
  {
    title: "Set up database schema",
    assignee: "architect",
    source: "task_pipeline",
    sourceRef: "TASK-001",
    priority: "high",
    subtasks: [
      { title: "Design tables", assignee: "architect" },
      { title: "Write migrations", assignee: "developer" },
    ],
  },
  {
    title: "Implement auth API",
    assignee: "developer",
    source: "task_pipeline",
    sourceRef: "TASK-002",
    priority: "medium",
    subtasks: [
      { title: "Login endpoint", assignee: "developer" },
    ],
  },
];

describe("execution-plan", () => {
  beforeEach(() => {
    tmpRoot = makeTmpRoot();
  });

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // ── 1. createPlan ──
  it("createPlan creates a plan with correct structure", async () => {
    const plan = await createPlan({
      projectPath: tmpRoot,
      projectPhase: "mvp",
      mode: "em",
      items: sampleItems,
    });

    expect(plan.planId).toMatch(/^ns-\d{4}-\d{2}-\d{2}-/);
    expect(plan.projectPath).toBe(tmpRoot);
    expect(plan.projectPhase).toBe("mvp");
    expect(plan.mode).toBe("em");
    expect(plan.status).toBe("created");
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].taskId).toBe("ST-001");
    expect(plan.tasks[0].subtasks).toHaveLength(2);
    expect(plan.tasks[0].subtasks[0].subtaskId).toBe("ST-001.01");
    expect(plan.tasks[0].subtasks[0].status).toBe("pending");
    expect(plan.summary.totalTasks).toBe(2);
    expect(plan.summary.totalSubtasks).toBe(3);
    expect(plan.summary.completed).toBe(0);
  });

  it("createPlan throws if projectPath is missing", async () => {
    await expect(createPlan({})).rejects.toThrow(/projectPath required/i);
  });

  it("createPlan works with empty items", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: [] });
    expect(plan.tasks).toHaveLength(0);
    expect(plan.summary.totalSubtasks).toBe(0);
  });

  // ── 2. getPlan ──
  it("getPlan reads back the created plan", async () => {
    const created = await createPlan({
      projectPath: tmpRoot,
      items: sampleItems,
    });
    const fetched = await getPlan(tmpRoot, created.planId);
    expect(fetched).toBeTruthy();
    expect(fetched.planId).toBe(created.planId);
    expect(fetched.tasks).toHaveLength(2);
  });

  it("getPlan returns null for non-existent plan", async () => {
    const result = await getPlan(tmpRoot, "nonexistent-plan");
    expect(result).toBeNull();
  });

  // ── 3. updateSubTask ──
  it("updateSubTask updates sub-task status", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    const updated = await updateSubTask(tmpRoot, plan.planId, "ST-001.01", {
      status: "done",
      completedAt: new Date().toISOString(),
      result: "Tables designed",
    });
    const st = updated.tasks[0].subtasks[0];
    expect(st.status).toBe("done");
    expect(st.result).toBe("Tables designed");
  });

  it("updateSubTask throws for non-existent subtask", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    await expect(
      updateSubTask(tmpRoot, plan.planId, "ST-999.99", { status: "done" })
    ).rejects.toThrow(/Sub-task not found/i);
  });

  it("updateSubTask auto-computes duration", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    const startedAt = "2026-01-01T10:00:00.000Z";
    const completedAt = "2026-01-01T11:30:00.000Z";
    const updated = await updateSubTask(tmpRoot, plan.planId, "ST-001.01", {
      status: "done",
      startedAt,
      completedAt,
    });
    const st = updated.tasks[0].subtasks[0];
    expect(st.durationMs).toBe(90 * 60 * 1000); // 1.5 hours
  });

  // ── 4. getPlanSummary ──
  it("getPlanSummary returns correct progress", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    await updateSubTask(tmpRoot, plan.planId, "ST-001.01", { status: "done" });
    await updateSubTask(tmpRoot, plan.planId, "ST-001.02", { status: "fail", error: "oops" });

    const summary = await getPlanSummary(tmpRoot, plan.planId);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.totalSubtasks).toBe(3);
    expect(summary.tasks).toHaveLength(2);
  });

  it("getPlanSummary returns null for non-existent plan", async () => {
    const summary = await getPlanSummary(tmpRoot, "no-such-plan");
    expect(summary).toBeNull();
  });

  // ── 5. getNextPendingSubTask ──
  it("getNextPendingSubTask returns first pending subtask", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    await updateSubTask(tmpRoot, plan.planId, "ST-001.01", { status: "done" });

    const next = await getNextPendingSubTask(tmpRoot, plan.planId);
    expect(next).toBeTruthy();
    expect(next.subtask.subtaskId).toBe("ST-001.02");
    expect(next.subtask.status).toBe("pending");
  });

  it("getNextPendingSubTask returns null when all done", async () => {
    const plan = await createPlan({
      projectPath: tmpRoot,
      items: [{ title: "T", subtasks: [{ title: "S" }] }],
    });
    await updateSubTask(tmpRoot, plan.planId, "ST-001.01", { status: "done" });
    const next = await getNextPendingSubTask(tmpRoot, plan.planId);
    expect(next).toBeNull();
  });

  // ── 6. markPlanStarted ──
  it("markPlanStarted sets status to running", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    const started = await markPlanStarted(tmpRoot, plan.planId);
    expect(started.status).toBe("running");
    expect(started.startedAt).toBeTruthy();
  });

  // ── 7. markPlanCompleted ──
  it("markPlanCompleted sets status to completed", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    // Mark all subtasks done
    await updateSubTask(tmpRoot, plan.planId, "ST-001.01", { status: "done" });
    await updateSubTask(tmpRoot, plan.planId, "ST-001.02", { status: "done" });
    await updateSubTask(tmpRoot, plan.planId, "ST-002.01", { status: "done" });

    const completed = await markPlanCompleted(tmpRoot, plan.planId);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
  });

  // ── 8. listPlans ──
  it("listPlans returns all plans", async () => {
    await createPlan({ projectPath: tmpRoot, items: sampleItems });
    await createPlan({ projectPath: tmpRoot, items: [{ title: "T3" }] });
    // Note: planId is deterministic based on date+project name, so both createPlan
    // calls produce the same planId. The second overwrites the first.
    // That's by design (one plan per project per day).
    const plans = await listPlans(tmpRoot);
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans[0].planId).toBeTruthy();
    expect(plans[0].status).toBeTruthy();
  });

  it("listPlans returns empty array for dir with no plans", async () => {
    const plans = await listPlans(tmpRoot);
    expect(plans).toEqual([]);
  });

  // ── 9. deletePlan ──
  it("deletePlan removes the plan file", async () => {
    const plan = await createPlan({ projectPath: tmpRoot, items: sampleItems });
    const result = await deletePlan(tmpRoot, plan.planId);
    expect(result).toBe(true);
    const fetched = await getPlan(tmpRoot, plan.planId);
    expect(fetched).toBeNull();
  });

  it("deletePlan throws for non-existent plan", async () => {
    await expect(deletePlan(tmpRoot, "no-such-plan")).rejects.toThrow(/Plan not found/i);
  });
});

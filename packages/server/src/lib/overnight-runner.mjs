// Overnight AI batch runner for Task Pipeline
// Manages overnight batch execution of tasks assigned to ai_overnight

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PIPELINE_ORDER = ["implement", "test", "qa", "docs"];

export class OvernightRunner {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.tasksFile = join(projectPath, ".paaw", "tasks", "TASKS.json");
    this.resultsDir = join(projectPath, ".paaw", "tasks", "overnight-results");
  }

  async _loadTasks() {
    if (!existsSync(this.tasksFile)) return [];
    try {
      const data = JSON.parse(await readFile(this.tasksFile, "utf-8"));
      return Array.isArray(data.tasks) ? data.tasks : [];
    } catch {
      return [];
    }
  }

  async _saveTasks(tasks) {
    const dir = join(this.projectPath, ".paaw", "tasks");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(
      this.tasksFile,
      JSON.stringify({ tasks, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
  }

  async _saveResult(result) {
    if (!existsSync(this.resultsDir)) await mkdir(this.resultsDir, { recursive: true });
    const filename = `overnight-${new Date().toISOString().slice(0, 10)}.json`;
    await writeFile(join(this.resultsDir, filename), JSON.stringify(result, null, 2), "utf-8");
  }

  /**
   * Get tonight's queue — tasks with pipeline phases assigned to ai_overnight and pending.
   * Returns { implement: [], test: [], qa: [], docs: [] }
   */
  async getQueue() {
    const tasks = await this._loadTasks();
    const queue = { implement: [], test: [], qa: [], docs: [] };

    for (const task of tasks) {
      if (!task.pipeline) continue;
      for (const phase of PIPELINE_ORDER) {
        const p = task.pipeline[phase];
        if (p && p.status === "pending" && p.assignTo === "ai_overnight") {
          queue[phase].push({
            id: task.id,
            title: task.title,
            type: task.type,
            phase,
            spec: task.spec,
            changes: task.changes,
            git: task.git,
          });
        }
      }
    }
    return queue;
  }

  /**
   * Get last overnight results (today or yesterday).
   */
  async getLastResults() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    for (const date of [today, yesterday]) {
      try {
        const filepath = join(this.resultsDir, `overnight-${date}.json`);
        if (existsSync(filepath)) {
          return JSON.parse(await readFile(filepath, "utf-8"));
        }
      } catch {}
    }
    return null;
  }

  /**
   * Run a single phase for a task (simulated for now).
   * Actual AI agent execution will be integrated later.
   */
  async _runPhase(task, phase) {
    const now_iso = new Date().toISOString();

    // Mark in-progress
    task.pipeline[phase].status = "in_progress";
    task.pipeline[phase].at = now_iso;

    // Save intermediate state
    const allTasks = await this._loadTasks();
    const idx = allTasks.findIndex((x) => x.id === task.id);
    if (idx >= 0) {
      allTasks[idx] = task;
      await this._saveTasks(allTasks);
    }

    // Placeholder: actual AI agent execution will be integrated later
    const result = {
      phase,
      taskId: task.id,
      status: "simulated",
      runAt: now_iso,
      message: `Overnight AI processed ${phase} for ${task.id}`,
    };

    switch (phase) {
      case "implement":
        result.message = `Implement phase: simulated. Real AI integration pending.`;
        break;
      case "test":
        task.testResult = {
          testsWritten: [],
          passed: 0,
          failed: 0,
          coverage: "0%",
          coverageGaps: [],
          runAt: now_iso,
          runBy: "ai_overnight",
        };
        result.message = `Test phase: simulated. Real AI integration pending.`;
        break;
      case "qa":
        task.qaResult = {
          autoChecks: [],
          overall: "pending",
          runAt: now_iso,
          runBy: "ai_overnight",
        };
        break;
      case "docs":
        task.docsResult = {
          files: [],
          generatedAt: now_iso,
          reviewedBy: null,
        };
        break;
    }

    task.pipeline[phase].status = "done";
    task.pipeline[phase].by = "ai_overnight";
    task.pipeline[phase].at = now_iso;

    return result;
  }

  /**
   * Run the full overnight batch.
   * Processes all pending ai_overnight tasks in pipeline order:
   * all implements first, then tests, then qa, then docs.
   */
  async run() {
    const startTime = new Date();
    const tasks = await this._loadTasks();
    const results = [];

    // Collect all pending overnight tasks
    const toProcess = [];
    for (const task of tasks) {
      if (!task.pipeline) continue;
      for (const phase of PIPELINE_ORDER) {
        const p = task.pipeline[phase];
        if (p && p.status === "pending" && p.assignTo === "ai_overnight") {
          toProcess.push({ task, phase });
        }
      }
    }

    if (toProcess.length === 0) {
      const summary = {
        runDate: startTime.toISOString(),
        completedAt: new Date().toISOString(),
        totalProcessed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        message: "No pending overnight tasks found.",
      };
      await this._saveResult(summary);
      return summary;
    }

    // Process in pipeline order: all implements first, then tests, then qa, then docs
    for (const phase of PIPELINE_ORDER) {
      const phaseTasks = toProcess.filter((x) => x.phase === phase);
      for (const { task } of phaseTasks) {
        try {
          const result = await this._runPhase(task, phase);
          results.push(result);
        } catch (err) {
          results.push({
            taskId: task.id,
            phase,
            status: "failed",
            error: err.message,
            runAt: new Date().toISOString(),
          });
          if (task.pipeline[phase]) {
            task.pipeline[phase].status = "needs_human";
            task.pipeline[phase].error = err.message;
          }
        }
      }
    }

    // Save all tasks (final state)
    await this._saveTasks(tasks);

    // Save results summary
    const summary = {
      runDate: startTime.toISOString(),
      completedAt: new Date().toISOString(),
      totalProcessed: results.length,
      succeeded: results.filter((r) => r.status !== "failed").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
    await this._saveResult(summary);

    return summary;
  }
}

export default OvernightRunner;

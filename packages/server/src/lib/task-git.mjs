// packages/server/src/lib/task-git.mjs
// Git operations for Task Pipeline
// Uses child_process exec (cross-platform safe)

import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

export class TaskGit {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  // Get diff for a task's files vs base commit
  async getDiff(task) {
    const files = [
      ...(task.changes?.filesAdded || []),
      ...(task.changes?.filesModified || []),
    ].filter(Boolean);
    if (files.length === 0) return "";
    const fileList = files.map(f => `"${f}"`).join(" ");
    try {
      // First try diff against base commit
      const baseCmd = task.git?.baseCommit
        ? `git diff ${task.git.baseCommit} -- ${fileList}`
        : `git diff -- ${fileList}`;
      const { stdout } = await execAsync(baseCmd, { cwd: this.projectPath, maxBuffer: 2 * 1024 * 1024 });
      // Also check for untracked files
      let untrackedDiff = "";
      for (const f of (task.changes?.filesAdded || [])) {
        try {
          const { stdout: st } = await execAsync(`git status --porcelain -- "${f}"`, { cwd: this.projectPath });
          if (st.startsWith("??")) {
            // untracked file - just show it's new
            untrackedDiff += `\n+++ ${f} (new file)\n`;
          }
        } catch {}
      }
      return stdout + untrackedDiff;
    } catch (e) {
      return `(unable to get diff: ${e.message})`;
    }
  }

  // Stage a task's files
  async stage(task) {
    const files = [
      ...(task.changes?.filesAdded || []),
      ...(task.changes?.filesModified || []),
    ].filter(Boolean);
    const staged = [];
    for (const f of files) {
      try {
        await execAsync(`git add "${f}"`, { cwd: this.projectPath });
        staged.push(f);
      } catch (e) {
        console.error(`[task-git] stage failed for ${f}:`, e.message);
      }
    }
    return { staged, count: staged.length };
  }

  // Commit staged files
  async commit(task, message, push = false) {
    // Backup branch first
    const backupName = `backup/${task.id}-${Date.now()}`;
    try {
      await execAsync(`git branch "${backupName}"`, { cwd: this.projectPath });
    } catch (e) {
      // branch creation might fail if already on it, that's ok
    }

    // Commit
    const escapedMsg = message.replace(/"/g, '\\"');
    const { stdout } = await execAsync(
      `git commit -m "${escapedMsg}"`,
      { cwd: this.projectPath, maxBuffer: 2 * 1024 * 1024 }
    );

    // Get SHA
    const { stdout: shaOut } = await execAsync("git rev-parse --short HEAD", { cwd: this.projectPath });
    const sha = shaOut.trim();

    // Push
    let pushed = false;
    if (push) {
      try {
        await execAsync("git push", { cwd: this.projectPath, timeout: 30000 });
        pushed = true;
      } catch (e) {
        console.error(`[task-git] push failed:`, e.message);
      }
    }

    return { sha, backupBranch: backupName, pushed, commitOutput: stdout };
  }

  // Restore (undo) a task's changes
  async restore(task) {
    const modified = (task.changes?.filesModified || []).filter(Boolean);
    const deleted = (task.changes?.filesDeleted || []).filter(Boolean);
    const restored = [];
    for (const f of [...modified, ...deleted]) {
      try {
        await execAsync(`git checkout -- "${f}"`, { cwd: this.projectPath });
        restored.push(f);
      } catch (e) {
        console.error(`[task-git] restore failed for ${f}:`, e.message);
      }
    }
    return { restored, count: restored.length };
  }

  // Get current HEAD short SHA
  async getHeadSha() {
    try {
      const { stdout } = await execAsync("git rev-parse --short HEAD", { cwd: this.projectPath });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  // Generate commit message from task data
  static generateCommitMessage(task) {
    const typeMap = {
      feature: "feat", bugfix: "fix", bug: "fix",
      refactor: "refactor", test: "test", docs: "docs", chore: "chore",
      requirement: "feat", security: "fix",
    };
    const type = typeMap[task.type] || "chore";
    const scope = task.changes?.filesModified?.[0]?.split(/[\\/]/)[0] || "";
    
    let msg = `${type}${scope ? `(${scope})` : ""}: ${task.title} (${task.id})\n\n`;
    
    if (task.spec?.description) {
      msg += `- ${task.spec.description}\n`;
    }
    
    if (task.changes?.diffStat) {
      msg += `- Changes: ${task.changes.diffStat}\n`;
    }
    
    if (task.testResult) {
      const { passed = 0, failed = 0 } = task.testResult;
      msg += `- Tests: ${passed} passed${failed > 0 ? `, ${failed} failed` : ""}\n`;
    }
    
    if (task.qaResult?.overall) {
      msg += `- QA: ${task.qaResult.overall}\n`;
    }
    
    msg += `\nPipeline: all phases completed\n`;
    if (task.source?.type) {
      msg += `Source: ${task.source.type}\n`;
    }
    
    return msg;
  }
}

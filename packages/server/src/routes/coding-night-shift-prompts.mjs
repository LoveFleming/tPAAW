/**
 * coding-night-shift-prompts.mjs — Night Shift Prompts API
 *
 * GET  /api/coding-night-shift/prompts     — 取得所有 agent prompts
 * POST /api/coding-night-shift/prompts     — 更新 prompt（body: { role, task } 或整包 { architect: {...}, ... }）
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBody } from './shared.mjs';

const DEFAULT_PROMPTS = {
  architect: {
    crewId: "coding.architect",
    task: "## Night Shift Task: Architecture Review\n\nToday's git changes:\n```\n{{gitLog}}\n```\n\nChanged files:\n{{changedFiles}}\n\nCurrent features:\n{{featuresSummary}}\n\n## Your Tasks\n1. Review today's architecture changes — are there any design concerns?\n2. Check if any decisions need to be recorded as ADRs\n3. If you see important decisions, use record_decision to log them\n4. Update ARCHITECTURE.md if the architecture changed (use update_docs)\n5. Summarize your findings briefly\n\nUse your tools (project_context, project_decisions, read_file) to understand the codebase.\nWrite your findings to .paaw/night-shift/architect-report.md using write_file.",
  },
  developer: {
    crewId: "coding.developer",
    task: "## Night Shift Task: Build & Fix\n\nToday's changed files:\n{{changedFiles}}\n\n## Your Tasks\n1. Run the build: `cd packages/ui && npx vite build` and `cd packages/server && node --check src/paaw-server.mjs`\n2. If build fails, fix the errors\n3. Run lint if available\n4. Update feature mapping for any files you changed (use project_feature_update_mapping)\n5. Commit and push any fixes with message \"fix(night-shift): build/lint fixes\"\n\nUse bash for commands, write_file/edit_file for fixes.\nWrite a summary to .paaw/night-shift/developer-report.md using write_file.",
  },
  tester: {
    crewId: "coding.tester",
    task: "## Night Shift Task: Test Coverage\n\nChanged files:\n{{changedFiles}}\n\nCurrent features:\n{{featuresSummary}}\n\n## Your Tasks\n1. Check if there are existing tests for the changed files\n2. Identify changed features that lack test coverage\n3. Write basic tests for critical new functionality\n4. Run existing tests to check for regressions\n5. Report test results\n\nUse read_file, grep, glob to explore tests. Use write_file to create new tests.\nWrite a summary to .paaw/night-shift/tester-report.md using write_file.",
  },
  "doc-writer": {
    crewId: "coding.doc-writer",
    task: "## Night Shift Task: Documentation Update\n\nToday's changes:\n```\n{{gitLog}}\n```\n\nChanged files:\n{{changedFiles}}\n\nCurrent features:\n{{featuresSummary}}\n\n## Your Tasks\n1. Update CHANGELOG.md with today's changes (use update_changelog)\n2. For each changed feature, update its documentation (use project_feature_update_docs)\n3. Update any README or inline docs that reference changed APIs\n4. Check if PROJECT.md needs updating\n\nUse project_feature_detail to see current docs, project_feature_update_docs to update.\nWrite a summary to .paaw/night-shift/doc-writer-report.md using write_file.",
  },
  qa: {
    crewId: "coding.qa",
    task: "## Night Shift Task: Code Review\n\nToday's changes:\n```\n{{gitLog}}\n```\n\nChanged files:\n{{changedFiles}}\n\n## Your Tasks\n1. Read each changed file and review for:\n   - Potential bugs (null checks, error handling, race conditions)\n   - Security issues (input validation, injection risks)\n   - Performance concerns\n   - Code style consistency\n2. For each issue found, create an issue using the issues API pattern (write to .paaw/issues/)\n3. Record your findings\n\nUse read_file, grep to review code. Use action_log_add to log findings.\nWrite a summary to .paaw/night-shift/qa-report.md using write_file.",
  },
  helpdesk: {
    crewId: "coding.helpdesk",
    task: "## Night Shift Task: HelpDesk & FAQ Update\n\nChanged files:\n{{changedFiles}}\n\n## Your Tasks\n1. Check for any new error patterns in the changed code\n2. Update FAQ if new features were added that users might ask about\n3. Check .paaw/issues/ for any new issues — summarize them\n4. Update known issues list if needed\n\nUse project_issues to list issues. Use read_file to check specs.\nWrite a summary to .paaw/night-shift/helpdesk-report.md using write_file.",
  },
};

async function getPromptsFile(rootDir) {
  const promptsPath = join(rootDir, '.paaw', 'night-shift', 'prompts.json');
  if (!existsSync(promptsPath)) return DEFAULT_PROMPTS;
  try {
    const raw = await readFile(promptsPath, 'utf-8');
    return { ...DEFAULT_PROMPTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROMPTS;
  }
}

export default async function nightShiftPromptsRoutes(req, res) {
  const url = req.url || '';
  const urlObj = new URL(url, 'http://localhost');
  const rootDir = urlObj.searchParams.get('path') || process.env.PAAW_ROOT || process.cwd();

  // GET /api/coding-night-shift/prompts
  if (req.method === 'GET' && urlObj.pathname === '/api/coding-night-shift/prompts') {
    try {
      const prompts = await getPromptsFile(rootDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(prompts));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // POST /api/coding-night-shift/prompts
  // Body: { role: "tester", task: "new prompt..." } — 更新單一
  // Body: { architect: {...}, tester: {...} } — 更新整包
  if (req.method === 'POST' && urlObj.pathname === '/api/coding-night-shift/prompts') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const existing = await getPromptsFile(rootDir);

      let updated;
      if (body.role && body.task !== undefined) {
        // Single role update
        updated = { ...existing, [body.role]: { ...existing[body.role], task: body.task } };
      } else {
        // Full overwrite (merge)
        updated = { ...existing, ...body };
      }

      const promptsPath = join(rootDir, '.paaw', 'night-shift', 'prompts.json');
      const { mkdir } = await import('node:fs/promises');
      const dir = join(rootDir, '.paaw', 'night-shift');
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      await writeFile(promptsPath, JSON.stringify(updated, null, 2), 'utf-8');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, prompts: updated }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  // POST /api/coding-night-shift/prompts/reset
  if (req.method === 'POST' && urlObj.pathname === '/api/coding-night-shift/prompts/reset') {
    try {
      const promptsPath = join(rootDir, '.paaw', 'night-shift', 'prompts.json');
      await writeFile(promptsPath, JSON.stringify(DEFAULT_PROMPTS, null, 2), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, prompts: DEFAULT_PROMPTS }));
      return true;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return true;
    }
  }

  return false;
}

// Export for night-shift.mjs to import
export { getPromptsFile };

/**
 * orchestrator.mjs — Developer Agent Orchestrator
 *
 * Developer = AI + Domain Tools + Domain Context + Prompts + Agent Loop
 *
 * Phase 0: L1 事實注入（給 AI 真實的 codebase context）
 * Phase 1: Plan（AI 輸出結構化計劃，硬驗證）
 * Phase 2: Execute（AI 寫碼，每次寫入 pre/post hook）
 * Phase 3: Verify（build + type + test 全專案驗證）
 * Phase 4: Handoff（結構化報告 + commit + push）
 *
 * Usage:
 *   import { runDeveloper } from './agents/developer/orchestrator.mjs';
 *   const result = await runDeveloper({
 *     task: '把 Submit 按鈕改成 送出',
 *     projectRoot: '/path/to/project',
 *     model: 'deepseek/deepseek-v4-flash',
 *   });
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

import { detectLanguages, LANGUAGE_PROFILES, getAllSourceExtensions, isTestFile } from './language-profiles.mjs';
import { checkWriteAllowed, checkDeleteAllowed, checkBashAllowed } from './pre-hooks.mjs';
import { verifyAfterWrite, verifyProject } from './post-hooks.mjs';

// ─── Constants ─────────────────────────────────────────────────

const MAX_PLAN_RETRIES = 3;
const MAX_VERIFY_RETRIES = 3;
const MAX_EXECUTE_TURNS = 40;     // 最多 40 輪 AI 行動
const COMMIT_PREFIX = 'dev(priya)';

// ─── Phase 0: L1 事實注入 ──────────────────────────────────────

async function gatherDeveloperContext(projectRoot, projectLangs) {
  const ctx = {
    languages: projectLangs,
    languageLabels: projectLangs.map(l => LANGUAGE_PROFILES[l]?.label).filter(Boolean),
    files: [],
    features: null,
    apiRoutes: [],
    git: null,
    codingStandards: null,
  };

  // ① 掃描 source files
  ctx.files = await scanProjectFiles(projectRoot);
  ctx.fileCount = ctx.files.length;

  // ② Feature Map
  const featuresPath = join(projectRoot, '.paaw', 'features', 'FEATURES.json');
  if (existsSync(featuresPath)) {
    try {
      ctx.features = JSON.parse(await readFile(featuresPath, 'utf-8'));
    } catch { /* skip */ }
  }

  // ③ API Routes
  ctx.apiRoutes = extractRoutes(projectRoot);

  // ④ Git 狀態
  try {
    const status = execSync('git status --porcelain', { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
    const diffStat = execSync('git diff --stat', { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
    ctx.git = {
      status: status.trim().split('\n').filter(Boolean),
      diffStat: diffStat.trim(),
    };
  } catch { /* not a git repo */ }

  // ⑤ Coding Standards
  for (const csPath of [
    join(projectRoot, '.paaw', 'project', 'CODING-STANDARDS.md'),
    join(projectRoot, '.paaw', 'CODING-STANDARDS.md'),
    join(projectRoot, 'CODING-STANDARDS.md'),
  ]) {
    if (existsSync(csPath)) {
      try {
        ctx.codingStandards = (await readFile(csPath, 'utf-8')).slice(0, 2000);
      } catch { /* skip */ }
      break;
    }
  }

  return ctx;
}

function buildSystemPrompt(ctx, task) {
  const parts = [];

  // 角色設定
  parts.push(`你是全端開發工程師 (Developer)，名叫普里亞·夏爾馬 (Priya Sharma)。

## 你的職責
1. **功能實作** — 根據需求實作新功能、API、UI 組件
2. **Bug 修復** — 排查、定位、修復程式 bug
3. **重構** — 改善程式碼結構，不改變外部行為
4. **程式碼品質** — 遵守 CODING-STANDARDS

## 護欄（硬限制，不可違反）
- ❌ 不寫測試檔案（由 Tester Divya 負責）
- ❌ 不修改 .paaw/ 設定
- ❌ 不修改 CI/CD、Docker、nginx 設定
- ❌ 不修改 .env 檔案
- ❌ 不執行 git reset --hard、rm -rf、DROP TABLE

## 工作紀律
1. 先讀再寫 — 修改前先理解現有程式碼
2. 小步前進 — 一次改一個邏輯單元
3. 改完碼一定要確認 build 通過`);

  // 專案語言
  if (ctx.languageLabels.length > 0) {
    parts.push(`## 專案語言\n${ctx.languageLabels.join(', ')}`);
  }

  // 檔案清單（按目錄分組，避免太長）
  if (ctx.files.length > 0) {
    const grouped = groupFilesByDir(ctx.files);
    const fileList = Object.entries(grouped)
      .map(([dir, files]) => `${dir}/ (${files.length} files)`)
      .join('\n');
    parts.push(`## 專案檔案結構（${ctx.fileCount} 個 source files）\n${fileList}`);
  }

  // Feature Map 摘要
  if (ctx.features?.features) {
    const featList = ctx.features.features.map(f =>
      `- ${f.id}: ${f.name} (${(f.codeFiles || []).length} files)`
    ).join('\n');
    parts.push(`## Feature Map\n${featList}`);
  }

  // API Routes
  if (ctx.apiRoutes.length > 0) {
    const routeList = ctx.apiRoutes.slice(0, 30).map(r => `${r.method} ${r.path}`).join('\n');
    parts.push(`## 現有 API Routes（共 ${ctx.apiRoutes.length} 個）\n${routeList}`);
  }

  // Git 狀態
  if (ctx.git?.status?.length > 0) {
    parts.push(`## 目前 Git 狀態\n${ctx.git.status.join('\n')}`);
  }

  // Coding Standards
  if (ctx.codingStandards) {
    parts.push(`## Coding Standards（摘要）\n${ctx.codingStandards}`);
  }

  return parts.join('\n\n---\n\n');
}

// ─── Phase 1: Plan ─────────────────────────────────────────────

async function generatePlan(llm, systemPrompt, task, ctx) {
  const planPrompt = `## 需求
${task}

## 你的任務
分析這個需求，產出實作計劃。你必須輸出 JSON 格式（不要 markdown code fence）：

{
  "summary": "一句話說明要做什麼",
  "approach": "簡述實作策略",
  "files": [
    { "path": "相對路徑", "action": "create|modify|delete", "reason": "為什麼" }
  ],
  "risks": ["可能影響到的模組"]
}

注意：
- path 必須是專案裡真實存在的檔案（modify/delete）或合理的新路徑（create）
- 只列出你「打算」要改的檔案，不是所有相關的檔案
- 如果需求很簡單（例如改一個 label），files 可能只有 1 個
`;

  const body = {
    model: llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: planPrompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  };

  const result = await llm.call(body);
  const parsed = parseJSON(result);
  if (!parsed) return null;

  // 硬驗證：plan 裡的檔案存在嗎？
  const validated = validatePlan(parsed, ctx.files, ctx.projectRoot);
  return validated;
}

function validatePlan(plan, allFiles, projectRoot) {
  if (!plan || !plan.files) return null;

  for (const f of plan.files) {
    if (f.action === 'modify' || f.action === 'delete') {
      const exists = allFiles.includes(f.path) ||
                     allFiles.includes(f.path.replace(/^\.\//, ''));
      if (!exists) {
        return { ...plan, _warning: `Plan references non-existent file: ${f.path}` };
      }
    }
  }

  return plan;
}

// ─── Phase 2: Execute ──────────────────────────────────────────

async function executeTask(llm, systemPrompt, task, plan, ctx, projectRoot, onProgress) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildExecutePrompt(task, plan, ctx) },
  ];

  const plannedFiles = (plan?.files || []).map(f => f.path);
  const changedFiles = [];
  const log = [];
  let turns = 0;

  while (turns < MAX_EXECUTE_TURNS) {
    turns++;
    if (onProgress) onProgress({ phase: 'execute', turn: turns, changedFiles });

    // AI 決定下一步
    const body = {
      model: llm.model,
      messages: [...messages],
      temperature: 0.2,
      max_tokens: 4000,
    };

    const response = await llm.call(body);
    if (!response) {
      messages.push({ role: 'user', content: 'LLM 回應為空。請用 TOOL: 格式回覆。' });
      continue;
    }

    // DEBUG: log response to file for debugging
    if (process.env.DEV_ORCH_DEBUG) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync('/tmp/dev-orchestrator-debug.log',
        `\n=== Turn ${turns} ===\n${response.slice(0, 500)}\n`);
    }

    messages.push({ role: 'assistant', content: response });

    // 解析 AI 的 action
    const action = parseAction(response);
    if (!action) {
      // AI 沒有有效的 action，推一把
      messages.push({
        role: 'user',
        content: '請用 tool call 格式回覆。可用工具：write_file, edit_file, read_file, bash, done',
      });
      continue;
    }

    log.push({ turn: turns, action: action.type, detail: action });

    switch (action.type) {

      // ─── write_file ───
      case 'write_file': {
        const preCheck = checkWriteAllowed(action.path, projectRoot, { plannedFiles, projectLangs: ctx.languages });
        if (!preCheck.allowed) {
          messages.push({
            role: 'user',
            content: `❌ 拒絕寫入 ${action.path}: ${preCheck.reason}`,
          });
          continue;
        }

        // 執行寫入
        const fullPath = join(projectRoot, action.path);
        await writeFile(fullPath, action.content, 'utf-8');
        if (!changedFiles.includes(action.path)) changedFiles.push(action.path);

        // Post-hook 驗證
        const postCheck = await verifyAfterWrite(fullPath, projectRoot, ctx.languages);
        if (!postCheck.passed) {
          messages.push({
            role: 'user',
            content: `❌ 語法錯誤 in ${action.path}:\n${postCheck.errors.join('\n')}\n\n請修復後重新寫入。`,
          });
          continue;
        }

        messages.push({
          role: 'user',
          content: `✅ 寫入成功: ${action.path}`,
        });
        break;
      }

      // ─── edit_file ───
      case 'edit_file': {
        const preCheck = checkWriteAllowed(action.path, projectRoot, { plannedFiles, projectLangs: ctx.languages });
        if (!preCheck.allowed) {
          messages.push({
            role: 'user',
            content: `❌ 拒絕修改 ${action.path}: ${preCheck.reason}`,
          });
          continue;
        }

        // 執行 edit（用 replace）
        const fullPath = join(projectRoot, action.path);
        const original = await readFile(fullPath, 'utf-8');
        const updated = applyEdit(original, action.oldText, action.newText);
        if (updated === null) {
          messages.push({
            role: 'user',
            content: `❌ 找不到要替換的文字 in ${action.path}。請確認 oldText 是否準確。`,
          });
          continue;
        }

        await writeFile(fullPath, updated, 'utf-8');
        if (!changedFiles.includes(action.path)) changedFiles.push(action.path);

        // Post-hook 驗證
        const postCheck = await verifyAfterWrite(fullPath, projectRoot, ctx.languages);
        if (!postCheck.passed) {
          messages.push({
            role: 'user',
            content: `❌ 語法錯誤 in ${action.path}:\n${postCheck.errors.join('\n')}\n\n請修復。`,
          });
          continue;
        }

        messages.push({
          role: 'user',
          content: `✅ 修改成功: ${action.path}`,
        });
        break;
      }

      // ─── read_file ───
      case 'read_file': {
        const fullPath = join(projectRoot, action.path);
        if (!existsSync(fullPath)) {
          messages.push({
            role: 'user',
            content: `❌ 檔案不存在: ${action.path}`,
          });
          continue;
        }
        try {
          let content = await readFile(fullPath, 'utf-8');
          
          // Support START/END line range
          if (action.startLine || action.endLine) {
            const allLines = content.split('\n');
            const start = (action.startLine || 1) - 1;
            const end = action.endLine || allLines.length;
            content = allLines.slice(start, end).join('\n');
          }
          
          // Truncate large files (but allow up to 8000 chars for code reading)
          const MAX = 8000;
          const truncated = content.length > MAX ? content.slice(0, MAX) + '\n...(truncated, use START/END to read more)' : content;
          messages.push({
            role: 'user',
            content: `📄 ${action.path}${action.startLine ? `:${action.startLine}-${action.endLine || ''}` : ''}:\n\`\`\`\n${truncated}\n\`\`\``,
          });
        } catch (err) {
          messages.push({ role: 'user', content: `❌ 讀取失敗: ${err.message}` });
        }
        break;
      }

      // ─── bash ───
      case 'bash': {
        const bashCheck = checkBashAllowed(action.command);
        if (!bashCheck.allowed) {
          messages.push({
            role: 'user',
            content: `❌ 拒絕執行命令: ${bashCheck.reason}`,
          });
          continue;
        }

        try {
          const output = execSync(action.command, {
            cwd: projectRoot, timeout: 30000, encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const truncated = output.length > 3000 ? output.slice(0, 3000) + '\n...(truncated)' : output;
          messages.push({
            role: 'user',
            content: `$ ${action.command}\n${truncated}`,
          });
        } catch (err) {
          const output = (err.stdout || err.stderr || err.message || '').slice(0, 2000);
          messages.push({
            role: 'user',
            content: `$ ${action.command}\n❌ Exit ${err.status || '?'}\n${output}`,
          });
        }
        break;
      }

      // ─── done ───
      case 'done': {
        return { changedFiles, log, completed: true, turns };
      }

      default:
        messages.push({
          role: 'user',
          content: `未知 action: ${action.type}。可用：write_file, edit_file, read_file, bash, done`,
        });
    }
  }

  // 超過上限
  return { changedFiles, log, completed: false, turns, reason: 'Exceeded max turns' };
}

function buildExecutePrompt(task, plan, ctx) {
  const planSummary = plan ? `已批准的計劃：
${JSON.stringify(plan, null, 2)}` : '直接執行需求。';

  return `## 需求
${task}

## 計劃
${planSummary}

## 執行規則

你必須用以下格式回覆（每次只做一個操作）。

### 寫入新檔案或完整覆蓋
\`\`\`
TOOL: write_file
PATH: packages/ui/src/pages/Example.tsx
\`\`\`file
檔案完整內容
\`\`\`

### 修改現有檔案的一部分
\`\`\`
TOOL: edit_file
PATH: packages/ui/src/pages/Example.tsx
OLD:
\`\`\`
要替換的原文
\`\`\`
NEW:
\`\`\`
替換後的新文
\`\`\`

### 讀取檔案
\`\`\`
TOOL: read_file
PATH: packages/ui/src/pages/Example.tsx
\`\`\`

### 執行命令
\`\`\`
TOOL: bash
CMD: npm run build
\`\`\`

### 完成
\`\`\`
TOOL: done
SUMMARY: 完成說明
\`\`\`

⚠️ 重要：每次回覆必須以 \`TOOL: \` 開頭。不要解釋你要做什麼，直接做。
開始執行。`;
}

// ─── Phase 3: Verify ───────────────────────────────────────────

async function verifyChanges(projectRoot, projectLangs, changedFiles, plan) {
  // ① 整體 build + type + test
  const projectCheck = await verifyProject(projectRoot, projectLangs);

  // ② Plan 對比
  let planMatch = true;
  const planFiles = (plan?.files || []).map(f => f.path);
  const unexpected = changedFiles.filter(f => !planFiles.includes(f) && !planFiles.includes('./' + f));
  const missing = planFiles.filter(f => !changedFiles.includes(f) && !changedFiles.includes(f.replace(/^\.\//, '')));
  if (unexpected.length > 0 || missing.length > 0) planMatch = false;

  // ③ Git diff stats
  let linesAdded = 0;
  let linesRemoved = 0;
  try {
    const diffStat = execSync('git diff --shortstat', { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
    const addMatch = diffStat.match(/(\d+) insertion/);
    const delMatch = diffStat.match(/(\d+) deletion/);
    if (addMatch) linesAdded = parseInt(addMatch[1]);
    if (delMatch) linesRemoved = parseInt(delMatch[1]);
  } catch { /* not git */ }

  return {
    ...projectCheck,
    planMatch,
    unexpectedFiles: unexpected,
    missingFiles: missing,
    linesAdded,
    linesRemoved,
  };
}

// ─── Phase 4: Handoff ──────────────────────────────────────────

async function createHandoff(task, changedFiles, verifyResult, plan, guardrailReport) {
  const allPassed = verifyResult.buildPassed && verifyResult.testPassed;

  return {
    status: allPassed ? 'completed' : 'failed',
    task,
    filesChanged: changedFiles,
    linesAdded: verifyResult.linesAdded || 0,
    linesRemoved: verifyResult.linesRemoved || 0,
    buildPassed: verifyResult.buildPassed,
    testsPassed: verifyResult.testPassed,
    typeCheckPassed: verifyResult.typePassed ?? true,
    planMatch: verifyResult.planMatch,
    warnings: [
      ...(verifyResult.unexpectedFiles?.length > 0 ? [`改了不在 plan 裡的檔案: ${verifyResult.unexpectedFiles.join(', ')}`] : []),
      ...(verifyResult.missingFiles?.length > 0 ? [`plan 裡的檔案未修改: ${verifyResult.missingFiles.join(', ')}`] : []),
    ],
    errors: verifyResult.buildPassed ? [] : ['Build failed'],
    readyFor: allPassed ? suggestNextSteps(changedFiles, task) : [],
    commitHash: '', // filled after commit
    guardrail: guardrailReport,
  };
}

function suggestNextSteps(changedFiles, task) {
  const steps = [];
  // 如果改了邏輯相關的 code，建議 Tester
  if (changedFiles.some(f => /\.(mjs|js|ts|py|java|go|rs)$/.test(f))) {
    steps.push('tester');
  }
  // 如果改了很多檔案，建議 QA
  if (changedFiles.length >= 3) {
    steps.push('qa');
  }
  return steps;
}

async function commitAndPush(projectRoot, task, handoff) {
  if (handoff.filesChanged.length === 0) return '';

  try {
    // Stage changed files
    for (const f of handoff.filesChanged) {
      execSync(`git add "${f}"`, { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
    }

    // Commit
    const msg = `${COMMIT_PREFIX}: ${task.slice(0, 72)}\n\n` +
      `Files: ${handoff.filesChanged.length}\n` +
      `Build: ${handoff.buildPassed ? '✅' : '❌'}\n` +
      `Tests: ${handoff.testsPassed ? '✅' : '❌'}\n` +
      `Plan match: ${handoff.planMatch ? '✅' : '⚠️'}`;

    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
      cwd: projectRoot, encoding: 'utf-8', timeout: 15000,
    });

    // Get hash
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: projectRoot, encoding: 'utf-8',
    }).trim();

    // Push
    try {
      execSync('git push', { cwd: projectRoot, encoding: 'utf-8', timeout: 30000 });
    } catch { /* push might fail if no remote, that's OK */ }

    return hash;
  } catch (err) {
    return '';
  }
}

// ─── 主入口 ────────────────────────────────────────────────────

/**
 * Run Developer Agent
 *
 * @param {{
 *   task: string,
 *   projectRoot: string,
 *   model?: string,
 *   modelOverride?: string,
 *   onProgress?: Function,
 *   skipCommit?: boolean,
 * }} opts
 * @returns {Promise<object>} Handoff report
 */
export async function runDeveloper(opts) {
  const {
    task,
    projectRoot,
    model: modelOverride,
    onProgress = null,
    skipCommit = false,
  } = opts;

  if (!task) throw new Error('task is required');
  if (!projectRoot) throw new Error('projectRoot is required');

  // ── Resolve LLM config ──
  // If model looks like "provider/model" where provider is a known provider,
  // pass as-is. Otherwise, pass null to use default model.
  const { resolveLLMConfig } = await import('../../paaw-agent-loop.mjs');
  const { callLLMWithRetry } = await import('../../llm-utils.mjs');

  // Read provider config to check known providers
  let knownProviders = [];
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const cfgPath = resolve(projectRoot, 'data/config/providers.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    knownProviders = Object.keys(cfg.providers || {});
  } catch { /* */ }

  let safeModelOverride = modelOverride;
  if (modelOverride && modelOverride.includes('/')) {
    const providerPart = modelOverride.split('/')[0];
    if (!knownProviders.includes(providerPart)) {
      // It's a model ID like "google/gemini-2.5-flash" for OpenRouter
      // Don't pass it as override — resolveLLMConfig would misparse it
      // Instead, let it use default and override the model field directly
      safeModelOverride = null;
    }
  }

  const llmConfig = resolveLLMConfig(projectRoot, safeModelOverride);

  // If we skipped override but have a model ID, use it directly
  const effectiveModel = (safeModelOverride ? llmConfig.model : (modelOverride || llmConfig.model || llmConfig.defaultModel));

  const llm = {
    model: effectiveModel,
    call: async (body) => {
      const result = await callLLMWithRetry(llmConfig.apiUrl, llmConfig.headers, body, {
        timeoutMs: 600_000,
        maxRetries: 3,
      });
      return result?.choices?.[0]?.message?.content || result?.content || null;
    },
  };

  // ── Phase 0: L1 事實注入 ──
  if (onProgress) onProgress({ phase: 'L1', status: 'gathering context' });
  const projectLangs = detectLanguages(projectRoot);
  const ctx = await gatherDeveloperContext(projectRoot, projectLangs);
  ctx.projectRoot = projectRoot;
  const systemPrompt = buildSystemPrompt(ctx, task);

  // ── Phase 1: Plan ──
  if (onProgress) onProgress({ phase: 'plan', status: 'generating plan' });
  let plan = null;
  for (let i = 0; i < MAX_PLAN_RETRIES; i++) {
    plan = await generatePlan(llm, systemPrompt, task, ctx);
    if (plan && !plan._warning) break;
    if (plan?._warning) {
      // Plan 有問題但可用，繼續
      break;
    }
  }

  // ── Phase 2: Execute ──
  if (onProgress) onProgress({ phase: 'execute', status: 'executing' });
  const execResult = await executeTask(llm, systemPrompt, task, plan, ctx, projectRoot, onProgress);

  // ── Phase 3: Verify ──
  if (onProgress) onProgress({ phase: 'verify', status: 'verifying' });
  let verifyResult = await verifyChanges(projectRoot, projectLangs, execResult.changedFiles, plan);

  // 如果 build/test 失敗，退回 Phase 2 修（最多 MAX_VERIFY_RETRIES 次）
  let verifyRetries = 0;
  while (!verifyResult.buildPassed && verifyRetries < MAX_VERIFY_RETRIES && execResult.completed) {
    verifyRetries++;
    if (onProgress) onProgress({ phase: 'verify-retry', attempt: verifyRetries });

    const fixPrompt = `Build 或 test 失敗了。\n\nBuild result:\n${JSON.stringify(verifyResult.details?.build || {}, null, 2)}\n\nTest result:\n${JSON.stringify(verifyResult.details?.test || {}, null, 2)}\n\n請修復問題。`;

    const fixResult = await executeTask(llm, systemPrompt, fixPrompt, plan, ctx, projectRoot, onProgress);
    execResult.changedFiles.push(...fixResult.changedFiles.filter(f => !execResult.changedFiles.includes(f)));
    verifyResult = await verifyChanges(projectRoot, projectLangs, execResult.changedFiles, plan);
  }

  // ── Phase 4: Handoff ──
  if (onProgress) onProgress({ phase: 'handoff', status: 'creating report' });
  const handoff = await createHandoff(task, execResult.changedFiles, verifyResult, plan, null);

  // Commit + push（除非 skipCommit）
  if (!skipCommit && handoff.filesChanged.length > 0) {
    const hash = await commitAndPush(projectRoot, task, handoff);
    handoff.commitHash = hash;
  }

  return handoff;
}

// ─── Helpers ───────────────────────────────────────────────────

async function scanProjectFiles(projectRoot) {
  const SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', 'data', 'temp', 'tmp',
    'audit', 'backups', '.paaw', 'coverage', '.cache', 'build',
  ]);
  const SOURCE_EXTS = new Set(getAllSourceExtensions());
  const results = [];

  async function walk(dir, depth = 0) {
    if (depth > 15) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else {
        if (SOURCE_EXTS.has(extname(entry.name))) {
          results.push(relative(projectRoot, full).replace(/\\/g, '/'));
        }
      }
    }
  }

  await walk(projectRoot);
  return results.sort();
}

function extractRoutes(projectRoot) {
  const routesDir = join(projectRoot, 'packages', 'server', 'src', 'routes');
  if (!existsSync(routesDir)) return [];
  try {
    const output = execSync(
      `grep -rn "app\\.\\(get\\|post\\|put\\|delete\\|patch\\|use\\)(" "${routesDir}" --include='*.mjs' --include='*.js' 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 }
    );
    const routes = [];
    for (const line of output.split('\n')) {
      const m = line.match(/app\.(get|post|put|delete|patch|use)\(\s*['"`]([^'"`]+)/);
      if (m) routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    return routes;
  } catch { return []; }
}

function groupFilesByDir(files) {
  const grouped = {};
  for (const f of files) {
    const parts = f.split('/');
    const dir = parts.length > 2 ? parts.slice(0, parts.length - 1).join('/') : parts[0];
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(f);
  }
  return grouped;
}

function parseJSON(text) {
  if (!text) return null;
  // Strip markdown code fences
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find JSON object in text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* */ }
    }
    return null;
  }
}

function parseAction(response) {
  if (!response || typeof response !== 'string') return null;
  // Strip leading markdown code fences if the whole response is fenced
  let text = response.trim();
  
  // Find TOOL: line anywhere in response
  const toolMatch = text.match(/^TOOL:\s*(\w+)/im) || text.match(/\nTOOL:\s*(\w+)/im);
  if (!toolMatch) {
    // Check if response contains natural language completion
    if (/^(DONE|COMPLETE|完成|我已經完成|修改完畢)/i.test(text.trim())) {
      return { type: 'done', summary: text.slice(0, 200) };
    }
    return null;
  }

  const type = toolMatch[1].toLowerCase();
  const lines = text.split('\n');
  const getVal = (key) => {
    const line = lines.find(l => new RegExp(`^${key}:`, 'i').test(l));
    return line ? line.replace(new RegExp(`^${key}:\\s*`, 'i'), '').trim() : null;
  };

  // Extract content between code fences (or until next TOOL:/KEY: line)
  const extractBlock = (startKey) => {
    const startIdx = lines.findIndex(l => new RegExp(`^${startKey}:`, 'i').test(l));
    if (startIdx === -1) return null;
    let content = [];
    let inFence = false;
    let foundFence = false;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('```')) {
        if (!inFence) { inFence = true; foundFence = true; continue; }
        else { break; }
      }
      if (inFence) {
        content.push(lines[i]);
      } else if (!foundFence) {
        // No fence — stop at next TOOL: or KEY: line
        if (/^TOOL:/.test(trimmed) || /^[A-Z]{3,}:/.test(trimmed)) break;
        content.push(lines[i]);
      }
    }
    return content.join('\n').trim();
  };

  switch (type) {
    case 'write_file':
      return {
        type: 'write_file',
        path: getVal('PATH'),
        content: extractBlock('CONTENT'),
      };

    case 'edit_file':
      return {
        type: 'edit_file',
        path: getVal('PATH'),
        oldText: extractBlock('OLD'),
        newText: extractBlock('NEW'),
      };

    case 'read_file':
      return {
        type: 'read_file',
        path: getVal('PATH'),
        startLine: getVal('START') ? parseInt(getVal('START')) : null,
        endLine: getVal('END') ? parseInt(getVal('END')) : null,
      };

    case 'bash':
      return {
        type: 'bash',
        command: getVal('CMD') || getVal('COMMAND'),
      };

    case 'done':
      return {
        type: 'done',
        summary: getVal('SUMMARY') || '',
      };

    default:
      return { type, raw: response.slice(0, 500) };
  }
}

function applyEdit(original, oldText, newText) {
  if (!oldText || !newText) return null;
  const idx = original.indexOf(oldText);
  if (idx === -1) return null;
  return original.slice(0, idx) + newText + original.slice(idx + oldText.length);
}

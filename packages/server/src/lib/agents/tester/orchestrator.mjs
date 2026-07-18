/**
 * orchestrator.mjs — Tester Agent Orchestrator
 *
 * Tester = AI + Domain Tools + Domain Context + Prompts + Agent Loop
 *
 * Phase 0: 讀取 Developer 交付的 source code + 理解要測什麼
 * Phase 1: Plan — 決定要寫哪些測試案例
 * Phase 2: Execute — 寫測試檔案（pre/post hook 確保只寫 test 檔案）
 * Phase 3: Verify — npm test / pytest / mvn test 真的跑一次
 * Phase 4: Handoff — 測試結果報告
 *
 * Usage:
 *   import { runTester } from './agents/tester/orchestrator.mjs';
 *   const result = await runTester({
 *     task: '為 POST /api/coding-export 寫測試',
 *     projectRoot: '/path/to/project',
 *     targetFiles: ['packages/server/src/routes/coding.mjs'],
 *   });
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

import { detectLanguages, LANGUAGE_PROFILES, getAllSourceExtensions } from './language-profiles.mjs';
import { checkWriteAllowed, checkBashAllowed } from './pre-hooks.mjs';
import { verifyAfterWrite, verifyTests } from './post-hooks.mjs';

const MAX_EXECUTE_TURNS = 30;
const COMMIT_PREFIX = 'test(divya)';

// ─── Phase 0: Context ──────────────────────────────────────────

async function gatherTesterContext(projectRoot, projectLangs, targetFiles) {
  const ctx = { languages: projectLangs, sourceCode: [], existingTests: [] };

  // ① 讀取目標 source code
  for (const f of targetFiles || []) {
    const fullPath = join(projectRoot, f);
    if (existsSync(fullPath)) {
      try {
        const content = await readFile(fullPath, 'utf-8');
        ctx.sourceCode.push({
          path: f,
          content: content.length > 8000 ? content.slice(0, 8000) + '\n...(truncated)' : content,
          lineCount: content.split('\n').length,
        });
      } catch { /* skip */ }
    }
  }

  // ② 掃描現有測試檔案
  ctx.existingTests = await scanTestFiles(projectRoot);

  // ③ Test runner
  const runner = LANGUAGE_PROFILES[projectLangs[0]];
  ctx.testRunner = runner?.testCmd?.() || 'npm test';

  return ctx;
}

function buildSystemPrompt(ctx, task) {
  const parts = [];

  parts.push(`你是測試工程師 (Tester)，名叫迪維雅·雷迪 (Divya Reddy)。

座右銘：Quality is not the last step, it's every step.

## 你的職責
1. **寫測試** — 根據 source code 寫單元測試、整合測試
2. **測試覆蓋** — 確保重要邏輯都有測試
3. **邊界案例** — 測試正常流程 + 邊界值 + 錯誤處理
4. **測試品質** — 測試要有意義，不只是 "expect(true).toBe(true)"

## 護欄（硬限制）
- ❌ 不修改原始碼（src/, routes/, lib/）
- ❌ 不安裝套件
- ❌ 不執行 build 或 deploy
- ✅ 只寫測試檔案（test/, *.test.*, *.spec.*）

## 測試原則
1. 測試行為，不測實作細節
2. 每個 test case 只測一件事
3. Arrange-Act-Assert 模式
4. 測試名稱要描述「做什麼 → 期望什麼」`);

  if (ctx.sourceCode.length > 0) {
    const codeSummary = ctx.sourceCode.map(s =>
      `### ${s.path} (${s.lineCount} lines)\n\`\`\`\n${s.content}\n\`\`\``
    ).join('\n\n');
    parts.push(`## 要測試的 Source Code\n${codeSummary}`);
  }

  if (ctx.existingTests.length > 0) {
    parts.push(`## 現有測試檔案\n${ctx.existingTests.map(t => `- ${t}`).join('\n')}`);
  }

  parts.push(`## Test Runner\n${ctx.testRunner}`);

  return parts.join('\n\n---\n\n');
}

// ─── Phase 1: Plan ─────────────────────────────────────────────

function buildPlanPrompt(task) {
  return `## 需求
${task}

## 你的任務
產出測試計劃 JSON（不要 markdown code fence）：

{
  "summary": "測試什麼",
  "testFiles": [
    { "path": "test/xxx.test.mjs", "framework": "node:test|jest|pytest", "cases": ["case1", "case2"] }
  ],
  "coverage": ["要覆蓋的函式或 API"]
}`;
}

// ─── Phase 2: Execute ──────────────────────────────────────────

function buildExecutePrompt(task, plan, ctx) {
  return `## 需求
${task}

## 測試計劃
${plan ? JSON.stringify(plan, null, 2) : '直接寫測試'}

## 執行規則

你必須用以下格式回覆（每次只做一個操作）。

### 寫入測試檔案
\`\`\`
TOOL: write_file
PATH: test/example.test.mjs
\`\`\`file
測試檔案內容
\`\`\`

### 讀取 source code（理解要測什麼）
\`\`\`
TOOL: read_file
PATH: packages/server/src/routes/coding.mjs
START: 100
END: 200
\`\`\`

### 跑測試
\`\`\`
TOOL: bash
CMD: npm test
\`\`\`

### 完成
\`\`\`
TOOL: done
SUMMARY: 寫了 3 個測試案例，全部通過
\`\`\`

⚠️ 只能寫測試檔案。不可修改原始碼。
開始執行。`;
}

// ─── Main Loop (shared structure with Developer) ───────────────

async function executeTask(llm, systemPrompt, executePrompt, projectRoot, projectLangs, onProgress) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: executePrompt },
  ];
  const changedFiles = [];
  const log = [];
  let turns = 0;

  while (turns < MAX_EXECUTE_TURNS) {
    turns++;
    if (onProgress) onProgress({ phase: 'execute', turn: turns, changedFiles });

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

    if (process.env.DEV_ORCH_DEBUG) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync('/tmp/tester-orchestrator-debug.log',
        `\n=== Turn ${turns} ===\n${response.slice(0, 500)}\n`);
    }

    messages.push({ role: 'assistant', content: response });

    const action = parseAction(response);
    if (!action) {
      messages.push({
        role: 'user',
        content: '請用 TOOL: 格式回覆。可用：write_file, read_file, bash, done',
      });
      continue;
    }

    log.push({ turn: turns, action: action.type });

    switch (action.type) {
      case 'write_file': {
        const preCheck = checkWriteAllowed(action.path, projectRoot);
        if (!preCheck.allowed) {
          messages.push({ role: 'user', content: `❌ 拒絕: ${preCheck.reason}` });
          continue;
        }

        const fullPath = join(projectRoot, action.path);
        // Create parent dir if needed
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        try { await import('node:fs').then(fs => fs.mkdirSync(dir, { recursive: true })); } catch {}

        await writeFile(fullPath, action.content, 'utf-8');
        if (!changedFiles.includes(action.path)) changedFiles.push(action.path);

        const postCheck = await verifyAfterWrite(fullPath, projectRoot, projectLangs);
        if (!postCheck.passed) {
          messages.push({
            role: 'user',
            content: `❌ 測試檔案語法錯誤:\n${postCheck.errors.join('\n')}\n\n請修復。`,
          });
          continue;
        }

        messages.push({ role: 'user', content: `✅ 測試檔案寫入成功: ${action.path}` });
        break;
      }

      case 'read_file': {
        const fullPath = join(projectRoot, action.path);
        if (!existsSync(fullPath)) {
          messages.push({ role: 'user', content: `❌ 檔案不存在: ${action.path}` });
          continue;
        }
        try {
          let content = await readFile(fullPath, 'utf-8');
          if (action.startLine || action.endLine) {
            const lines = content.split('\n');
            const start = (action.startLine || 1) - 1;
            const end = action.endLine || lines.length;
            content = lines.slice(start, end).join('\n');
          }
          const MAX = 8000;
          const truncated = content.length > MAX ? content.slice(0, MAX) + '\n...(truncated)' : content;
          messages.push({ role: 'user', content: `📄 ${action.path}:\n\`\`\`\n${truncated}\n\`\`\`` });
        } catch (err) {
          messages.push({ role: 'user', content: `❌ 讀取失敗: ${err.message}` });
        }
        break;
      }

      case 'bash': {
        const bashCheck = checkBashAllowed(action.command);
        if (!bashCheck.allowed) {
          messages.push({ role: 'user', content: `❌ 拒絕: ${bashCheck.reason}` });
          continue;
        }
        try {
          const output = execSync(action.command, {
            cwd: projectRoot, timeout: 60000, encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const truncated = output.length > 3000 ? output.slice(0, 3000) + '\n...(truncated)' : output;
          messages.push({ role: 'user', content: `$ ${action.command}\n${truncated}` });
        } catch (err) {
          const output = (err.stdout || err.stderr || '').slice(0, 2000);
          messages.push({ role: 'user', content: `$ ${action.command}\n❌ Exit ${err.status || '?'}\n${output}` });
        }
        break;
      }

      case 'done': {
        return { changedFiles, log, completed: true, turns };
      }

      default:
        messages.push({ role: 'user', content: `未知 action: ${action.type}` });
    }
  }

  return { changedFiles, log, completed: false, turns, reason: 'Exceeded max turns' };
}

// ─── Phase 3: Verify ───────────────────────────────────────────

async function verifyTestResults(projectRoot, projectLangs, changedFiles) {
  const { testPassed, details } = await verifyTests(projectRoot, projectLangs);

  return {
    testPassed,
    details,
    testFilesWritten: changedFiles.length,
  };
}

// ─── Phase 4: Handoff ──────────────────────────────────────────

function createHandoff(task, changedFiles, verifyResult, plan) {
  return {
    status: verifyResult.testPassed ? 'completed' : 'failed',
    task,
    testFilesWritten: changedFiles,
    testPassed: verifyResult.testPassed,
    testDetails: verifyResult.details,
    readyFor: verifyResult.testPassed ? ['qa'] : [],
  };
}

async function commitAndPush(projectRoot, task, handoff) {
  if (handoff.testFilesWritten.length === 0) return '';
  try {
    for (const f of handoff.testFilesWritten) {
      execSync(`git add "${f}"`, { cwd: projectRoot, encoding: 'utf-8', timeout: 5000 });
    }
    const msg = `${COMMIT_PREFIX}: ${task.slice(0, 72)}\n\nTest files: ${handoff.testFilesWritten.length}\nTests: ${handoff.testPassed ? '✅' : '❌'}`;
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: projectRoot, encoding: 'utf-8', timeout: 15000 });
    const hash = execSync('git rev-parse --short HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
    try { execSync('git push', { cwd: projectRoot, encoding: 'utf-8', timeout: 30000 }); } catch {}
    return hash;
  } catch { return ''; }
}

// ─── Main Entry ────────────────────────────────────────────────

export async function runTester(opts) {
  const { task, projectRoot, model: modelOverride, targetFiles = [], onProgress = null, skipCommit = false } = opts;

  if (!task) throw new Error('task is required');
  if (!projectRoot) throw new Error('projectRoot is required');

  // Resolve LLM
  const { resolveLLMConfig } = await import('../../paaw-agent-loop.mjs');
  const { callLLMWithRetry } = await import('../../llm-utils.mjs');

  let knownProviders = [];
  try {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const cfg = JSON.parse(readFileSync(resolve(projectRoot, 'data/config/providers.json'), 'utf-8'));
    knownProviders = Object.keys(cfg.providers || {});
  } catch {}

  let safeModelOverride = modelOverride;
  if (modelOverride && modelOverride.includes('/')) {
    if (!knownProviders.includes(modelOverride.split('/')[0])) safeModelOverride = null;
  }
  const llmConfig = resolveLLMConfig(projectRoot, safeModelOverride);
  const effectiveModel = safeModelOverride ? llmConfig.model : (modelOverride || llmConfig.model || llmConfig.defaultModel);

  const llm = {
    model: effectiveModel,
    call: async (body) => {
      const result = await callLLMWithRetry(llmConfig.apiUrl, llmConfig.headers, body, { timeoutMs: 600_000, maxRetries: 3 });
      return result?.choices?.[0]?.message?.content || result?.content || null;
    },
  };

  // Phase 0
  if (onProgress) onProgress({ phase: 'L1', status: 'reading source code' });
  const projectLangs = detectLanguages(projectRoot);
  const ctx = await gatherTesterContext(projectRoot, projectLangs, targetFiles);
  const systemPrompt = buildSystemPrompt(ctx, task);

  // Phase 1: Plan
  if (onProgress) onProgress({ phase: 'plan', status: 'planning tests' });
  const planPrompt = buildPlanPrompt(task);
  const planResult = await llm.call({
    model: llm.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: planPrompt },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  });
  const plan = parseJSON(planResult);

  // Phase 2: Execute
  if (onProgress) onProgress({ phase: 'execute', status: 'writing tests' });
  const executePrompt = buildExecutePrompt(task, plan, ctx);
  const execResult = await executeTask(llm, systemPrompt, executePrompt, projectRoot, projectLangs, onProgress);

  // Phase 3: Verify
  if (onProgress) onProgress({ phase: 'verify', status: 'running tests' });
  const verifyResult = await verifyTestResults(projectRoot, projectLangs, execResult.changedFiles);

  // Phase 4: Handoff
  if (onProgress) onProgress({ phase: 'handoff', status: 'creating report' });
  const handoff = createHandoff(task, execResult.changedFiles, verifyResult, plan);

  if (!skipCommit && handoff.testFilesWritten.length > 0) {
    handoff.commitHash = await commitAndPush(projectRoot, task, handoff);
  }

  return handoff;
}

// ─── Helpers ───────────────────────────────────────────────────

async function scanTestFiles(projectRoot) {
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.paaw', 'coverage', 'build']);
  const TEST_PATTERNS = [/\.test\./, /\.spec\./, /_test\./, /test_.*\./, /Test\.java$/];
  const results = [];

  async function walk(dir, depth = 0) {
    if (depth > 10) return;
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
        if (TEST_PATTERNS.some(p => p.test(entry.name))) {
          results.push(relative(projectRoot, full).replace(/\\/g, '/'));
        }
      }
    }
  }

  await walk(projectRoot);
  return results.sort();
}

function parseAction(response) {
  if (!response) return null;
  const text = response.trim();
  const toolMatch = text.match(/^TOOL:\s*(\w+)/im) || text.match(/\nTOOL:\s*(\w+)/im);
  if (!toolMatch) {
    if (/^(DONE|完成|測試完成)/i.test(text)) return { type: 'done', summary: text.slice(0, 200) };
    return null;
  }

  const type = toolMatch[1].toLowerCase();
  const lines = text.split('\n');
  const getVal = (key) => {
    const line = lines.find(l => new RegExp(`^${key}:`, 'i').test(l));
    return line ? line.replace(new RegExp(`^${key}:\\s*`, 'i'), '').trim() : null;
  };

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
        else break;
      }
      if (inFence) content.push(lines[i]);
      else if (!foundFence) {
        if (/^TOOL:/.test(trimmed) || /^[A-Z]{3,}:/.test(trimmed)) break;
        content.push(lines[i]);
      }
    }
    return content.join('\n').trim();
  };

  switch (type) {
    case 'write_file':
      return { type: 'write_file', path: getVal('PATH'), content: extractBlock('CONTENT') };
    case 'read_file':
      return {
        type: 'read_file', path: getVal('PATH'),
        startLine: getVal('START') ? parseInt(getVal('START')) : null,
        endLine: getVal('END') ? parseInt(getVal('END')) : null,
      };
    case 'bash':
      return { type: 'bash', command: getVal('CMD') || getVal('COMMAND') };
    case 'done':
      return { type: 'done', summary: getVal('SUMMARY') || '' };
    default:
      return { type, raw: response.slice(0, 500) };
  }
}

function parseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    return null;
  }
}

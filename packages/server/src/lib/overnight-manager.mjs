/**
 * Overnight Manager — Engineering Manager 自動調度
 *
 * 流程：
 *   1. 收集 context（action log + git status + .paaw/ context）
 *   2. LLM 規劃工作清單
 *   3. 逐一 A2A message/send 調用 agent
 *   4. 收集結果
 *   5. 寫隔天報告到 .paaw/overnight-reports/YYYY-MM-DD.md
 */

import { listActionLog, loadAgentMemory, addActionLog } from "./action-log.mjs";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── A2A Client — EM 調用其他 agent ──

/**
 * Call a domain agent via A2A message/send (sync)
 * @param {string} baseUrl - e.g. "http://127.0.0.1:4097"
 * @param {string} agentId - e.g. "developer", "tester", "doc-writer"
 * @param {string} message - task description
 * @param {Object} opts - { cwd, conversationHistory, model, timeout }
 * @returns {Promise<{ success: boolean, content: string, error?: string }>}
 */
export async function a2aCallAgent(baseUrl, agentId, message, opts = {}) {
  const { cwd, conversationHistory, model, timeout = 120000 } = opts;

  const body = {
    jsonrpc: "2.0",
    method: "message/send",
    params: {
      message: { role: "user", parts: [{ type: "text", text: message }] },
      context: { cwd },
      ...(conversationHistory ? { conversationHistory } : {}),
      ...(model ? { metadata: { model } } : {}),
    },
    id: `em-${agentId}-${Date.now()}`,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(`${baseUrl}/a2a/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await res.json();

    if (data.error) {
      return { success: false, content: "", error: data.error.message || "Unknown A2A error" };
    }

    // Extract text from artifacts
    const artifacts = data.result?.artifacts || [];
    const texts = artifacts
      .flatMap(a => a.parts || [])
      .filter(p => p.type === "text" || p.kind === "text")
      .map(p => p.text);

    return { success: true, content: texts.join("\n") || "(no output)" };
  } catch (err) {
    return { success: false, content: "", error: err.message };
  }
}

// ── Context Gathering ──

/**
 * Gather all context EM needs to plan work
 */
async function gatherContext(rootDir) {
  // Action log
  const actionLog = await listActionLog({ cwd: rootDir, limit: 20 });

  // Git status
  let gitStatus = "";
  try {
    const { execSync } = await import("child_process");
    gitStatus = execSync("cd " + JSON.stringify(rootDir) + " && git status --short && echo '---' && git log --oneline -10", { encoding: "utf-8", timeout: 10000 });
  } catch { gitStatus = "(unable to get git status)"; }

  // .paaw/ context
  let paawContext = "";
  try {
    const { readFile } = await import("fs/promises");
    const files = ["PROJECT.md", "DECISIONS.md", "TODO.md"];
    for (const f of files) {
      const fp = join(rootDir, ".paaw", f);
      if (existsSync(fp)) {
        const content = await readFile(fp, "utf-8");
        paawContext += `\n### ${f}\n${content.slice(0, 2000)}\n`;
      }
    }
  } catch {}

  return { actionLog: actionLog.text, gitStatus, paawContext };
}

// ── Work Planning ──

/**
 * Use LLM to plan work list from context
 * @returns {Promise<Array<{ agent: string, task: string, priority: string }>>}
 */
async function planWorkList(context, rootDir) {
  const { resolveLLMConfig, callLLM } = await import("./paaw-agent-loop.mjs");
  const llm = resolveLLMConfig(rootDir);

  const planPrompt = `你是 Engineering Manager，負責規劃 coding agent 的工作。

  const planPrompt = `你是 Engineering Manager，負責規劃 coding agent 的工作。

## 目前專案狀態

### Action Log（最近的 agent 交接紀錄）
${context.actionLog || "(empty)"}

### Git Status
${context.gitStatus}

### 專案 Context
${context.paawContext || "(none)"}

## 可調度的 Agent
- architect — 架構審查、技術決策、風險評估
- developer — 寫程式、修 bug、refactor
- tester — 寫測試、跑測試、回報結果
- doc-writer — 寫文件、README、changelog
- helpdesk — 技術支援、排查問題

## 你的任務
根據專案現狀，規劃 3-5 個具體的工作項目。每項必須：
1. 指定一個 agent 負責
2. 明確描述任務內容（agent 能直接執行的程度）
3. 設定優先級（high/medium/low）

如果沒有緊急工作，就規劃改善類的任務（文檔更新、測試補強、code review 等）。

## 輸出格式（JSON array）
[
  { "agent": "developer", "task": "修復 CodingIDE.tsx 的 tab race condition", "priority": "high" },
  { "agent": "tester", "task": "為 SidebarFileTree 寫單元測試", "priority": "medium" },
  { "agent": "doc-writer", "task": "更新 CHANGELOG.md", "priority": "low" }
]

只輸出 JSON array，不要其他文字。`;

  const messages = [{ role: "user", content: planPrompt }];

  try {
    const response = await callLLM(llm.apiUrl, llm.headers, llm.model, messages, []);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  } catch (err) {
    console.error("[EM] planWorkList error:", err.message);
    return [];
  }
}

// ── Main: Run EM Session ──

/**
 * Run a full EM orchestration session
 * @param {Object} opts
 * @param {string} opts.rootDir — project root
 * @param {string} [opts.baseUrl] — server base URL (default http://127.0.0.1:4097)
 * @param {Object} [opts.llmConfig] — LLM config override
 * @param {Object} [res] — Express response for SSE streaming (optional)
 * @returns {Promise<{ report: string, workList: Array, results: Array }>}
 */
export async function runEMSession(opts = {}) {
  const { rootDir, baseUrl = "http://127.0.0.1:4097", llmConfig } = opts;
  const sendSSE = opts.sendSSE || (() => {});

  sendSSE("info", { message: "🎖️ EM 啟動，收集專案狀態..." });

  // 1. Gather context
  const context = await gatherContext(rootDir);
  sendSSE("info", { message: `收集完成：${context.actionLog ? "Action Log ✓" : "Action Log ✗"} | Git ${context.gitStatus ? "✓" : "✗"}` });

  // 2. Plan work
  sendSSE("info", { message: "📋 規劃工作清單中..." });
  const workList = await planWorkList(context, rootDir);

  if (!workList.length) {
    sendSSE("info", { message: "沒有需要調度的工作。" });
    const report = `# EM Session Report\n\n## ${new Date().toISOString()}\n\n沒有需要調度的工作。\n`;
    await saveReport(rootDir, report);
    return { report, workList: [], results: [] };
  }

  sendSSE("plan", { workList });
  sendSSE("info", { message: `📋 規劃了 ${workList.length} 項工作：` });
  for (const w of workList) {
    sendSSE("info", { message: `  • [${w.priority}] ${w.agent}: ${w.task}` });
  }

  // 3. Execute each task via A2A
  const results = [];
  for (let i = 0; i < workList.length; i++) {
    const task = workList[i];
    sendSSE("task_start", { index: i + 1, total: workList.length, ...task });

    const result = await a2aCallAgent(baseUrl, task.agent, task.task, {
      cwd: rootDir,
      timeout: 120000,
    });

    results.push({ ...task, ...result, duration: 0 });

    if (result.success) {
      sendSSE("task_done", { index: i + 1, agent: task.agent, preview: result.content.slice(0, 200) });
    } else {
      sendSSE("task_error", { index: i + 1, agent: task.agent, error: result.error });
    }

    // Log to action log
    await addActionLog({
      agent: "em",
      action: "decide",
      summary: `調度 ${task.agent}: ${task.task}`,
      details: result.success ? result.content.slice(0, 500) : `Error: ${result.error}`,
      affectedFiles: [],
      result: result.success ? "fixed" : "suggestions",
      priority: task.priority,
    }, rootDir);
  }

  // 4. Generate report
  sendSSE("info", { message: "📝 產生報告中..." });
  const report = generateReport(workList, results);
  await saveReport(rootDir, report);
  sendSSE("report", { report });

  // 5. EM records its own action
  await addActionLog({
    agent: "em",
    action: "create",
    summary: `完成 EM session：調度 ${workList.length} 項工作，成功 ${results.filter(r => r.success).length} 項`,
    details: workList.map(w => `${w.agent}: ${w.task}`).join("\n"),
    affectedFiles: [],
    result: "created",
    priority: "high",
  }, rootDir);

  sendSSE("done", {
    totalTasks: workList.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  });

  return { report, workList, results };
}

// ── Report Generation ──

function generateReport(workList, results) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  let report = `# 🎖️ Engineering Manager 報告\n\n`;
  report += `**日期：** ${dateStr}\n`;
  report += `**時間：** ${now.toTimeString().slice(0, 8)}\n`;
  report += `**結果：** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${workList.length} 總計\n\n`;
  report += `---\n\n## 工作清單\n\n`;

  for (let i = 0; i < workList.length; i++) {
    const w = workList[i];
    const r = results[i];
    const icon = r.success ? "✅" : "❌";
    report += `### ${i + 1}. ${icon} [${w.priority}] ${w.agent} — ${w.task}\n\n`;
    if (r.success) {
      report += `**結果：**\n\`\`\`\n${r.content.slice(0, 1000)}\n\`\`\`\n\n`;
    } else {
      report += `**錯誤：** ${r.error}\n\n`;
    }
  }

  report += `---\n\n*由 PAAW Engineering Manager 自動產生*\n`;
  return report;
}

async function saveReport(rootDir, report) {
  const dir = join(rootDir, ".paaw", "overnight-reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = join(dir, `${dateStr}.md`);
  writeFileSync(filePath, report, "utf-8");
  return filePath;
}

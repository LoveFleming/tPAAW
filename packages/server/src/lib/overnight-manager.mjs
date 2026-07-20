/**
 * Overnight Manager — Engineering Manager 自動調度 + Night Shift Parallel
 *
 * 設計原則：
 *   收集和執行用決定性程式，規劃用 LLM prompt
 *
 * 兩種模式：
 *   mode: "em"       → EM 先讀現況 → LLM 規劃 → A2A 調度 agent（聰明但慢）
 *   mode: "parallel" → 全員平行跑，固定 6 agent（快但固定）
 *
 * 共用邏輯在 night-shift-shared.mjs
 *
 * 流程（EM 模式）：
 *   1. 【決定性】收集 context
 *   2. 【決定性】整理成「現況摘要」
 *   3. 【LLM】讀摘要 → 規劃工作清單
 *   4. 【決定性】逐一 A2A message/send → agent 執行
 *   5. 【決定性】收集結果 → 寫報告
 *
 * 流程（Parallel 模式）：
 *   1. 【決定性】收集 context
 *   2. 【決定性】所有 agent 平行跑（用 runAgentLoop）
 *   3. 【決定性】收集結果 → 寫報告
 */

import { addActionLog } from "./action-log.mjs";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  gatherContext,
  buildSituationReport,
  refreshFeatureMapping,
  validateFeatureMap,
  saveNightShiftReport,
} from "./night-shift-shared.mjs";

// ── A2A Client ──

export async function a2aCallAgent(baseUrl, agentId, message, opts = {}) {
  const { cwd, timeout = 1800000, modelOverride } = opts;

  const params = {
    message: { role: "user", parts: [{ type: "text", text: message }] },
    context: { cwd },
  };
  // Pass model override so A2A agents use the configured model, not the global default
  if (modelOverride) {
    params.metadata = { model: modelOverride };
  }

  const body = {
    jsonrpc: "2.0",
    method: "message/send",
    params,
    id: `em-${agentId}-${Date.now()}`,
  };

  const url = `${baseUrl}/a2a/${agentId}`;

  // Retry on fetch errors (network glitches, transient connection resets)
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();

      if (data.error) return { success: false, content: "", error: data.error.message };
      const artifacts = data.result?.artifacts || [];
      const texts = artifacts.flatMap(a => a.parts || []).filter(p => p.type === "text" || p.kind === "text").map(p => p.text);
      return { success: true, content: texts.join("\n") || "(no output)" };
    } catch (err) {
      const isFetchErr = err.message && (err.message.includes("fetch failed") || err.message.includes("ECONNRESET") || err.message.includes("aborted"));
      if (isFetchErr && attempt < maxRetries) {
        console.log(`[EM] a2aCallAgent ${agentId}: fetch failed (attempt ${attempt + 1}), retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return { success: false, content: "", error: err.message };
    }
  }
  return { success: false, content: "", error: "Max retries exceeded" };
}

// ── LLM Work Planning（EM 模式用） ──

async function planWorkList(situationReport, rootDir, modelOverride, fallbackModels = []) {
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");
  const llm = resolveLLMConfig(rootDir, modelOverride);

  const EM_PROMPT = `你是 AI Coding Team 的 Engineering Manager (陳哲宇 Ethan)。

## 你的角色
你是技術主管，不是執行者。你讀現況摘要，判斷什麼需要做，分配給合適的 agent。
你不寫程式、不跑測試。你規劃、分配、追蹤。

## 可調度的 Agent 及能力
- **architect** — 架構審查、技術決策（ADR）、風險評估、模組邊界規劃
- **developer** — 寫程式、修 bug、refactor、實作功能、全端開發
- **tester** — 撰寫單元測試/整合測試/E2E、跑測試、覆蓋率分析
- **doc-writer** — 寫 README、API docs、changelog、技術文件
- **qa** — Code review、品質把關、安全性檢查、issue 追蹤
- **helpdesk** — 技術支援、排查問題、操作指引

## 規劃原則
1. **從 change 水位出發** — 看 action log 裡最近的變更，找出未完成的工作或遺漏
2. **有未 push 的 commit** → 報告中標注，但**不指派 push**（push 只由人執行）
3. **有未提交的變更** → 評估是否需要 developer 補完
4. **缺少測試** → 指派 tester 補測試
5. **缺少文檔** → 指派 doc-writer 補文檔
6. **架構有風險** → 指派 architect 審查
7. 每項任務必須**具體、可執行** — agent 拿到就能直接做
8. 3-5 項，不要太多。品質 > 數量

## 任務描述規則
- ❌ "改善程式碼品質"（太空泛）
- ✅ "為 packages/ui/src/components/SidebarFileTree.tsx 的 openFile 函數寫單元測試"
- ❌ "更新文檔"（太模糊）
- ✅ "根據最近 5 個 commit 更新 .paaw/CHANGELOG.md"

## 輸出格式（嚴格 JSON array，不要其他文字）
[
  {
    "agent": "developer",
    "task": "具體任務描述，agent 拿到就能執行",
    "priority": "high",
    "reason": "為什麼需要這項工作（一句話）"
  }
]`;

  const messages = [
    { role: "system", content: EM_PROMPT },
    { role: "user", content: situationReport },
  ];

  // ── LLM call with model fallback ──
  async function callWithFallback(body, opts = {}) {
    const models = [modelOverride, ...fallbackModels].filter(Boolean);
    if (models.length === 0) {
      const result = await callLLMWithRetry(llm.apiUrl, llm.headers, body, {
        maxRetries: 3,
        timeoutMs: 60000,
        validateContent: true,
        sanitize: true,
        caller: "overnight",
        agentId: "overnight",
        ...opts,
      });
      return result;
    }
    for (let i = 0; i < models.length; i++) {
      try {
        const m = resolveLLMConfig(rootDir, models[i]);
        const result = await callLLMWithRetry(m.apiUrl, m.headers, { ...body, model: m.model || m.defaultModel }, {
          maxRetries: 2,
          timeoutMs: 60000,
          validateContent: true,
          sanitize: true,
          caller: "overnight",
          agentId: "overnight",
          ...opts,
        });
        if (result) return result;
      } catch (err) {
        console.log(`[EM] Model ${models[i]} failed: ${err.message.slice(0, 100)}`);
        if (i === models.length - 1) throw err;
      }
    }
    return null;
  }

  try {
    const body = {
      model: llm.model,
      messages,
      max_tokens: 8192,
      stream: false,
    };
    const result = await callWithFallback(body);
    const text = result?.content || "";
    console.log("[EM] planWorkList LLM response length:", text.length);
    console.log("[EM] planWorkList LLM response preview:", text.slice(0, 500));
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const list = JSON.parse(match[0]);
        console.log("[EM] planWorkList parsed:", list.length, "items");
        return list.filter(item => item.agent && item.task);
      } catch (parseErr) {
        console.error("[EM] planWorkList JSON parse failed:", parseErr.message);
        return [];
      }
    }
    console.error("[EM] planWorkList: no JSON array found in LLM response");
    return [];
  } catch (err) {
    console.error("[EM] planWorkList error:", err.message);
    return [];
  }
}

// ── Phase 0: Feature Map Refresh + Validation（共用） ──

async function runPhase0(rootDir, modelOverride, fallbackModels, sendSSE) {
  console.log("[NightShift] ═══ Phase 0: Feature Map Refresh + Validation ═══");
  // Feature Map refresh
  sendSSE("info", { message: "🗺️ Phase 0: 更新 Feature Map..." });
  try {
    const refreshed = await refreshFeatureMapping(rootDir, modelOverride, fallbackModels, sendSSE);
    if (refreshed.ok) {
      console.log(`[NightShift] Phase 0: Feature Map updated ${refreshed.updated}/${refreshed.total}`);
    } else {
      console.log(`[NightShift] Phase 0: Feature Map failed: ${refreshed.error}`);
      sendSSE("warning", { message: `🗺️ Feature Map 更新失敗：${refreshed.error || 'unknown'}` });
    }
  } catch (err) {
    console.log(`[NightShift] Phase 0: Feature Map skipped: ${err.message}`);
    sendSSE("warning", { message: `🗺️ Feature Map 更新略過：${err.message}` });
  }

  // L3 Validation
  console.log("[NightShift] Phase 0: Validating Feature Map...");
  sendSSE("info", { message: "🔍 Phase 0: 驗證 Feature Map..." });
  await validateFeatureMap(rootDir, sendSSE);
  console.log("[NightShift] Phase 0: Done ✓");
}

// ── EM Mode: Run EM Session ──

export async function runEMSession(opts = {}) {
  const { rootDir, baseUrl = `http://127.0.0.1:${process.env.PAAW_PORT || 4097}`, since, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;

  console.log("[NightShift] 🎖️═══ EM 智慧調度開始 ═══🎖️");
  console.log(`[NightShift] rootDir=${rootDir}, since=${since || "today"}, model=${modelOverride || "default"}`);

  // ── Phase 0 ──
  console.log("[NightShift] EM Phase 0 starting...");
  await runPhase0(rootDir, modelOverride, fallbackModels, sendSSE);

  // ── Phase 1: Deterministic gathering ──
  console.log("[NightShift] ═══ Phase 1: Context Gathering ═══");
  sendSSE("info", { message: "🎖️ EM 啟動，收集專案狀態..." });
  const ctx = await gatherContext(rootDir, since);
  const situationReport = buildSituationReport(ctx);
  console.log(`[NightShift] Phase 1: ${ctx.commitCount} commits, ${ctx.changedFiles.length} files changed, ${ctx.unpushed ? ctx.unpushed.split("\n").length + " unpushed" : "all pushed"}`);
  sendSSE("info", { message: `📊 現況摘要收集完成` });

  if (ctx.unpushed) {
    sendSSE("warning", { message: `⚠️ 發現 ${ctx.unpushed.split("\n").length} 個未 push 的 commit（push 由人決定）` });
  }

  // ── Phase 2: LLM planning ──
  console.log("[NightShift] ═══ Phase 2: LLM Work Planning ═══");
  sendSSE("info", { message: "🧠 規劃工作清單中..." });
  const workList = await planWorkList(situationReport, rootDir, modelOverride, fallbackModels);
  console.log(`[NightShift] Phase 2: EM planned ${workList.length} tasks`);

  if (!workList.length) {
    sendSSE("info", { message: "✅ 目前沒有需要調度的工作，專案狀態良好。" });
    const report = generateEMReport([], [], situationReport);
    saveNightShiftReport(rootDir, report, "em");
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, workList: [], results: [] };
  }

  sendSSE("plan", { workList });
  sendSSE("info", { message: `📋 規劃了 ${workList.length} 項工作：` });
  for (const w of workList) {
    sendSSE("info", { message: `  • [${w.priority}] ${w.agent}: ${w.task}${w.reason ? ` — ${w.reason}` : ""}` });
  }

  // ── Phase 3: Deterministic execution ──
  console.log("[NightShift] ═══ Phase 3: Agent Dispatch (serial) ═══");
  const results = [];
  for (let i = 0; i < workList.length; i++) {
    const task = workList[i];
    console.log(`[NightShift] Phase 3: [${i + 1}/${workList.length}] → ${task.agent}: ${task.task.slice(0, 80)}...`);
    sendSSE("task_start", { index: i + 1, total: workList.length, ...task });

    const result = await a2aCallAgent(baseUrl, task.agent, task.task, {
      cwd: rootDir,
      timeout: 1800000,
      modelOverride,
    });

    results.push({ ...task, ...result });

    if (result.success) {
      console.log(`[NightShift] Phase 3: [${i + 1}/${workList.length}] ✅ ${task.agent} done (${result.content.length} chars)`);
      sendSSE("task_done", { index: i + 1, agent: task.agent, preview: result.content.slice(0, 200) });
    } else {
      console.log(`[NightShift] Phase 3: [${i + 1}/${workList.length}] ❌ ${task.agent} failed: ${result.error}`);
      sendSSE("task_error", { index: i + 1, agent: task.agent, error: result.error });
    }
  }

  // ── Phase 4: Report ──
  console.log("[NightShift] ═══ Phase 4: Report Generation ═══");
  sendSSE("info", { message: "📝 產生報告中..." });
  const report = generateEMReport(workList, results, situationReport);
  saveNightShiftReport(rootDir, report, "em");
  console.log(`[NightShift] Phase 4: Report saved (${report.length} chars)`);
  sendSSE("report", { report });

  // EM records a summary change
  await addActionLog({
    agent: "em",
    action: "decide",
    summary: `EM session 完成：調度 ${workList.length} 項工作，成功 ${results.filter(r => r.success).length} 項`,
    details: workList.map(w => `${w.priority}/${w.agent}: ${w.task}`).join("\n"),
    affectedFiles: [],
    result: "adr",
    priority: "high",
  }, rootDir);

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`[NightShift] 🎖️ EM Session complete: ${succeeded}✅ ${failed}❌ / ${workList.length} total`);
  sendSSE("done", { totalTasks: workList.length, succeeded, failed });

  return { report, workList, results };
}

// ── Parallel Mode: Run all agents in parallel ──

export async function runParallelSession(opts = {}) {
  const { rootDir, since, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;
  const { resolve } = await import("path");
  const { fileURLToPath } = await import("url");
  const PAAW_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

  // ── Phase 0 ──
  await runPhase0(rootDir, modelOverride, fallbackModels, sendSSE);

  // ── Phase 1: Gather context ──
  sendSSE("info", { message: "🌙 Night Shift 啟動，收集變更..." });
  const ctx = await gatherContext(rootDir, since);

  if (ctx.changedFiles.length === 0 && !ctx.gitLog) {
    sendSSE("info", { message: "ℹ️ 沒有變更，無需審查。" });
    const report = `# 🌙 Night Shift Report\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n\nℹ️ No changes today. Nothing to review.`;
    saveNightShiftReport(rootDir, report, "parallel");
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, results: [] };
  }

  sendSSE("info", { message: `📊 ${ctx.changedFiles.length} files changed, ${ctx.commitCount} commits` });

  // ── Phase 2: Load prompts + run all agents in parallel ──
  const { getPromptsFile } = await import("../routes/coding-night-shift-prompts.mjs");
  const prompts = await getPromptsFile(rootDir);
  const { runAgentLoop } = await import("./paaw-agent-loop.mjs");
  const { loadAgentMemory, listActionLog } = await import("./action-log.mjs");
  const { readFileSync } = await import("fs");

  const agentRoles = Object.entries(prompts);
  sendSSE("info", { message: `🚀 啟動 ${agentRoles.length} 個 agent...` });

  const effectiveModel = modelOverride || undefined;

  const results = await Promise.allSettled(agentRoles.map(async ([role, config]) => {
    const crewFile = join(PAAW_ROOT, "data", "crews", `${config.crewId}.json`);
    let crew = null;
    try { crew = JSON.parse(readFileSync(crewFile, "utf-8")); } catch {}

    const fileList = ctx.changedFiles.map(f => `- ${f}`).join("\n");
    const taskPrompt = (config.task || "")
      .replace(/\{\{gitLog\}\}/g, ctx.gitLog || "(none)")
      .replace(/\{\{changedFiles\}\}/g, fileList)
      .replace(/\{\{featuresSummary\}\}/g, ctx.featuresSummary || "(none)");

    // Load agent memory + action log
    let memoryText = "";
    try { memoryText = await loadAgentMemory(rootDir, config.crewId) || ""; } catch {}
    let actionLogText = "";
    try { actionLogText = (await listActionLog(rootDir, 5)).map(e => `- ${e.agentId}: ${e.action}`).join("\n"); } catch {}

    const systemPrompt = (crew?.rolePrompt || "") +
      (memoryText ? `\n\n## Your Long-term Memory\n${memoryText}` : "") +
      (actionLogText ? `\n\n## Recent Action Log\n${actionLogText}` : "");

    try {
      const result = await runAgentLoop({
        prompt: taskPrompt,
        cwd: rootDir,
        rootDir: PAAW_ROOT,
        systemPrompt,
        agentId: config.crewId,
        model: effectiveModel,
        maxTurns: 15,
        timeout: 120,
        onEvent: (event) => {
          if (event.type === "tool_call") {
            console.log(`[NightShift:${role}] tool: ${event.name}`);
          }
        },
      });

      // Read agent's report file if it wrote one
      const reportFile = join(rootDir, ".paaw", "night-shift", `${role}-report.md`);
      let agentReport = "";
      if (existsSync(reportFile)) {
        agentReport = readFileSync(reportFile, "utf-8");
      }

      return {
        role,
        status: "completed",
        codename: crew?.codename,
        result: typeof result === "string" ? result.slice(-500) : "ok",
        report: agentReport.slice(0, 2000) || (typeof result === "string" ? result.slice(-500) : "done"),
      };
    } catch (err) {
      console.error(`[NightShift:${role}] failed:`, err.message);
      return { role, status: "failed", codename: crew?.codename, error: err.message };
    }
  }));

  // ── Phase 3: Generate report ──
  sendSSE("info", { message: "📝 產生報告中..." });
  const agentResults = results.map(r => r.status === "fulfilled" ? r.value : { role: "unknown", status: "failed", error: r.reason?.message });
  console.log(`[NightShift] Phase 2: Results: ${agentResults.filter(r => r.status === "completed").length}✅ ${agentResults.filter(r => r.status === "failed").length}❌`);
  const report = generateParallelReport(agentResults, ctx);
  saveNightShiftReport(rootDir, report, "parallel");
  console.log(`[NightShift] Phase 3: Report saved (${report.length} chars)`);
  sendSSE("report", { report });

  const succeeded = agentResults.filter(r => r.status === "completed").length;
  const failed = agentResults.filter(r => r.status === "failed").length;
  console.log(`[NightShift] 🌙 Night Shift complete: ${succeeded}✅ ${failed}❌ / ${agentResults.length} total`);
  sendSSE("done", { totalTasks: agentResults.length, succeeded, failed });

  return { report, results: agentResults };
}

// ── Report Generators ──

function generateEMReport(workList, results, situationReport) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  let report = `# 🎖️ Engineering Manager 報告\n\n`;
  report += `**日期：** ${dateStr}\n`;
  report += `**時間：** ${now.toTimeString().slice(0, 8)}\n`;
  report += `**結果：** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${workList.length} 總計\n`;
  report += `**模式：** EM 智慧調度\n\n---\n\n## 📊 專案現況\n\n${situationReport}\n\n---\n\n## 📋 工作清單\n\n`;

  for (let i = 0; i < workList.length; i++) {
    const w = workList[i];
    const r = results[i];
    const icon = r.success ? "✅" : "❌";
    report += `### ${i + 1}. ${icon} [${w.priority}] ${w.agent} — ${w.task}\n`;
    if (w.reason) report += `> ${w.reason}\n`;
    report += `\n`;
    if (r.success) {
      report += `**結果：**\n\`\`\`\n${r.content.slice(0, 1500)}\n\`\`\`\n\n`;
    } else {
      report += `**錯誤：** ${r.error}\n\n`;
    }
  }

  report += `---\n\n*由 PAAW Engineering Manager 自動產生*\n`;
  return report;
}

function generateParallelReport(agentResults, ctx) {
  const now = new Date();
  const crewLabels = {
    architect: "🏛️ 林曉薇 (Architect)",
    developer: "💻 Priya (Developer)",
    tester: "🧪 Divya (Tester)",
    "doc-writer": "📝 Megan (Doc Writer)",
    qa: "🔍 武大安 (QA)",
    helpdesk: "🎫 小春 (Helpdesk)",
  };

  const succeeded = agentResults.filter(r => r.status === "completed").length;
  const failed = agentResults.filter(r => r.status === "failed").length;

  let report = `# 🌙 Night Shift Report\n\n`;
  report += `**Date:** ${now.toLocaleDateString("zh-TW")}\n`;
  report += `**Time:** ${now.toTimeString().slice(0, 8)}\n`;
  report += `**Result:** ✅ ${succeeded} 成功 / ❌ ${failed} 失敗 / ${agentResults.length} 總計\n`;
  report += `**Mode:** 全員平行\n\n`;
  report += `**Changes:** ${ctx.changedFiles.length} files, ${ctx.commitCount} commits since ${ctx.since || "today"}\n\n---\n\n`;

  for (const [role, label] of Object.entries(crewLabels)) {
    const agentResult = agentResults.find(r => r.role === role);
    if (!agentResult) {
      report += `### ${label}\n⚠️ Not executed.\n\n---\n\n`;
      continue;
    }
    const icon = agentResult.status === "completed" ? "✅" : agentResult.status === "failed" ? "❌" : "⏭️";
    report += `### ${label} ${icon}\n`;
    if (agentResult.report) {
      report += `${agentResult.report}\n\n`;
    } else if (agentResult.error) {
      report += `Error: ${agentResult.error}\n\n`;
    } else {
      report += `${agentResult.result || "No output"}\n\n`;
    }
    report += `---\n\n`;
  }

  // Git info
  if (ctx.gitLog) {
    report += `## 📋 Commits\n\`\`\`\n${ctx.gitLog}\n\`\`\`\n`;
  }
  if (ctx.changedFiles.length > 0) {
    report += `\n## 📁 Changed Files\n${ctx.changedFiles.map(f => `- \`${f}\``).join("\n")}\n`;
  }
  if (ctx.unpushed) {
    report += `\n## ⚠️ 未 Push 的 Commit\n\`\`\`\n${ctx.unpushed}\n\`\`\`\n\n**Push 由人決定，AI 不自動 push。**\n`;
  }

  return report;
}

// ── Main entry: run session by mode ──

/**
 * @param {object} opts
 * @param {string} opts.mode - "em" | "parallel" (default: "em")
 * @param {string} opts.rootDir - Project root
 * @param {string} opts.baseUrl - A2A base URL (EM mode only)
 * @param {string} opts.since - Since date
 * @param {string} opts.modelOverride - Model override
 * @param {string[]} opts.fallbackModels - Fallback models
 * @param {function} opts.sendSSE - SSE callback
 */
export async function runNightShift(opts = {}) {
  const mode = opts.mode || "em";
  if (mode === "parallel") {
    return runParallelSession(opts);
  }
  return runEMSession(opts);
}

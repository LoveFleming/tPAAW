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
  const { cwd, timeout = 0, modelOverride } = opts; // 0 = no HTTP timeout, agent loop handles its own

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
      const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (timer) clearTimeout(timer);
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

async function planWorkList(situationReport, rootDir, modelOverride, fallbackModels = [], sendSSE = (() => {})) {
  const { resolveLLMConfig } = await import("./paaw-agent-loop.mjs");
  const { callLLMWithRetry } = await import("./llm-utils.mjs");
  const llm = resolveLLMConfig(rootDir, modelOverride);

  // ── Build dynamic agent list from project crew ──
  const { getDispatchableAgents } = await import("./project-crew.mjs");
  const dispatchable = getDispatchableAgents(rootDir);
  const agentListText = dispatchable.map(a => {
    const shortId = a.id.replace(/^(coding\.|custom\.)/, "");
    return `- **${shortId}** — ${a.expertise || a.title || "(no expertise listed)"}`;
  }).join("\n");

  const EM_PROMPT = `你是 AI Coding Team 的 Engineering Manager (陳哲宇 Ethan)。

## 你的角色
你是技術主管，不是執行者。你讀現況摘要，判斷什麼需要做，分配給合適的 agent。
你不寫程式、不跑測試。你規劃、分配、追蹤。

## 可調度的 Agent 及能力
${agentListText}

## 規劃範圍（五大面向）

你需要統整以下五個面向來規劃工作，不要只看 git change：

### 1. Git Changes（程式碼變更）
- 最近 commit 改了什麼？有沒有遺漏？
- 有未 push 的 commit → 報告中標注，但**不指派 push**
- 有未提交的變更 → 評估是否需要 developer 補完

### 2. Open Issues（已知問題）
- 每個 open issue 都要評估是否在這次處理
- high priority issue → 優先指派 agent 修復
- 需要先有 architect 評估的 → 指派 architect

### 3. Open Tasks（待辦任務）
- 已經建立但未完成的 task
- 有 assignee 的 → 確認是否方向正確
- security 類 task → 高優先級

### 4. Security Findings（安全掃描）
- WARNING+ 以上的 finding 要認真處理
- 最常見的檔案優先修復
- 可以一次修多個 → 一個 developer task 處理一個檔案

### 5. Code Quality（程式碼品質）
- 缺少測試的模組 → 指派 tester
- 缺少文檔的功能 → 指派 doc-writer
- 架構有風險 → 指派 architect

## 長時間調度策略

這是長時間的調度任務，一次可能要跑 8-15 項工作。規劃時注意：

1. **批次設計** — 相關工作分在同一批次（例如 3 個 security fix 都指派給 developer）
2. **順序相依** — 如果 A 的結果影響 B，A 要排在前面
3. **獨立性** — 每個 task 要能獨立執行，不能依賴另一個 task 的結果
4. **不要重複** — 同一個檔案的修復合併成一個 task
5. **每個 task 要具體、可執行** — agent 拿到就能直接做

## Context 管理規則

每個 agent 都是獨立 session，看不到其他 agent 的對話。所以：
- task 描述要包含所有必要 context（檔案路徑、問題描述、預期結果）
- 不要假設 agent 知道之前的 task 做了什麼
- 如果 task 需要參考某個文件 → 在 task 中指明（例如「參考 .paaw/CODING-STANDARDS.md 的路徑規範」）

## 任務描述規則
- ❌ "改善程式碼品質"（太空泛）
- ✅ "修復 packages/ui/src/components/DirectoryExplorer.tsx 的 ~ 路徑展開問題：手動輸入 ~/App 時 server 端 resolve() 產生錯誤路徑。在 crew.mjs 的 /api/fs/browse handler 加入 ~ 展開邏輯"
- ❌ "更新文檔"（太模糊）
- ✅ "根據最近 5 個 commit 更新 .paaw/CHANGELOG.md，包含 DirectoryExplorer 修復和 EM header 統一"
- ❌ "修 security"（太模糊）
- ✅ "修復 packages/server/src/routes/coding.mjs 的 path traversal 風險（CWE-22）：line 1340 的 date 參數未做路徑驗證"

## 數量指引
- 少量高品質變更：5-8 項
- 中量例行工作：8-12 項
- 大量累積工作：12-15 項
- 不要超過 15 項，每項都要能切實完成

## 輸出格式（嚴格 JSON array，不要其他文字）
\`\`\`json
[
  {
    "agent": "developer",
    "task": "具體任務描述，包含檔案路徑、問題、預期結果。agent 看到就能獨立執行",
    "priority": "high",
    "reason": "為什麼需要這項工作（一句話）"
  }
]
\`\`\`

 priorities: high / medium / low`;

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
      max_tokens: llm.maxTokens || 16384,
      stream: false,
    };
    sendSSE("llm_start", { message: "📡 呼叫 LLM 規劃中...", model: llm.model || modelOverride || "default", contextLength: situationReport.length });
    console.log(`[EM] planWorkList: calling LLM (model=${llm.model || modelOverride || "default"}, context=${situationReport.length} chars)`);
    const result = await callWithFallback(body);
    const text = result?.content || "";
    console.log("[EM] planWorkList LLM response length:", text.length);
    console.log("[EM] planWorkList LLM response preview:", text.slice(0, 500));
    sendSSE("llm_done", { message: `✅ LLM 回覆 ${text.length} chars`, preview: text.slice(0, 200) });
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

// ── EM Plan only (Phase 0-2): gather context + LLM planning ──
export async function planEMSession(opts = {}) {
  const { rootDir, since, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;

  console.log("[NightShift] 🎖️═══ EM Plan (no execute) ═══🎖️");
  console.log(`[NightShift] rootDir=${rootDir}, since=${since || "today"}, model=${modelOverride || "default"}`);

  // ── Phase 0 ──
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
  const workList = await planWorkList(situationReport, rootDir, modelOverride, fallbackModels, sendSSE);
  console.log(`[NightShift] Phase 2: EM planned ${workList.length} tasks`);

  return { workList, situationReport };
}

// ── EM Execute only (Phase 3-4): dispatch agents + report ──
export async function executeEMSession(opts = {}) {
  const { rootDir, workList, situationReport = "", baseUrl = `http://127.0.0.1:${process.env.PAAW_PORT || 4097}`, modelOverride, fallbackModels = [], sendSSE = (() => {}) } = opts;

  // ── Per-agent model resolution ──
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");

  if (!workList || workList.length === 0) {
    sendSSE("info", { message: "✅ 目前沒有需要調度的工作，專案狀態良好。" });
    const report = generateEMReport([], [], situationReport);
    saveNightShiftReport(rootDir, report, "em");
    sendSSE("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, workList: [], results: [] };
  }

  sendSSE("plan", { workList });

  // ── Phase 3: Deterministic execution ──
  console.log("[NightShift] ═══ Phase 3: Agent Dispatch (serial) ═══");
  const results = [];
  for (let i = 0; i < workList.length; i++) {
    const task = workList[i];
    // Resolve per-agent EM model (falls back to global modelOverride)
    const crewId = task.crewId || `coding.${task.agent}`;
    const agentModel = resolveAgentModel(rootDir, crewId, "em", modelOverride || "");
    const agentFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);

    console.log(`[NightShift] Phase 3: [${i + 1}/${workList.length}] → ${task.agent}${agentModel ? ` (model: ${agentModel})` : ""}: ${task.task.slice(0, 80)}...`);
    sendSSE("task_start", { index: i + 1, total: workList.length, ...task });

    const result = await a2aCallAgent(baseUrl, task.agent, task.task, {
      cwd: rootDir,
      timeout: 1800000,
      modelOverride: agentModel || modelOverride,
      fallbackModels: agentFallbacks,
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

  // ── Per-agent model resolution ──
  const { resolveAgentModel, resolveAgentFallbacks } = await import("./project-crew.mjs");
  const { readProjectCrew } = await import("./project-crew.mjs");

  // Build dynamic crew labels from project crew
  const { agents: crewAgents } = readProjectCrew(PAAW_ROOT);
  const dynamicCrewLabels = {};
  for (const a of crewAgents) {
    const shortId = a.id.replace(/^(coding\.|custom\.)/, "");
    dynamicCrewLabels[shortId] = `${a.emoji || "🤖"} ${a.codename || shortId}`;
  }

  const effectiveModel = modelOverride || undefined;

  const results = await Promise.allSettled(agentRoles.map(async ([role, config]) => {
    const crewId = config.crewId || `coding.${role}`;
    // Resolve per-agent nightShift model
    const nsModel = resolveAgentModel(rootDir, crewId, "nightShift", effectiveModel || "");
    const nsFallbacks = resolveAgentFallbacks(rootDir, crewId, fallbackModels);

    // Load crew from project layer (overrides global)
    const { loadCrew } = await import("./domain-agent-registry.mjs");
    const crew = await loadCrew(crewId, rootDir);

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
      (crew?.expertise ? `\n\n## 專業範圍\n${crew.expertise}` : "") +
      (crew?.guardrails?.redirectRules ? `\n\n## 護欄\n### 轉介規則\n${crew.guardrails.redirectRules}` : "") +
      (memoryText ? `\n\n## Your Long-term Memory\n${memoryText}` : "") +
      (actionLogText ? `\n\n## Recent Action Log\n${actionLogText}` : "");

    try {
      const result = await runAgentLoop({
        prompt: taskPrompt,
        cwd: rootDir,
        rootDir: PAAW_ROOT,
        systemPrompt,
        agentId: config.crewId,
        model: nsModel || effectiveModel,
        fallbackModels: nsFallbacks,
        maxTurns: 15,
        timeout: 0, // no timeout — let agent complete task
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
        codename: crew?.codename || dynamicCrewLabels[role]?.replace(/^[^ ]+ /, "") || role,
        result: typeof result === "string" ? result.slice(-500) : "ok",
        report: agentReport.slice(0, 2000) || (typeof result === "string" ? result.slice(-500) : "done"),
      };
    } catch (err) {
      console.error(`[NightShift:${role}] failed:`, err.message);
      return { role, status: "failed", codename: crew?.codename || role, error: err.message };
    }
  }));

  // ── Phase 3: Generate report ──
  sendSSE("info", { message: "📝 產生報告中..." });
  const agentResults = results.map(r => r.status === "fulfilled" ? r.value : { role: "unknown", status: "failed", error: r.reason?.message });
  console.log(`[NightShift] Phase 2: Results: ${agentResults.filter(r => r.status === "completed").length}✅ ${agentResults.filter(r => r.status === "failed").length}❌`);
  const report = generateParallelReport(agentResults, ctx, dynamicCrewLabels);
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

function generateParallelReport(agentResults, ctx, dynamicLabels = null) {
  const now = new Date();

  // Use dynamic labels if provided, otherwise build from results
  const crewLabels = dynamicLabels || {};
  if (Object.keys(crewLabels).length === 0) {
    for (const r of agentResults) {
      if (!crewLabels[r.role]) crewLabels[r.role] = `🤖 ${r.codename || r.role}`;
    }
  }

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
  // EM mode: plan + execute in sequence
  const { workList, situationReport } = await planEMSession(opts);
  if (!workList.length) {
    opts.sendSSE?.("info", { message: "✅ 沒有需要調度的工作。" });
    const report = generateEMReport([], [], situationReport);
    saveNightShiftReport(opts.rootDir, report, "em");
    opts.sendSSE?.("done", { totalTasks: 0, succeeded: 0, failed: 0, empty: true });
    return { report, workList: [], results: [] };
  }
  return executeEMSession({ ...opts, workList, situationReport });
}
